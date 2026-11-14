/** Pure platform-independent validation for the OS-driven location task. */
export const LOCATION_SAMPLE_INTERVAL_MS = 5 * 60_000;
export const LOCATION_ACCURACY_CEILING_M = 150;

export type PositionSample = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  recordedAt: number;
};

export function isUsableLocation(fix: PositionSample, nowMs: number): boolean {
  return (
    Number.isFinite(fix.latitude) &&
    Math.abs(fix.latitude) <= 90 &&
    Number.isFinite(fix.longitude) &&
    Math.abs(fix.longitude) <= 180 &&
    Number.isFinite(fix.recordedAt) &&
    fix.recordedAt > 0 &&
    fix.recordedAt <= nowMs + 60_000 &&
    fix.recordedAt >= nowMs - 60 * 60_000 &&
    (fix.accuracy === null ||
      (Number.isFinite(fix.accuracy) && fix.accuracy >= 0 && fix.accuracy <= LOCATION_ACCURACY_CEILING_M))
  );
}

/** An OS task may wake late; this is minimum spacing, not a 5-minute delivery guarantee. */
export function shouldProcessLocation(recordedAt: number, lastProcessedAt: number): boolean {
  return (
    recordedAt > lastProcessedAt &&
    (lastProcessedAt === 0 || recordedAt - lastProcessedAt >= LOCATION_SAMPLE_INTERVAL_MS)
  );
}

export function hasStationaryDwell(
  stationarySince: number | null,
  recordedAt: number,
  alreadyReported: boolean,
  durationMs = 30 * 60_000,
): boolean {
  return stationarySince !== null && !alreadyReported && recordedAt - stationarySince >= durationMs;
}
