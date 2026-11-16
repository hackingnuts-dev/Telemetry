// Telemetry Family — Cloudflare Worker email authentication (phase 1).
// All location and sharing API requests return 503 until authorization is ported.
const CODE_LIFETIME_MS = 10 * 60_000;
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60_000;
const RATE_WINDOW_MS = 60 * 60_000;
const ENCODER = new TextEncoder();

function json(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...headers,
    },
  });
}
function reject(status, message) {
  return Object.assign(new Error(message), { status });
}
export function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (
    email.length > 254 ||
    !/^[a-z0-9.!#$%&'*+/=?^_\`{|}~-]+@[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?\.[a-z]{2,}$/i.test(email)
  )
    return null;
  if (email.includes('..') || email.startsWith('.') || email.includes('.@')) return null;
  return email;
}
export function validCode(value) {
  return typeof value === 'string' && /^[0-9]{6}$/.test(value);
}
async function digest(value) {
  const b = await crypto.subtle.digest('SHA-256', ENCODER.encode(value));
  return Array.from(new Uint8Array(b), (n) => n.toString(16).padStart(2, '0')).join('');
}
async function mac(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    ENCODER.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const result = await crypto.subtle.sign('HMAC', key, ENCODER.encode(value));
  return Array.from(new Uint8Array(result), (n) => n.toString(16).padStart(2, '0')).join('');
}
function configured(env) {
  return !!(
    env.DB &&
    typeof env.AUTH_PEPPER === 'string' &&
    env.AUTH_PEPPER.length >= 32 &&
    typeof env.EMAIL_FROM === 'string' &&
    normalizeEmail(env.EMAIL_FROM) &&
    typeof env.RESEND_API_KEY === 'string' && env.RESEND_API_KEY.startsWith('re_')
  );
}
async function parseBody(req) {
  if (!req.headers.get('Content-Type')?.includes('application/json')) throw reject(415, 'JSON body required');
  const raw = await req.text();
  if (raw.length > 2048) throw reject(413, 'Request too large');
  try {
    const val = JSON.parse(raw);
    if (!val || typeof val !== 'object' || Array.isArray(val)) throw Error('object expected');
    return val;
  } catch {
    throw reject(400, 'Invalid request');
  }
}
async function throttle(env, category, id, limit, now) {
  const keyHash = await mac(env.AUTH_PEPPER, category + ':' + id);
  const windowStart = Math.floor(now / RATE_WINDOW_MS) * RATE_WINDOW_MS;
  const result = await env.DB.prepare(
    'INSERT INTO email_auth_limits(key_hash,window_start,hits) VALUES (?,?,1) ' +
      'ON CONFLICT(key_hash,window_start) DO UPDATE SET hits=hits+1 RETURNING hits',
  )
    .bind(keyHash, windowStart)
    .first();
  if (!result || result.hits > limit) throw reject(429, 'Too many requests. Try again later.');
}
async function deliver(env, email, code) {
  const text =
    'Your Telemetry Family sign-in code is ' +
    code +
    '. It expires in 10 minutes. If you did not request this, you can ignore this message.';
  if (!env.RESEND_API_KEY) throw Error('Email provider not configured');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + env.RESEND_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [email], subject: 'Telemetry Family sign-in code', text }),
  });
  if (!r.ok) throw Error('Email delivery unavailable');

}
async function authenticate(req, env) {
  const bearer = /^Bearer ([A-Za-z0-9_-]{40,100})$/.exec(req.headers.get('Authorization') || '')?.[1];
  if (!bearer) throw reject(401, 'Sign in required');
  const tokenHash = await digest(bearer);
  const now = Date.now();
  const account = await env.DB.prepare(
    'SELECT a.id,a.email,a.display_name FROM email_sessions s ' +
      'JOIN email_accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?',
  )
    .bind(tokenHash, now)
    .first();
  if (!account) throw reject(401, 'Session expired. Sign in again.');
  return { account, tokenHash };
}
function publicUser(row) {
  return { id: row.id, email: row.email, name: row.display_name, sharingEnabled: false, familyReady: false };
}
async function start(req, env) {
  if (!configured(env)) return json({ error: 'Email service not configured' }, 503);
  const body = await parseBody(req);
  const email = normalizeEmail(body.email);
  if (!email) throw reject(400, 'Enter a valid email address');
  const now = Date.now();
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  await throttle(env, 'email-start', email, 6, now);
  await throttle(env, 'ip-start', ip, 30, now);
  const emailKey = await mac(env.AUTH_PEPPER, 'email:' + email);
  const mostRecent = await env.DB.prepare(
    'SELECT created_at FROM email_challenges WHERE email_key=? ORDER BY created_at DESC LIMIT 1',
  )
    .bind(emailKey)
    .first();
  if (mostRecent && now - mostRecent.created_at < 60_000) throw reject(429, 'Try again in one minute');
  const challengeId = crypto.randomUUID();
  const digits = new Uint32Array(1);
  crypto.getRandomValues(digits);
  const code = String(digits[0] % 1_000_000).padStart(6, '0');
  const codeMac = await mac(env.AUTH_PEPPER, 'code:' + challengeId + ':' + email + ':' + code);
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE email_challenges SET consumed_at=? WHERE email_key=? AND consumed_at IS NULL',
    ).bind(now, emailKey),
    env.DB.prepare(
      'INSERT INTO email_challenges(id,email_key,code_mac,created_at,expires_at,attempts) VALUES (?,?,?,?,?,0)',
    ).bind(challengeId, emailKey, codeMac, now, now + CODE_LIFETIME_MS),
  ]);
  try {
    await deliver(env, email, code);
  } catch {
    await env.DB.prepare('UPDATE email_challenges SET consumed_at=? WHERE id=?')
      .bind(Date.now(), challengeId)
      .run();
    return json({ error: 'Email could not be delivered. Check your sending configuration.' }, 503);
  }
  return json({ ok: true, challengeId, expiresInSeconds: 600 });
}
async function verify(req, env) {
  if (!configured(env)) return json({ error: 'Email service not configured' }, 503);
  const body = await parseBody(req);
  const email = normalizeEmail(body.email);
  const id = body.challengeId;
  const code = body.code;
  if (!email || typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id) || !validCode(code)) {
    throw reject(400, 'Invalid verification request');
  }
  const now = Date.now();
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  await throttle(env, 'verify-email', email, 20, now);
  await throttle(env, 'verify-ip', ip, 50, now);
  const emailKey = await mac(env.AUTH_PEPPER, 'email:' + email);
  const codeMac = await mac(env.AUTH_PEPPER, 'code:' + id + ':' + email + ':' + code);
  const consumed = await env.DB.prepare(
    'UPDATE email_challenges SET consumed_at=? WHERE id=? AND email_key=? AND code_mac=? ' +
      'AND consumed_at IS NULL AND expires_at>? AND attempts<5 RETURNING id',
  )
    .bind(now, id, emailKey, codeMac, now)
    .first();
  if (!consumed) {
    await env.DB.prepare(
      'UPDATE email_challenges SET attempts=attempts+1 WHERE id=? AND email_key=? ' +
        'AND consumed_at IS NULL AND expires_at>? AND attempts<5',
    )
      .bind(id, emailKey, now)
      .run();
    throw reject(401, 'Incorrect, expired, or already-used code');
  }
  const name =
    typeof body.name === 'string' && body.name.trim().length <= 60 && body.name.trim().length > 0
      ? body.name.trim()
      : 'Family member';
  const row = await env.DB.prepare(
    'INSERT INTO email_accounts(id,email,display_name,created_at) VALUES (?,?,?,?) ' +
      'ON CONFLICT(email) DO UPDATE SET email=excluded.email ' +
      'RETURNING id,email,display_name',
  )
    .bind(crypto.randomUUID(), email, name, now)
    .first();
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const sessionToken = Array.from(bytes, (n) => n.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare(
    'INSERT INTO email_sessions(token_hash,account_id,created_at,expires_at) VALUES (?,?,?,?)',
  )
    .bind(await digest(sessionToken), row.id, now, now + SESSION_LIFETIME_MS)
    .run();
  return json({ token: sessionToken, expiresInSeconds: SESSION_LIFETIME_MS / 1000, user: publicUser(row) });
}
async function fetchHandler(request, env) {
  const pathname = new URL(request.url).pathname;
  if (pathname === '/health' && request.method === 'GET') {
    try {
      await env.DB.prepare('SELECT 1').first();
      const needed = ['email_accounts', 'email_challenges', 'email_sessions', 'email_auth_limits'];
      const rows = await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'email_%'",
      ).all();
      return json({
        service: 'Telemetry Family API',
        databaseConnected: true,
        emailSchemaReady: needed.every((n) => rows.results.some((r) => r.name === n)),
        emailSendingConfigured: !!(env.RESEND_API_KEY && env.EMAIL_FROM),
        familySharingReady: false,
      });
    } catch {
      return json({ databaseConnected: false, familySharingReady: false }, 503);
    }
  }
  if (!pathname.startsWith('/v1/'))
    return json({ service: 'Telemetry Family API', familySharingReady: false }, 503);
  if (pathname === '/v1/auth/email/start' && request.method === 'POST') return start(request, env);
  if (pathname === '/v1/auth/email/verify' && request.method === 'POST') return verify(request, env);
  if (pathname === '/v1/me' && request.method === 'GET') {
    if (!configured(env)) throw reject(503, 'Email service not configured');
    const { account } = await authenticate(request, env);
    return json({ user: publicUser(account) });
  }
  if (pathname === '/v1/auth/logout' && request.method === 'POST') {
    const { tokenHash } = await authenticate(request, env);
    await env.DB.prepare('DELETE FROM email_sessions WHERE token_hash=?').bind(tokenHash).run();
    return json({ ok: true });
  }
  // No locations, invitations or family metadata are exposed until each endpoint
  // has server-side consent/authorization checks and dedicated integration tests.
  return json({ error: 'Family sharing API not enabled yet' }, 503);
}
export default {
  async fetch(request, env) {
    try {
      return await fetchHandler(request, env);
    } catch (error) {
      const status =
        Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 ? error.status : 503;
      return json({ error: status === 503 ? 'Service temporarily unavailable' : error.message }, status);
    }
  },
};
