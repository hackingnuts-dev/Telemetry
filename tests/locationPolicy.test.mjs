import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOCATION_SAMPLE_INTERVAL_MS,
  hasStationaryDwell,
  isUsableLocation,
  shouldProcessLocation,
} from '../src/services/location/locationPolicy.ts';

const now = 1_800_000_000_000;
const fix = { latitude: 40.728, longitude: -74.07, accuracy: 25, recordedAt: now };

test('accepts a valid location sample', () => {
  assert.equal(isUsableLocation(fix, now), true);
});
test('rejects inaccurate, future and impossible coordinates', () => {
  assert.equal(isUsableLocation({ ...fix, accuracy: 500 }, now), false);
  assert.equal(isUsableLocation({ ...fix, latitude: 91 }, now), false);
  assert.equal(isUsableLocation({ ...fix, recordedAt: now + 120_000 }, now), false);
});
test('accepts the initial fix and a fix after five minutes', () => {
  assert.equal(LOCATION_SAMPLE_INTERVAL_MS, 300_000);
  assert.equal(shouldProcessLocation(now, 0), true);
  assert.equal(shouldProcessLocation(now + 299_999, now), false);
  assert.equal(shouldProcessLocation(now + 300_000, now), true);
  assert.equal(shouldProcessLocation(now, now), false);
});
test('reports a stationary dwell once after 30 minutes', () => {
  assert.equal(hasStationaryDwell(now, now + 29 * 60_000, false), false);
  assert.equal(hasStationaryDwell(now, now + 30 * 60_000, false), true);
  assert.equal(hasStationaryDwell(now, now + 40 * 60_000, true), false);
  assert.equal(hasStationaryDwell(null, now + 40 * 60_000, false), false);
});
