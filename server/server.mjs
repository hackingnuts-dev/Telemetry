import express from 'express';
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { Pool } from 'pg';
import { WebSocketServer } from 'ws';
import { rateLimit } from 'express-rate-limit';
import { validPhone, validLocation, meters } from './policy.mjs';

for (const key of ['DATABASE_URL', 'PUBLIC_APP_URL']) if (!process.env[key]) throw Error('Missing ' + key);
const testOtp = process.env.NODE_ENV === 'test' && process.env.ALLOW_TEST_OTP === 'true';
if (
  process.env.NODE_ENV === 'production' &&
  ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VERIFY_SERVICE_SID', 'TWILIO_FROM_NUMBER'].some(
    (x) => !process.env[x],
  )
)
  throw Error('Production SMS secrets required');
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
});
const q = (sql, values = []) => db.query(sql, values);
const app = express(),
  http = createServer(app),
  wsServer = new WebSocketServer({ noServer: true });
const clients = new Map(),
  tickets = new Map(),
  otp = new Map();
const secret = () => randomBytes(32).toString('base64url'),
  digest = (x) => createHash('sha256').update(x).digest('hex');
const error = (code, message) => Object.assign(new Error(message), { status: code });
const phone = (p) => {
  if (!validPhone(p)) throw error(400, 'Phone must include country code, e.g. +12025550123');
  return p;
};
const uuid = (p) => typeof p === 'string' && /^[0-9a-f-]{36}$/.test(p);
const publicUser = (u) => ({ id: u.id, phone: u.phone, name: u.name, sharingEnabled: u.sharing_enabled });
const notify = (id, message) => {
  for (const ws of clients.get(id) || []) if (ws.readyState === 1) ws.send(JSON.stringify(message));
};
const viewers = async (id) =>
  (await q('SELECT viewer_id FROM shares WHERE subject_id=$1', [id])).rows.map((x) => x.viewer_id);
const recipient = async (id, viewer) => {
  const r = await q(
    'SELECT u.* FROM users u JOIN shares s ON s.subject_id=u.id AND s.viewer_id=$2 WHERE u.id=$1 AND u.sharing_enabled=true',
    [id, viewer],
  );
  if (!r.rows[0]) throw error(403, 'Location not shared with you, or contact has paused');
  return r.rows[0];
};
const session = async (t) => {
  if (!t || typeof t !== 'string' || t.length < 32) return null;
  return (
    (
      await q(
        'SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()',
        [digest(t)],
      )
    ).rows[0] || null
  );
};
async function auth(req, res, next) {
  try {
    const t = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
    req.user = await session(t);
    req.token = t;
    if (!req.user) throw error(401, 'Sign in first');
    next();
  } catch (e) {
    next(e);
  }
}
async function twilio(path, params) {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN)
    throw error(503, 'SMS provider not configured');
  const a = process.env.TWILIO_ACCOUNT_SID;
  const base = path.startsWith('Services/')
    ? 'https://verify.twilio.com/v2/'
    : 'https://api.twilio.com/2010-04-01/Accounts/' + a + '/';
  const r = await fetch(base + path, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(a + ':' + process.env.TWILIO_AUTH_TOKEN).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params),
  });
  if (!r.ok) throw error(502, 'SMS service rejected request');
  return r.json();
}
async function startOtp(p) {
  if (testOtp) {
    const code = String(100000 + Math.floor(Math.random() * 900000));
    otp.set(p, { hash: digest(code), expires: Date.now() + 300000 });
    return { testCode: code };
  }
  await twilio('Services/' + process.env.TWILIO_VERIFY_SERVICE_SID + '/Verifications', {
    To: p,
    Channel: 'sms',
  });
  return {};
}
async function verifyOtp(p, code) {
  if (testOtp) {
    const x = otp.get(p);
    if (!x || Date.now() > x.expires || digest(code) !== x.hash) return false;
    otp.delete(p);
    return true;
  }
  const r = await twilio('Services/' + process.env.TWILIO_VERIFY_SERVICE_SID + '/VerificationCheck', {
    To: p,
    Code: code,
  });
  return r.status === 'approved';
}
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.use(express.json({ limit: '32kb' }));
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  next();
});
const limit = rateLimit({
  windowMs: 15 * 60000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});
