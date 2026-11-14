import test from 'node:test';
import assert from 'node:assert/strict';
import { validPhone, validLocation, meters, canView } from '../policy.mjs';
test('requires verified international number format', () => {
  assert.equal(validPhone('+12025550123'), true);
  assert.equal(validPhone('2025550123'), false);
  assert.equal(validPhone('+00123'), false);
});
test('rejects impossible locations', () => {
  assert.equal(validLocation(40, -74, 10), true);
  assert.equal(validLocation(95, -74, 10), false);
  assert.equal(validLocation(40, -181, 10), false);
});
test('distance calculation', () => {
  assert.equal(meters({ lat: 0, lng: 0 }, { lat: 0, lng: 0 }), 0);
  assert.ok(meters({ lat: 0, lng: 0 }, { lat: 0.01, lng: 0 }) > 1000);
});
test('accepted consent AND sharing needed', () => {
  const s = { id: 'b', sharing_enabled: false };
  assert.equal(canView(s, 'a', true), false);
  s.sharing_enabled = true;
  assert.equal(canView(s, 'a', false), false);
  assert.equal(canView(s, 'a', true), true);
  s.sharing_enabled = false;
  assert.equal(canView(s, 'a', true), false);
});
