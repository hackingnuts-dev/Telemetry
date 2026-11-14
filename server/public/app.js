(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = {
    token: sessionStorage.getItem('telemetry.family.session') || '',
    user: null,
    contacts: [],
    selected: null,
    ws: null,
    map: null,
    markers: new Map(),
    route: null,
  };
  const status = (message, id = 'message') => {
    $(id).textContent = message || '';
  };
  const api = async (path, method = 'GET', body, withAuth = true) => {
    const r = await fetch(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(withAuth && state.token ? { Authorization: 'Bearer ' + state.token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(data.error || 'Request failed (' + r.status + ')');
    return data;
  };
  const action = (fn) => async (e) => {
    e?.preventDefault?.();
    try {
      await fn();
    } catch (err) {
      status(err.message);
    }
  };
  const add = (parent, tag, text, cls) => {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    parent.appendChild(e);
    return e;
  };
  const when = (t) => (t ? new Date(t).toLocaleString() : 'No recent location');
  function mapSetup() {
    if (state.map) return;
    state.map = L.map('map').setView([39.5, -98.4], 4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors',
    }).addTo(state.map);
  }
  async function boot() {
    if (!state.token) return;
    const me = await api('/v1/me');
    state.user = me.user;
    $('login').hidden = true;
    $('workspace').hidden = false;
    $('logout').hidden = false;
    $('whoami').textContent = state.user.name + ' · ' + state.user.phone;
    $('shareToggle').checked = state.user.sharingEnabled;
    mapSetup();
    await reload();
    await connect();
    setInterval(() => {
      if (state.user) void reload().catch(() => {});
    }, 30000);
  }
  async function connect() {
    if (state.ws) {
      state.ws.close();
      state.ws = null;
    }
    const { ticket } = await api('/v1/live-ticket', 'POST', {});
    const ws = new WebSocket(
      location.origin.replace(/^http/, 'ws') + '/v1/live?ticket=' + encodeURIComponent(ticket),
    );
    state.ws = ws;
    ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === 'location' || msg.type === 'sharing' || msg.type === 'geofence') {
        void reload().catch(() => {});
        if (msg.type === 'geofence') status(msg.message);
      }
    });
    ws.addEventListener('close', () => {
      if (state.user) setTimeout(() => void connect().catch(() => {}), 5000);
    });
  }
  async function reload() {
    const [contacts, invitations, alerts] = await Promise.all([
      api('/v1/family/contacts'),
      api('/v1/invites'),
      api('/v1/alerts'),
    ]);
    state.contacts = contacts.contacts || [];
    const wrap = $('contacts');
    wrap.replaceChildren();
    if (!state.contacts.length)
      add(wrap, 'p', 'No contacts yet. Invite someone who agrees to share.', 'hint');
    for (const c of state.contacts) {
      const el = add(wrap, 'div', null, 'contact');
      add(el, 'strong', c.name);
      add(
        el,
        'div',
        c.sharing ? (c.online ? 'Online' : 'Not recently updated') : 'Paused sharing',
        c.online ? 'muted online' : 'muted offline',
      );
      add(
        el,
        'div',
        c.sharing ? when(c.updatedAt) + ' · Battery ' + (c.battery ?? '—') + '%' : 'Coordinates hidden',
        'muted',
      );
      const btn = add(el, 'button', 'Show location', 'secondary');
      btn.disabled = !c.sharing || c.latitude == null;
      btn.onclick = () => void select(c.id);
    }
    const iw = $('invitations');
    iw.replaceChildren();
    if (!(invitations.invitations || []).length) add(iw, 'p', 'No pending invitations', 'hint');
    for (const invite of invitations.invitations || []) {
      const el = add(iw, 'div', null, 'invite');
      add(el, 'strong', invite.from_name + ' wants to see your location');
      add(el, 'p', 'Accepting turns on sharing with this person. You can pause or revoke it later.', 'hint');
      const yes = add(el, 'button', 'Accept');
      yes.onclick = () =>
        void action(async () => {
          await api('/v1/invites/' + invite.id + '/accept', 'POST', {});
          const me = await api('/v1/me');
          state.user = me.user;
          $('shareToggle').checked = me.user.sharingEnabled;
          await reload();
        })();
      const no = add(el, 'button', 'Decline', 'danger');
      no.onclick = () =>
        void action(async () => {
          await api('/v1/invites/' + invite.id + '/decline', 'POST', {});
          await reload();
        })();
    }
    const aw = $('alerts');
    aw.replaceChildren();
    if (!alerts.alerts?.length) add(aw, 'p', 'No recent alerts', 'hint');
    for (const a of alerts.alerts || []) {
      const line = add(aw, 'div', null, 'alert');
      add(line, 'strong', a.message);
      add(line, 'div', when(a.created_at), 'muted');
    }
    renderMarkers();
  }
  function renderMarkers() {
    mapSetup();
    for (const m of state.markers.values()) state.map.removeLayer(m);
    state.markers.clear();
    for (const c of state.contacts) {
      if (!c.sharing || c.latitude == null || c.longitude == null) continue;
      const marker = L.marker([c.latitude, c.longitude])
        .addTo(state.map)
        .bindPopup(c.name + ' · ' + when(c.updatedAt));
      marker.on('click', () => void select(c.id));
      state.markers.set(c.id, marker);
    }
  }
  async function select(id) {
    const c = state.contacts.find((x) => x.id === id);
    if (!c || !c.sharing || c.latitude == null) return;
    state.selected = id;
    state.map.setView([c.latitude, c.longitude], 15);
    $('mapStatus').textContent = c.name + ' · ' + when(c.updatedAt);
    const { history } = await api('/v1/family/contacts/' + id + '/history');
    if (state.route) state.map.removeLayer(state.route);
    const coords = history.map((p) => [p.lat, p.lng]);
    if (coords.length > 1) {
      state.route = L.polyline(coords, { color: '#2563eb', weight: 4 }).addTo(state.map);
      state.map.fitBounds(state.route.getBounds(), { padding: [30, 30] });
    }
    $('historyText').textContent =
      history.length +
      ' shared points over the last 24 hours. The path disappears if this contact pauses sharing.';
    $('zoneLat').value = String(c.latitude);
    $('zoneLng').value = String(c.longitude);
  }
  $('phoneForm').addEventListener(
    'submit',
    action(async () => {
      const p = $('phone').value.trim();
      await api('/v1/auth/start', 'POST', { phone: p }, false);
      $('codeForm').hidden = false;
      status('Verification code sent.', 'authMessage');
    }),
  );
  $('codeForm').addEventListener(
    'submit',
    action(async () => {
      const r = await api(
        '/v1/auth/verify',
        'POST',
        { phone: $('phone').value.trim(), code: $('code').value.trim(), name: $('name').value.trim() },
        false,
      );
      state.token = r.token;
      sessionStorage.setItem('telemetry.family.session', r.token);
      await boot();
    }),
  );
  $('logout').onclick = () =>
    void action(async () => {
      try {
        await api('/v1/auth/logout', 'POST', {});
      } finally {
        sessionStorage.removeItem('telemetry.family.session');
        location.reload();
      }
    })();
  $('shareToggle').onchange = () =>
    void action(async () => {
      const r = await api('/v1/family/sharing', 'POST', { enabled: $('shareToggle').checked });
      state.user = r.user;
      status(
        r.user.sharingEnabled ? 'You are sharing with accepted contacts.' : 'Sharing paused immediately.',
      );
    })().catch(() => {
      $('shareToggle').checked = state.user.sharingEnabled;
    });
  $('inviteForm').addEventListener(
    'submit',
    action(async () => {
      await api('/v1/invites', 'POST', { phone: $('invitePhone').value.trim() });
      $('invitePhone').value = '';
      status('SMS invite sent. It will not enable sharing until accepted.');
    }),
  );
  $('zoneForm').addEventListener(
    'submit',
    action(async () => {
      if (!state.selected) throw Error('Select a sharing contact first');
      await api('/v1/zones', 'POST', {
        subjectId: state.selected,
        name: $('zoneName').value,
        lat: Number($('zoneLat').value),
        lng: Number($('zoneLng').value),
        radiusM: Number($('zoneRadius').value),
      });
      status('Safe zone created for accepted contact');
    }),
  );
  $('refresh').onclick = () =>
    void action(async () => {
      await reload();
      if (state.selected) await select(state.selected);
    })();
  if (state.token)
    void boot().catch(() => {
      sessionStorage.removeItem('telemetry.family.session');
      location.reload();
    });
})();
