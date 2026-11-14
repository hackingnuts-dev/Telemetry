import test from 'node:test';
import assert from 'node:assert/strict';
import { maskPhoneNumber, normalizePhoneNumber } from '../src/services/telephony/numberUtils.ts';

test('normalizes voluntary E.164 input and hides most digits', () => {
  assert.equal(normalizePhoneNumber('+1 (202) 555-0123'), '+12025550123');
  assert.equal(maskPhoneNumber('+12025550123'), '••• ••• 0123');
});
test('rejects malformed or non-international numbers', () => {
  for (const raw of ['2025550123', '123', '+00123456789', '+1-abc-1234', '']) {
    assert.throws(() => normalizePhoneNumber(raw));
  }
});
