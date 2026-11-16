export interface Env {
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
      try {
        await env.DB.prepare('SELECT 1').first();
        return Response.json({ ok: true, database: 'connected', backend: 'not-yet-ported' });
      } catch {
        return Response.json({ ok: false, database: 'unavailable' }, { status: 503 });
      }
    }
    // Fail closed until SMS OTP, sessions, ACLs and geofence handlers
    // have been ported and tested from server/server.mjs.
    return Response.json({ error: 'Telemetry Family API is not deployed yet' }, { status: 503 });
  },
} satisfies ExportedHandler<Env>;
