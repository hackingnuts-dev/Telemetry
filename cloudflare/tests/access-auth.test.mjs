import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../src/index.mjs';
import authWorker from '../src/auth.mjs';

function fixture() {
  const sql = new DatabaseSync(':memory:');
  for (const name of ['0002_email_auth.sql', '0003_access_exchange.sql'])
    sql.exec(readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8'));
  function prepared(query, params = []) {
    return {
      bind(...values) {
        return prepared(query, values);
      },
      async first() {
        return sql.prepare(query).get(...params) ?? null;
      },
      async run() {
        return sql.prepare(query).run(...params);
      },
      async all() {
        return { results: sql.prepare(query).all(...params) };
      },
    };
  }
  return { env: { DB: { prepare: prepared } }, sql };
}
async function call(env, path, { method = 'GET', body, token, access, headers, asAuth = false } = {}) {
  const req = new Request('https://telemetry-family-api.example.workers.dev' + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await (asAuth ? authWorker : worker).fetch(
    req,
    env,
    access ? { access: { getIdentity: async () => ({ email: access }) } } : {},
  );
  return res;
}
async function json(res) {
  return { status: res.status, body: await res.json() };
}
async function sha(str) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))),
    (x) => x.toString(16).padStart(2, '0'),
  ).join('');
}
test('Access OTP identity cannot be forged from headers; sharing is disabled', async () => {
  const { env } = fixture();
  const state = 'ab'.repeat(16),
    verifier = 'cd'.repeat(32),
    challenge = await sha(verifier);
  const path = '/auth/access/complete?state=' + state + '&challenge=' + challenge;
  const spoof = await call(env, path, {
    headers: { 'Cf-Access-Jwt-Assertion': 'fake', 'X-Email': 'admin@example.com' },
    asAuth: true,
  });
  assert.equal(spoof.status, 403);
  const invalid = await call(env, path, { access: 'not-an-email', asAuth: true });
  assert.equal(invalid.status, 403);
  assert.equal(
    (await json(await call(env, '/v1/location', { method: 'POST', body: { lat: 40, lng: -74 } }))).status,
    503,
  );
});
test('browser one-time code exchange binds to state, verifier and verified identity', async () => {
  const { env } = fixture();
  const state = '01'.repeat(16),
    verifier = '02'.repeat(32),
    challenge = await sha(verifier);
  const finished = await call(env, '/auth/access/complete?state=' + state + '&challenge=' + challenge, {
    access: 'Person@Example.com',
    asAuth: true,
  });
  assert.equal(finished.status, 302);
  assert.equal(finished.headers.get('Cache-Control'), 'no-store');
  const cb = new URL(finished.headers.get('Location'));
  assert.equal(cb.protocol, 'telemetry:');
  assert.equal(cb.hostname, 'family-auth');
  assert.equal(cb.searchParams.get('state'), state);
  const code = cb.searchParams.get('code');
  assert.match(code, /^[0-9a-f]{64}$/);
  const wrong = await json(
    await call(env, '/v1/auth/access/exchange', {
      method: 'POST',
      body: { code, state, verifier: 'ff'.repeat(32) },
    }),
  );
  assert.equal(wrong.status, 401);
  const result = await json(
    await call(env, '/v1/auth/access/exchange', { method: 'POST', body: { code, state, verifier } }),
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.user.email, 'person@example.com');
  assert.equal(result.body.user.sharingEnabled, false);
  assert.equal(result.body.user.familyReady, false);
  const replay = await json(
    await call(env, '/v1/auth/access/exchange', { method: 'POST', body: { code, state, verifier } }),
  );
  assert.equal(replay.status, 401);
  const { token } = result.body;
  assert.equal((await json(await call(env, '/v1/me'))).status, 401);
  assert.equal((await json(await call(env, '/v1/me', { token }))).body.user.email, 'person@example.com');
  assert.equal((await json(await call(env, '/v1/auth/logout', { method: 'POST', token }))).status, 200);
  assert.equal((await json(await call(env, '/v1/me', { token }))).status, 401);
});
