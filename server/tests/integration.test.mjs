import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const active = Boolean(process.env.DATABASE_URL);
test(
  'Two real HTTP clients: invitation, pause, role reversal, history and geofence',
  { skip: !active },
  async () => {
    const port = 19437;
    const base = 'http://127.0.0.1:' + port;
    const child = spawn(process.execPath, ['server.mjs'], {
      cwd: new URL('../', import.meta.url),
      env: {
        ...process.env,
        PORT: String(port),
        PUBLIC_APP_URL: base,
        NODE_ENV: 'test',
        ALLOW_TEST_OTP: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let logs = '';
    child.stderr.on('data', (x) => (logs += x.toString()));
    child.stdout.on('data', (x) => (logs += x.toString()));
    const call = async (path, { method = 'GET', token, body } = {}) => {
      const r = await fetch(base + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      return { status: r.status, data };
    };
    const must = async (path, opts = {}, status = 200) => {
      const r = await call(path, opts);
      assert.equal(
        r.status,
        status,
        JSON.stringify({ path, status: r.status, data: r.data, logs: logs.slice(-600) }),
      );
      return r.data;
    };
    try {
      let ready = false;
      for (let i = 0; i < 70; i++) {
        if (child.exitCode !== null) throw Error('Family server exited: ' + logs);
        try {
          const r = await call('/health');
          if (r.status === 200) {
            ready = true;
            break;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 150));
      }
      assert.ok(ready, 'Server did not start: ' + logs);
      const rand = () => String(Math.floor(Math.random() * 900000000) + 100000000);
      const phoneA = '+1' + rand().slice(0, 9) + '0',
        phoneB = '+1' + rand().slice(0, 9) + '1',
        phoneC = '+1' + rand().slice(0, 9) + '2';
      const login = async (phone, name) => {
        const start = await must('/v1/auth/start', { method: 'POST', body: { phone } });
        assert.match(start.testCode, /^\d{6}$/);
        const r = await must('/v1/auth/verify', {
          method: 'POST',
          body: { phone, code: start.testCode, name },
        });
        return r;
      };
      const a = await login(phoneA, 'Admin'),
        b = await login(phoneB, 'Friend'),
        c = await login(phoneC, 'Uninvited');
      const tokA = a.token,
        tokB = b.token,
        tokC = c.token;
      assert.notEqual(a.user.id, b.user.id);
      const invite = await must('/v1/invites', { method: 'POST', token: tokA, body: { phone: phoneB } }, 201);
      await must('/v1/invites/' + invite.id + '/accept', { method: 'POST', token: tokC, body: {} }, 404);
      const inbox = await must('/v1/invites', { token: tokB });
      assert.ok(inbox.invitations.some((x) => x.id === invite.id));
      await must('/v1/invites/' + invite.id + '/accept', { method: 'POST', token: tokB, body: {} });
      await must('/v1/location', {
        method: 'POST',
        token: tokB,
        body: { lat: 40.71, lng: -74.05, battery: 88 },
      });
      let contacts = await must('/v1/family/contacts', { token: tokA });
      assert.equal(contacts.contacts.find((x) => x.id === b.user.id).latitude, 40.71);
      await must('/v1/family/contacts/' + b.user.id + '/history', { token: tokA });
      await must('/v1/family/contacts/' + b.user.id + '/history', { token: tokC }, 403);
      await must('/v1/family/sharing', { method: 'POST', token: tokB, body: { enabled: false } });
      await must('/v1/family/contacts/' + b.user.id + '/history', { token: tokA }, 403);
      contacts = await must('/v1/family/contacts', { token: tokA });
      assert.equal(contacts.contacts[0].latitude, null);
      await must('/v1/location', { method: 'POST', token: tokB, body: { lat: 40.71, lng: -74.05 } }, 403);
      await must('/v1/family/sharing', { method: 'POST', token: tokB, body: { enabled: true } });
      const zone = await must(
        '/v1/zones',
        {
          method: 'POST',
          token: tokA,
          body: { subjectId: b.user.id, name: 'Home', lat: 40.7, lng: -74, radiusM: 250 },
        },
        201,
      );
      assert.ok(zone.zone.id);
      await must('/v1/location', { method: 'POST', token: tokB, body: { lat: 40.71, lng: -74.05 } });
      await must('/v1/location', { method: 'POST', token: tokB, body: { lat: 40.7, lng: -74 } });
      const alerts = await must('/v1/alerts', { token: tokA });
      assert.ok(alerts.alerts.some((x) => x.message.includes('entered')));
      const reverse = await must(
        '/v1/invites',
        { method: 'POST', token: tokB, body: { phone: phoneA } },
        201,
      );
      await must('/v1/invites/' + reverse.id + '/accept', { method: 'POST', token: tokA, body: {} });
      await must('/v1/location', {
        method: 'POST',
        token: tokA,
        body: { lat: 40.75, lng: -74.02, battery: 66 },
      });
      contacts = await must('/v1/family/contacts', { token: tokB });
      assert.equal(contacts.contacts.find((x) => x.id === a.user.id).latitude, 40.75);
      const hist = await must('/v1/family/contacts/' + a.user.id + '/history', { token: tokB });
      assert.ok(hist.history.length >= 1);
      await must('/v1/family/sharing', { method: 'POST', token: tokA, body: { enabled: false } });
      await must('/v1/family/contacts/' + a.user.id + '/history', { token: tokB }, 403);
    } finally {
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
    }
  },
);
