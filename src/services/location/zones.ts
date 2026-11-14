import { getState, putState } from '../../core/database';

export type Zone = { id: string; latitude: number; longitude: number; radiusMeters: number };

/** Zones are administrator-provisioned and may be empty; never include user locations in source. */
export async function getZones(): Promise<Zone[]> {
  const data = await getState('approved_zones');
  if (!data) return [];
  try {
    return JSON.parse(data) as Zone[];
  } catch {
    return [];
  }
}

export async function setApprovedZones(zones: Zone[]): Promise<void> {
  if (
    !zones.every(
      (z) =>
        z.id &&
        Number.isFinite(z.latitude) &&
        Number.isFinite(z.longitude) &&
        z.radiusMeters >= 100 &&
        z.radiusMeters <= 100_000,
    )
  ) {
    throw new Error('Invalid approved geofence policy');
  }
  await putState('approved_zones', JSON.stringify(zones));
}

export function metersBetween(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const aa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 12_742_000 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
}

/** Avoid crossing-zone events when measurement uncertainty overlaps a boundary. */
export function resolveZone(
  position: { latitude: number; longitude: number; accuracy: number | null },
  zones: Zone[],
  prior: string | null,
): string | null {
  const uncertainty = Math.min(Math.max(position.accuracy ?? 0, 0), 100);
  for (const zone of zones) {
    const distance = metersBetween(position, zone);
    if (distance <= zone.radiusMeters - uncertainty) return zone.id;
    if (prior === zone.id && distance <= zone.radiusMeters + uncertainty + 40) return prior;
  }
  return null;
}
