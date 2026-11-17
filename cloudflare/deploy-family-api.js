// Bundled Telemetry Family API for Cloudflare dashboard editor.
// Generated from src/family.mjs and src/index.mjs.
// Telemetry Family consent-gated handlers. Email-authenticated accounts only.
// Invitees must sign in via Cloudflare Access; creating an invite does not send email.
const DAY = 86400000;
const HOUR = 3600000;
const fail = (code, message) => Object.assign(new Error(message), { status: code });
const ok = (value, status = 200) =>
  Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
function email(value) {
  const s = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return s.length >= 5 && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && !s.includes('..')
    ? s
    : null;
}
function coordinates(lat, lng, accuracy, battery) {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    (accuracy == null ||
      (typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 10000)) &&
    (battery == null || (Number.isInteger(battery) && battery >= 0 && battery <= 100))
  );
}
async function body(req) {
  if (!req.headers.get('content-type')?.startsWith('application/json')) throw fail(415, 'JSON required');
  const raw = await req.text();
  if (raw.length > 2048) throw fail(413, 'Request too large');
  try {
    const val = JSON.parse(raw);
    if (val && typeof val === 'object' && !Array.isArray(val)) return val;
  } catch {}
  throw fail(400, 'Invalid JSON');
}
const idOk = (s) => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);
const q = (env, statement, ...values) => env.DB.prepare(statement).bind(...values);
async function enabled(env, subject) {
  const r = await q(env, 'SELECT enabled FROM family_privacy WHERE account_id=?', subject).first();
  return r?.enabled === 1;
}
async function allowed(env, subject, viewer) {
  if (subject === viewer) return true;
  const row = await q(
    env,
    'SELECT 1 AS granted FROM family_shares s JOIN family_privacy p ON p.account_id=s.subject_id AND p.enabled=1 WHERE s.subject_id=? AND s.viewer_id=?',
    subject,
    viewer,
  ).first();
  return !!row;
}
async function family(req, env, account, path) {
  const me = account.id,
    now = Date.now();
  if (path === '/v1/family/status' && req.method === 'GET') {
    const count = await q(env, 'SELECT COUNT(*) AS n FROM family_shares WHERE subject_id=?', me).first();
    return ok({ sharingEnabled: await enabled(env, me), authorizedViewers: count?.n ?? 0 });
  }
  if (path === '/v1/invites' && req.method === 'POST') {
    const b = await body(req),
      target = email(b.email);
    if (!target || target === account.email) throw fail(400, 'Enter another person’s valid email');
    const existing = await q(
      env,
      'SELECT COUNT(*) AS n FROM family_invites WHERE inviter_id=? AND created_at>?',
      me,
      now - DAY,
    ).first();
    if ((existing?.n ?? 0) >= 10) throw fail(429, 'Daily invitation limit reached');
    const duplicate = await q(
      env,
      'SELECT id FROM family_invites WHERE inviter_id=? AND invitee_email=? AND accepted_at IS NULL AND declined_at IS NULL AND expires_at>?',
      me,
      target,
      now,
    ).first();
    if (duplicate) throw fail(409, 'Invitation already pending');
    const id = crypto.randomUUID();
    await q(
      env,
      'INSERT INTO family_invites(id,inviter_id,invitee_email,created_at,expires_at) VALUES(?,?,?,?,?)',
      id,
      me,
      target,
      now,
      now + 7 * DAY,
    ).run();
    return ok(
      { id, status: 'pending', note: 'Invitee must sign in and accept; no email has been sent' },
      201,
    );
  }
  if (path === '/v1/invites' && req.method === 'GET') {
    const r = await q(
      env,
      'SELECT i.id,i.created_at,a.display_name AS from_name,a.email AS from_email FROM family_invites i JOIN email_accounts a ON a.id=i.inviter_id WHERE i.invitee_email=? AND i.accepted_at IS NULL AND i.declined_at IS NULL AND i.expires_at>? ORDER BY i.created_at DESC LIMIT 50',
      account.email,
      now,
    ).all();
    return ok({ invitations: r.results });
  }
  const decision = /^\/v1\/invites\/([a-f0-9-]{36})\/(accept|decline)$/.exec(path);
  if (decision && req.method === 'POST') {
    const [full, inviteId, action] = decision;
    if (action === 'decline') {
      const r = await q(
        env,
        'UPDATE family_invites SET declined_at=? WHERE id=? AND invitee_email=? AND accepted_at IS NULL AND declined_at IS NULL AND expires_at>? RETURNING id',
        now,
        inviteId,
        account.email,
        now,
      ).first();
      if (!r) throw fail(404, 'Invitation expired or unavailable');
      return ok({ ok: true });
    }
    const r = await q(
      env,
      'UPDATE family_invites SET accepted_at=? WHERE id=? AND invitee_email=? AND accepted_at IS NULL AND declined_at IS NULL AND expires_at>? RETURNING inviter_id',
      now,
      inviteId,
      account.email,
      now,
    ).first();
    if (!r) throw fail(404, 'Invitation expired or unavailable');
    await q(
      env,
      'INSERT OR IGNORE INTO family_shares(subject_id,viewer_id,consented_at) VALUES(?,?,?)',
      me,
      r.inviter_id,
      now,
    ).run();
    // Accepting does not activate location collection. The owner uses a distinct switch.
    return ok({ ok: true, sharingEnabled: await enabled(env, me) });
  }
  if (path === '/v1/family/sharing' && req.method === 'POST') {
    const b = await body(req);
    if (typeof b.enabled !== 'boolean') throw fail(400, 'Expected boolean enabled');
    await q(
      env,
      'INSERT INTO family_privacy(account_id,enabled,updated_at) VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at',
      me,
      b.enabled ? 1 : 0,
      now,
    ).run();
    return ok({ sharingEnabled: b.enabled });
  }
  if (path === '/v1/family/viewers' && req.method === 'GET') {
    const r = await q(
      env,
      'SELECT a.id,a.display_name AS name,a.email FROM family_shares s JOIN email_accounts a ON a.id=s.viewer_id WHERE s.subject_id=? ORDER BY a.display_name LIMIT 100',
      me,
    ).all();
    return ok({ viewers: r.results });
  }
  const revoke = /^\/v1\/family\/viewers\/([a-f0-9-]{36})$/.exec(path);
  if (revoke && req.method === 'DELETE') {
    await q(env, 'DELETE FROM family_shares WHERE subject_id=? AND viewer_id=?', me, revoke[1]).run();
    return ok({ ok: true });
  }
  if (path === '/v1/family/contacts' && req.method === 'GET') {
    const r = await q(
      env,
      'SELECT a.id,a.display_name AS name,a.email,p.enabled,l.latitude,l.longitude,l.battery,l.observed_at FROM family_shares s JOIN email_accounts a ON a.id=s.subject_id LEFT JOIN family_privacy p ON p.account_id=a.id LEFT JOIN family_latest l ON l.account_id=a.id AND p.enabled=1 AND l.observed_at>=s.consented_at WHERE s.viewer_id=? LIMIT 100',
      me,
    ).all();
    return ok({
      contacts: r.results.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        sharing: c.enabled === 1,
        latitude: c.enabled === 1 ? (c.latitude ?? null) : null,
        longitude: c.enabled === 1 ? (c.longitude ?? null) : null,
        battery: c.enabled === 1 ? (c.battery ?? null) : null,
        updatedAt: c.enabled === 1 ? (c.observed_at ?? null) : null,
        online: c.enabled === 1 && c.observed_at != null && now - c.observed_at < 600000,
      })),
    });
  }
  const history = /^\/v1\/family\/contacts\/([a-f0-9-]{36})\/history$/.exec(path);
  if (history && req.method === 'GET') {
    if (!(await allowed(env, history[1], me)))
      throw fail(403, 'This contact has not shared location with you');
    const r = await q(
      env,
      'SELECT h.latitude,h.longitude,h.accuracy,h.battery,h.observed_at FROM family_history h JOIN family_shares s ON s.subject_id=h.account_id AND s.viewer_id=? WHERE h.account_id=? AND h.observed_at>? AND h.observed_at>=s.consented_at ORDER BY h.observed_at ASC LIMIT 500',
      me,
      history[1],
      now - DAY,
    ).all();
    return ok({ history: r.results });
  }
  if (path === '/v1/location' && req.method === 'POST') {
    if (!(await enabled(env, me))) throw fail(403, 'Sharing is paused');
    const count = await q(env, 'SELECT COUNT(*) AS n FROM family_shares WHERE subject_id=?', me).first();
    if (!count?.n) throw fail(403, 'No accepted contacts');
    const b = await body(req);
    if (!coordinates(b.lat, b.lng, b.accuracy, b.battery)) throw fail(400, 'Invalid location');
    const fix = [me, b.lat, b.lng, b.accuracy ?? null, b.battery ?? null, now];
    // D1 batch executes atomically; server stamps observation time, not device-supplied time.
    await env.DB.batch([
      q(
        env,
        'INSERT INTO family_history(id,account_id,latitude,longitude,accuracy,battery,observed_at) VALUES(?,?,?,?,?,?,?)',
        crypto.randomUUID(),
        ...fix,
      ),
      q(
        env,
        'INSERT INTO family_latest(account_id,latitude,longitude,accuracy,battery,observed_at) VALUES(?,?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET latitude=excluded.latitude,longitude=excluded.longitude,accuracy=excluded.accuracy,battery=excluded.battery,observed_at=excluded.observed_at',
        ...fix,
      ),
    ]);
    return ok({ ok: true });
  }
  throw fail(404, 'Endpoint unavailable');
}

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
        familySharingReady: !!(await env.DB.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='family_shares'",
        ).first()),
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
