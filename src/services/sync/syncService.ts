import { API_BASE_URL } from '../../core/config';
import { acknowledgeEvents, deferEvents, pendingEvents } from '../../core/database';
import { getEnterpriseToken, getInstallationId } from '../../core/identity';
import { getSettings } from '../../core/settings';

export function syncConfigured(): boolean {
  return API_BASE_URL.startsWith('https://') && !API_BASE_URL.includes('example.org');
}

export async function authorizedPost(path: string, body: object): Promise<Response> {
  if (!syncConfigured()) throw new Error('Enterprise API endpoint is not configured');
  const token = await getEnterpriseToken();
  if (!token) throw new Error('Enterprise sign-in required before syncing');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(API_BASE_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/** Retries transient failures; permanently invalid requests remain for diagnostics. */
export async function flushOutbox(): Promise<{ sent: number; reason?: string }> {
  if (!(await getSettings()).syncEnabled) return { sent: 0, reason: 'Sync is disabled' };
  if (!syncConfigured()) return { sent: 0, reason: 'Configure HTTPS API endpoint' };
  if (!(await getEnterpriseToken())) return { sent: 0, reason: 'Enterprise sign-in is not configured' };
  const rows = await pendingEvents();
  if (!rows.length) return { sent: 0 };
  const ids = rows.map((row) => row.id);
  try {
    const response = await authorizedPost('/v1/telemetry/batches', {
      deviceId: await getInstallationId(),
      batchId: ids.join(':'),
      events: rows.map((row) => JSON.parse(row.body)),
    });
    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) {
        await deferEvents(ids, Math.max(...rows.map((r) => r.retry_count)));
      }
      return { sent: 0, reason: `Server response ${response.status}` };
    }
    const data = (await response.json()) as { acknowledgedIds?: string[] };
    const accepted = (data.acknowledgedIds ?? []).filter((id) => ids.includes(id));
    await acknowledgeEvents(accepted);
    return { sent: accepted.length };
  } catch {
    await deferEvents(ids, Math.max(...rows.map((r) => r.retry_count)));
    return { sent: 0, reason: 'Network unavailable; events remain encrypted locally' };
  }
}
