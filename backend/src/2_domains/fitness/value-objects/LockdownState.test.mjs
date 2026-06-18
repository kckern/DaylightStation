import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LockdownState } from './LockdownState.mjs';

test('isActive is true before lockedUntil and false at/after it', () => {
  const s = LockdownState.create({ lockedBy: 'alice', durationSec: 1800, now: 1000 });
  assert.equal(s.lockedAt, 1000);
  assert.equal(s.lockedUntil, 1000 + 1800);
  assert.equal(s.isActive(1000), true);
  assert.equal(s.isActive(1000 + 1799), true);
  assert.equal(s.isActive(1000 + 1800), false);
  assert.equal(s.isActive(1000 + 5000), false);
});

test('is immutable and round-trips through toData/fromData', () => {
  const s = LockdownState.create({ lockedBy: 'bob', durationSec: 60, now: 500 });
  assert.throws(() => { s.lockedBy = 'mallory'; });
  const again = LockdownState.fromData(s.toData());
  assert.deepEqual(again.toData(), s.toData());
});

test('create rejects bad input', () => {
  assert.throws(() => LockdownState.create({ lockedBy: '', durationSec: 60, now: 1 }));
  assert.throws(() => LockdownState.create({ lockedBy: 'a', durationSec: 0, now: 1 }));
});
