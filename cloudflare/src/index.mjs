import { family } from './family.mjs';
// Public Telemetry Family API: authenticated by independently issued D1-backed sessions.
// The separate Access-protected auth Worker is the only code allowed to mint login codes.
const encoder = new TextEncoder();
const CODE_TTL = 90000;
const SESSION_TTL = 86400000;
function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
function err(status, message) {
  return Object.assign(new Error(message), { status });
}
function isHex(v, len) {
  return typeof v === 'string' && new RegExp('^[0-9a-f]{' + len + '}$').test(v);
}
function hexBytes(length = 32) {
  const b = new Uint8Array(length);
  crypto.getRandomValues(b);
  return Array.from(b, (n) => n.toString(16).padStart(2, '0')).join('');
}
async function hash(str) {
  const data = await crypto.subtle.digest('SHA-256', encoder.encode(str));
  return Array.from(new Uint8Array(data), (n) => n.toString(16).padStart(2, '0')).join('');
}
function emailOf(identity) {
  const e = typeof identity?.email === 'string' ? identity.email.trim().toLowerCase() : '';
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && !e.includes('..') ? e : null;
}
function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.display_name,
    sharingEnabled: false,
    familyReady: true,
  };
}
async function who(req, env) {
  const token = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.get('Authorization') || '')?.[1];
  if (!token) throw err(401, 'Sign in required');
  const tokenHash = await hash(token);
  const user = await env.DB.prepare(
    'SELECT a.id,a.email,a.display_name FROM email_sessions s JOIN email_accounts a ON s.account_id=a.id WHERE s.token_hash=? AND s.expires_at>?',
  )
    .bind(tokenHash, Date.now())
    .first();
  if (!user) throw err(401, 'Session expired');
  return { user, tokenHash };
}
async function exchange(req, env) {
  if (!req.headers.get('content-type')?.startsWith('application/json')) throw err(415, 'Expected JSON');
  const raw = await req.text();
  if (raw.length > 1024) throw err(413, 'Request too large');
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw err(400, 'Invalid JSON');
  }
  const { code, state, verifier } = body || {};
  if (!isHex(code, 64) || !isHex(state, 32) || !isHex(verifier, 64)) throw err(400, 'Invalid exchange');
  const now = Date.now();
  const consumed = await env.DB.prepare(
    'UPDATE access_login_codes SET consumed_at=? WHERE code_hash=? AND state_hash=? AND verifier_hash=? AND consumed_at IS NULL AND expires_at>? RETURNING authenticated_email',
  )
    .bind(now, await hash(code), await hash(state), await hash(verifier), now)
    .first();
  if (!consumed) throw err(401, 'Expired or invalid login');
  const email = emailOf({ email: consumed.authenticated_email });
  if (!email) throw err(403, 'Identity invalid');
  const account = await env.DB.prepare(
    "INSERT INTO email_accounts(id,email,display_name,created_at) VALUES(?,?,'Family member',?) ON CONFLICT(email) DO UPDATE SET email=excluded.email RETURNING id,email,display_name",
  )
    .bind(crypto.randomUUID(), email, now)
    .first();
  const token = hexBytes();
  await env.DB.prepare(
    'INSERT INTO email_sessions(token_hash,account_id,created_at,expires_at) VALUES(?,?,?,?)',
  )
    .bind(await hash(token), account.id, now, now + SESSION_TTL)
    .run();
  return json({ token, user: publicUser(account), expiresInSeconds: SESSION_TTL / 1000 });
}
async function handle(req, env, ctx) {
  const path = new URL(req.url).pathname;
  if (path === '/health' && req.method === 'GET') {
    try {
      await env.DB.prepare('SELECT 1').first();
      const rows = await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('email_accounts','email_sessions','access_login_codes')",
      ).all();
      const names = new Set(rows.results.map((r) => r.name));
      return json({
        databaseConnected: true,
        accessSchemaReady: ['email_accounts', 'email_sessions', 'access_login_codes'].every((x) =>
          names.has(x),
        ),
        familySharingReady: !!(await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='family_shares'").first()),
      });
    } catch {
      return json({ databaseConnected: false }, 503);
    }
  }
  if (path === '/v1/auth/access/exchange' && req.method === 'POST') return exchange(req, env);
  if (path === '/v1/me' && req.method === 'GET') {
    const { user } = await who(req, env);
    return json({ user: publicUser(user) });
  }
  if (path === '/v1/auth/logout' && req.method === 'POST') {
    const { tokenHash } = await who(req, env);
    await env.DB.prepare('DELETE FROM email_sessions WHERE token_hash=?').bind(tokenHash).run();
    return json({ ok: true });
  }
  if (path.startsWith('/v1/')) {
    const { user } = await who(req, env);
    return family(req, env, user, path);
  }
  return json({ error: 'Unknown endpoint' }, 404);
}
export default {
  async fetch(req, env, ctx) {
    try {
      return await handle(req, env, ctx);
    } catch (e) {
      const status = e?.status >= 400 && e.status < 500 ? e.status : 503;
      return json({ error: status === 503 ? 'Service unavailable' : e.message }, status);
    }
  },
};