const respond = (res, status, body) => res.status(status).json(body);
app.get('/health', async (req, res, next) => {
  try {
    await q('SELECT 1');
    respond(res, 200, { ok: true });
  } catch (e) {
    next(e);
  }
});
app.post('/v1/auth/start', limit, async (req, res, next) => {
  try {
    respond(res, 200, { ok: true, ...(await startOtp(phone(req.body.phone))) });
  } catch (e) {
    next(e);
  }
});
app.post('/v1/auth/verify', limit, async (req, res, next) => {
  try {
    const p = phone(req.body.phone),
      code = req.body.code;
    if (typeof code !== 'string' || !/^\d{4,8}$/.test(code)) throw error(400, 'Invalid verification code');
    if (!(await verifyOtp(p, code))) throw error(401, 'Incorrect or expired code');
    const name =
      typeof req.body.name === 'string' && req.body.name.trim().length <= 60
        ? req.body.name.trim()
        : 'Family member';
    const u = (
      await q(
        "INSERT INTO users(phone,name) VALUES($1,$2) ON CONFLICT(phone) DO UPDATE SET name=CASE WHEN users.name='Family member' THEN EXCLUDED.name ELSE users.name END RETURNING *",
        [p, name || 'Family member'],
      )
    ).rows[0];
    const t = secret();
    await q("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '14 days')", [
      digest(t),
      u.id,
    ]);
    respond(res, 200, { token: t, user: publicUser(u), expiresInDays: 14 });
  } catch (e) {
    next(e);
  }
});
app.get('/v1/me', auth, (req, res) => respond(res, 200, { user: publicUser(req.user) }));
app.post('/v1/auth/logout', auth, async (req, res, next) => {
  try {
    await q('DELETE FROM sessions WHERE token_hash=$1', [digest(req.token)]);
    respond(res, 200, { ok: true });
  } catch (e) {
    next(e);
  }
});
app.post('/v1/invites', auth, limit, async (req, res, next) => {
  try {
    const target = phone(req.body.phone);
    if (target === req.user.phone) throw error(400, 'Cannot invite yourself');
    const old = (
      await q(
        'SELECT id FROM invitations WHERE inviter_id=$1 AND invited_phone=$2 AND accepted_at IS NULL AND declined_at IS NULL AND expires_at>now()',
        [req.user.id, target],
      )
    ).rows;
    if (old.length) throw error(409, 'Invite already pending');
    const id = (
      await q('INSERT INTO invitations(inviter_id,invited_phone) VALUES($1,$2) RETURNING id', [
        req.user.id,
        target,
      ])
    ).rows[0].id;
    try {
      if (!testOtp)
        await twilio('Messages.json', {
          From: process.env.TWILIO_FROM_NUMBER,
          To: target,
          Body:
            req.user.name +
            ' invited you to share your location in Telemetry Family. Install or open the app: ' +
            (process.env.MOBILE_INSTALL_URL || process.env.PUBLIC_APP_URL) +
            '. Verify your own number, then Accept or Decline. No location is shared until you accept.',
        });
    } catch (e) {
      await q('DELETE FROM invitations WHERE id=$1', [id]);
      throw e;
    }
    respond(res, 201, { id, status: 'pending' });
  } catch (e) {
    next(e);
  }
});
app.get('/v1/invites', auth, async (req, res, next) => {
  try {
    const r = await q(
      'SELECT i.id,u.name AS from_name,u.phone AS from_phone FROM invitations i JOIN users u ON u.id=i.inviter_id WHERE i.invited_phone=$1 AND i.accepted_at IS NULL AND i.declined_at IS NULL AND i.expires_at>now()',
      [req.user.phone],
    );
    respond(res, 200, { invitations: r.rows });
  } catch (e) {
    next(e);
  }
});
app.post('/v1/invites/:id/accept', auth, async (req, res, next) => {
  try {
    if (!uuid(req.params.id)) throw error(400, 'Invalid invitation');
    const c = await db.connect();
    try {
      await c.query('BEGIN');
      const x = (
        await c.query(
          'SELECT * FROM invitations WHERE id=$1 AND invited_phone=$2 AND accepted_at IS NULL AND declined_at IS NULL AND expires_at>now() FOR UPDATE',
          [req.params.id, req.user.phone],
        )
      ).rows[0];
      if (!x) throw error(404, 'Invitation expired or not intended for this number');
      await c.query('INSERT INTO shares(subject_id,viewer_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [
        req.user.id,
        x.inviter_id,
      ]);
      await c.query('UPDATE invitations SET accepted_at=now() WHERE id=$1', [req.params.id]);
      await c.query('UPDATE users SET sharing_enabled=true WHERE id=$1', [req.user.id]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
    for (const id of await viewers(req.user.id))
      notify(id, { type: 'sharing', userId: req.user.id, enabled: true });
    respond(res, 200, { ok: true, sharingEnabled: true });
  } catch (e) {
    next(e);
  }
});
app.post('/v1/invites/:id/decline', auth, async (req, res, next) => {
  try {
    const x = await q(
      'UPDATE invitations SET declined_at=now() WHERE id=$1 AND invited_phone=$2 AND accepted_at IS NULL AND declined_at IS NULL RETURNING id',
      [req.params.id, req.user.phone],
    );
    if (!x.rowCount) throw error(404, 'Invitation unavailable');
    respond(res, 200, { ok: true });
  } catch (e) {
    next(e);
  }
});
app.post('/v1/family/sharing', auth, async (req, res, next) => {
  try {
    if (typeof req.body.enabled !== 'boolean') throw error(400, 'enabled must be boolean');
    const u = (
      await q('UPDATE users SET sharing_enabled=$2 WHERE id=$1 RETURNING *', [req.user.id, req.body.enabled])
    ).rows[0];
    for (const id of await viewers(req.user.id))
      notify(id, { type: 'sharing', userId: req.user.id, enabled: u.sharing_enabled });
    respond(res, 200, { user: publicUser(u) });
  } catch (e) {
    next(e);
  }
});
app.get('/v1/family/viewers', auth, async (req, res, next) => {
  try {
    const r = await q(
      'SELECT u.id,u.name,u.phone FROM shares s JOIN users u ON u.id=s.viewer_id WHERE s.subject_id=$1 ORDER BY u.name',
      [req.user.id],
    );
    respond(res, 200, { viewers: r.rows });
  } catch (e) {
    next(e);
  }
});
app.delete('/v1/family/shares/:viewer', auth, async (req, res, next) => {
  try {
    if (!uuid(req.params.viewer)) throw error(400, 'Invalid contact');
    await q('DELETE FROM shares WHERE subject_id=$1 AND viewer_id=$2', [req.user.id, req.params.viewer]);
    notify(req.params.viewer, { type: 'sharing', userId: req.user.id, enabled: false });
    respond(res, 200, { ok: true });
  } catch (e) {
    next(e);
  }
});
app.get('/v1/family/contacts', auth, async (req, res, next) => {
  try {
    const r = await q(
      'SELECT u.id,u.name,u.phone,u.sharing_enabled,l.lat,l.lng,l.battery,l.recorded_at FROM shares s JOIN users u ON u.id=s.subject_id LEFT JOIN latest_locations l ON l.user_id=u.id AND u.sharing_enabled=true WHERE s.viewer_id=$1 ORDER BY u.name',
      [req.user.id],
    );
    respond(res, 200, {
      contacts: r.rows.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        sharing: c.sharing_enabled,
        latitude: c.sharing_enabled ? c.lat : null,
        longitude: c.sharing_enabled ? c.lng : null,
        battery: c.sharing_enabled ? c.battery : null,
        updatedAt: c.sharing_enabled ? c.recorded_at : null,
        online: !!(
          c.sharing_enabled &&
          c.recorded_at &&
          Date.now() - new Date(c.recorded_at).getTime() < 600000
        ),
      })),
    });
  } catch (e) {
    next(e);
  }
});
app.get('/v1/family/contacts/:id/history', auth, async (req, res, next) => {
  try {
    if (!uuid(req.params.id)) throw error(400, 'Invalid contact');
    await recipient(req.params.id, req.user.id);
    const r = await q(
      "SELECT lat,lng,accuracy,battery,recorded_at FROM history WHERE user_id=$1 AND recorded_at>now()-interval '24 hours' ORDER BY recorded_at ASC LIMIT 3000",
      [req.params.id],
    );
    respond(res, 200, { history: r.rows });
  } catch (e) {
    next(e);
  }
});
app.post('/v1/location', auth, async (req, res, next) => {
  try {
    const { lat, lng, accuracy, battery } = req.body;
    if (
      !validLocation(lat, lng, accuracy) ||
      (battery != null && (!Number.isInteger(battery) || battery < 0 || battery > 100))
    )
      throw error(400, 'Invalid location or battery');
    if (!req.user.sharing_enabled) throw error(403, 'Sharing paused');
    const subscribers = await viewers(req.user.id);
    if (!subscribers.length) throw error(403, 'No accepted contacts');
    await q('INSERT INTO history(user_id,lat,lng,accuracy,battery) VALUES($1,$2,$3,$4,$5)', [
      req.user.id,
      lat,
      lng,
      accuracy ?? null,
      battery ?? null,
    ]);
    await q(
      'INSERT INTO latest_locations(user_id,lat,lng,accuracy,battery) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id) DO UPDATE SET lat=$2,lng=$3,accuracy=$4,battery=$5,recorded_at=now()',
      [req.user.id, lat, lng, accuracy ?? null, battery ?? null],
    );
    for (const id of subscribers)
      notify(id, {
        type: 'location',
        userId: req.user.id,
        lat,
        lng,
        battery: battery ?? null,
        updatedAt: new Date().toISOString(),
      });
    const zones = (await q('SELECT * FROM zones WHERE owner_id=$1', [req.user.id])).rows;
    for (const z of zones) {
      const inside = meters({ lat, lng }, { lat: z.lat, lng: z.lng }) <= z.radius_m;
      const previous = (await q('SELECT inside FROM zone_presence WHERE zone_id=$1', [z.id])).rows[0];
      await q(
        'INSERT INTO zone_presence(zone_id,inside) VALUES($1,$2) ON CONFLICT(zone_id) DO UPDATE SET inside=$2',
        [z.id, inside],
      );
      if (previous && previous.inside !== inside) {
        const message = z.name + ': ' + (inside ? 'entered' : 'left') + ' safe zone';
        const id = z.created_by;
        if (subscribers.includes(id)) {
          await q('INSERT INTO alerts(viewer_id,subject_id,message) VALUES($1,$2,$3)', [
            id,
            req.user.id,
            message,
          ]);
          notify(id, { type: 'geofence', userId: req.user.id, message });
        }
      }
    }
    // Retention is 24 hours on new writes; schedule periodic maintenance as well.
    await q("DELETE FROM history WHERE recorded_at < now()-interval '24 hours'");
    respond(res, 200, { ok: true });
  } catch (e) {
    next(e);
  }
});
app.get('/v1/alerts', auth, async (req, res, next) => {
  try {
    const r = await q(
      "SELECT subject_id,message,created_at FROM alerts WHERE viewer_id=$1 AND created_at>now()-interval '24 hours' ORDER BY created_at DESC LIMIT 100",
      [req.user.id],
    );
    respond(res, 200, { alerts: r.rows });
  } catch (e) {
    next(e);
  }
});
app.get('/v1/zones', auth, async (req, res, next) => {
  try {
    const subject = uuid(req.query.subjectId) ? req.query.subjectId : req.user.id;
    if (subject !== req.user.id) await recipient(subject, req.user.id);
    respond(res, 200, {
      zones: (
        await q('SELECT id,name,lat,lng,radius_m FROM zones WHERE owner_id=$1 AND created_by=$2', [
          subject,
          req.user.id,
        ])
      ).rows,
    });
  } catch (e) {
    next(e);
  }
});
app.post('/v1/zones', auth, async (req, res, next) => {
  try {
    const { name, lat, lng, radiusM } = req.body;
    const subject = uuid(req.body.subjectId) ? req.body.subjectId : req.user.id;
    if (subject !== req.user.id) await recipient(subject, req.user.id);
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > 60 ||
      !validLocation(lat, lng) ||
      !Number.isInteger(radiusM) ||
      radiusM < 100 ||
      radiusM > 2000
    )
      throw error(400, 'Invalid zone');
    const r = await q(
      'INSERT INTO zones(owner_id,name,lat,lng,radius_m,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,name',
      [subject, name.trim(), lat, lng, radiusM, req.user.id],
    );
    respond(res, 201, { zone: r.rows[0] });
  } catch (e) {
    next(e);
  }
});
app.post('/v1/live-ticket', auth, (req, res) => {
  const t = secret();
  tickets.set(digest(t), { userId: req.user.id, expires: Date.now() + 30000 });
  respond(res, 200, { ticket: t });
});
http.on('upgrade', (req, socket, head) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname !== '/v1/live') throw Error('bad path');
    const t = u.searchParams.get('ticket'),
      v = t && tickets.get(digest(t));
    if (!v || v.expires < Date.now()) throw Error('invalid ticket');
    tickets.delete(digest(t));
    wsServer.handleUpgrade(req, socket, head, (ws) => {
      ws.userId = v.userId;
      wsServer.emit('connection', ws);
    });
  } catch {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
  }
});
wsServer.on('connection', (ws) => {
  const set = clients.get(ws.userId) || new Set();
  set.add(ws);
  clients.set(ws.userId, set);
  ws.send(JSON.stringify({ type: 'connected' }));
  ws.on('close', () => {
    set.delete(ws);
    if (!set.size) clients.delete(ws.userId);
  });
});
app.use(express.static(new URL('./public/', import.meta.url).pathname));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const code = err.status >= 400 && err.status < 500 ? err.status : err.code === '23505' ? 409 : 500;
  respond(res, code, { error: code === 500 ? 'Internal server error' : err.message });
});
const port = Number(process.env.PORT || 8787);
http.listen(port, () => console.log('Telemetry Family ready on port ' + port));
process.on('SIGTERM', () => {
  http.close();
  db.end();
});
