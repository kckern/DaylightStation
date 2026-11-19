import test from 'node:test';
import assert from 'node:assert/strict';
import { QuickInputLedger, quickInputLimits, ATTEMPTS_PER_INPUT } from './QuickInputLedger.mjs';

const DAY = 24 * 60 * 60 * 1000;
const MB = 1024 * 1024;
const START = Date.UTC(2026, 10, 18, 20, 0, 0);
// 20:00 UTC on 18 Nov is 12:00 in Los Angeles: twelve hours to local midnight.
const TWELVE_HOURS = 12 * 60 * 60;

function memoryStore(files = new Map()) {
  return {
    files,
    read: (username) => (files.has(username) ? structuredClone(files.get(username)) : null),
    write: (username, data) => { files.set(username, structuredClone(data)); return true; },
  };
}

function build({ store = memoryStore(), ...options } = {}) {
  const time = { now: START };
  const ledger = new QuickInputLedger({ store, clock: () => time.now, ...options });
  return { ledger, store, time };
}

test('an input has no record until something is noted about it', () => {
  const { ledger } = build();
  assert.equal(ledger.record('user_1', 'voice', 'a1'), null);
  ledger.mark('user_1', 'voice', 'a1', { saved: true });
  assert.deepEqual(ledger.record('user_1', 'voice', 'a1'), { startedAt: new Date(START).toISOString(), saved: true });
  assert.equal(ledger.record('user_2', 'voice', 'a1'), null);
});

test('the same id under another kind is another input', () => {
  const { ledger } = build();
  ledger.mark('user_1', 'voice', 'a1', { saved: true });
  assert.equal(ledger.record('user_1', 'text', 'a1'), null);
  assert.equal(ledger.record('user_1', 'photo', 'a1'), null);
});

test('records older than 35 days are dropped when the ledger is next written', () => {
  const { ledger, time } = build();
  ledger.mark('user_1', 'voice', 'old', { saved: true });
  time.now += 36 * DAY;
  ledger.mark('user_1', 'voice', 'new', { saved: true });
  assert.equal(ledger.record('user_1', 'voice', 'old'), null);
  assert.ok(ledger.record('user_1', 'voice', 'new'));
});

test('a processing attempt counts the input, its bytes and the attempt', () => {
  const { ledger } = build({ limits: { inputs: 2, bytes: 10 * MB } });
  assert.deepEqual(ledger.admission('user_1', 'photo', 'p1', MB), { allowed: true });
  ledger.countAttempt('user_1', 'photo', 'p1', MB);
  assert.deepEqual(ledger.usage('user_1'), { inputs: 1, bytes: MB, attempts: 1 });
  assert.equal(ledger.record('user_1', 'photo', 'p1').saved, false);
});

test('an attempt that only finishes replies counts as an attempt and nothing else', () => {
  const { ledger } = build();
  ledger.countAttempt('user_1', 'voice', 'a1', MB);
  ledger.mark('user_1', 'voice', 'a1', { saved: true });
  ledger.countAttempt('user_1', 'voice', 'a1', MB, { processing: false });
  assert.deepEqual(ledger.usage('user_1'), { inputs: 1, bytes: MB, attempts: 2 });
  assert.equal(ledger.record('user_1', 'voice', 'a1').saved, true);
});

test('kinds share one daily count of inputs', () => {
  const { ledger } = build({ limits: { inputs: 2, bytes: 10 * MB } });
  ledger.countAttempt('user_1', 'voice', 'a', 1);
  ledger.countAttempt('user_1', 'text', 'b', 1);
  assert.deepEqual(ledger.admission('user_1', 'photo', 'c', 1), {
    allowed: false, limit: 'inputs', retryAfterSeconds: TWELVE_HOURS,
  });
  assert.deepEqual(ledger.admission('user_2', 'photo', 'c', 1), { allowed: true });
});

test('past the byte limit the next attempt is refused', () => {
  const { ledger } = build({ limits: { inputs: 60, bytes: 3 * MB } });
  ledger.countAttempt('user_1', 'voice', 'a', MB);
  ledger.countAttempt('user_1', 'voice', 'a', MB);
  assert.deepEqual(ledger.admission('user_1', 'voice', 'a', MB), { allowed: true });
  assert.equal(ledger.admission('user_1', 'voice', 'a', MB + 1).limit, 'bytes');
});

test('retries of one small input cannot go on all day', () => {
  const { ledger } = build({ limits: { inputs: 2, bytes: 10 * MB } });
  for (let attempt = 0; attempt < 2 * ATTEMPTS_PER_INPUT; attempt += 1) {
    assert.deepEqual(ledger.admission('user_1', 'voice', 'a', 1), { allowed: true });
    ledger.countAttempt('user_1', 'voice', 'a', 1);
  }
  assert.equal(ledger.admission('user_1', 'voice', 'a', 1).limit, 'inputs');
});

test('a saved input is held to the attempts only, and one with an outcome to nothing', () => {
  const { ledger } = build({ limits: { inputs: 1, bytes: MB } });
  ledger.countAttempt('user_1', 'voice', 'a', MB);
  ledger.mark('user_1', 'voice', 'a', { saved: true });
  assert.deepEqual(ledger.admission('user_1', 'voice', 'a', MB), { allowed: true });
  for (let attempt = 1; attempt < ATTEMPTS_PER_INPUT; attempt += 1) {
    ledger.countAttempt('user_1', 'voice', 'a', 0, { processing: false });
  }
  assert.equal(ledger.admission('user_1', 'voice', 'a', 0).allowed, false);

  ledger.mark('user_1', 'text', 'b', { outcome: 'unusable_input' });
  assert.deepEqual(ledger.admission('user_1', 'text', 'b', 1), { allowed: true });
});

test('the count is in the store, survives a restart, and starts again on a new local day', () => {
  const first = build({ limits: { inputs: 1, bytes: 10 * MB } });
  first.ledger.countAttempt('user_1', 'voice', 'a', MB);
  const second = build({ store: first.store, limits: { inputs: 1, bytes: 10 * MB } });
  assert.equal(second.ledger.admission('user_1', 'voice', 'b', 1).allowed, false);
  second.time.now += TWELVE_HOURS * 1000 + 1000;
  assert.deepEqual(second.ledger.admission('user_1', 'voice', 'b', 1), { allowed: true });
  assert.deepEqual(second.ledger.usage('user_1'), { inputs: 0, bytes: 0, attempts: 0 });
});

test('the day follows the timezone it is given', () => {
  // 20:00 UTC is 05:00 the next day in Tokyo: nineteen hours to midnight there.
  const { ledger } = build({ limits: { inputs: 0 }, timezone: () => 'Asia/Tokyo' });
  assert.equal(ledger.admission('user_1', 'voice', 'a', 1).retryAfterSeconds, 19 * 60 * 60);
});

test('the defaults are 60 inputs and 200 MB a day', () => {
  const { ledger } = build();
  for (let i = 0; i < 60; i += 1) ledger.countAttempt('user_1', 'text', `t${i}`, 1);
  assert.equal(ledger.admission('user_1', 'text', 'one-more', 1).limit, 'inputs');
  const other = build();
  other.ledger.countAttempt('user_1', 'voice', 'big', 200 * MB);
  assert.equal(other.ledger.admission('user_1', 'voice', 'next', 1).limit, 'bytes');
});

test('the limits come from config, the earlier voice memo keys still count, and a bad value leaves the default', () => {
  assert.deepEqual(quickInputLimits({ daily_inputs: 10, daily_megabytes: 50 }), { inputs: 10, bytes: 50 * MB });
  assert.deepEqual(quickInputLimits({ daily_inputs: 0, daily_megabytes: 'lots' }), {});
  assert.deepEqual(quickInputLimits(undefined), {});
  assert.deepEqual(quickInputLimits(null, null), {});
  assert.deepEqual(quickInputLimits(undefined, { daily_memos: 5, daily_megabytes: 20 }), { inputs: 5, bytes: 20 * MB });
  assert.deepEqual(quickInputLimits({ daily_inputs: 9 }, { daily_memos: 5, daily_megabytes: 20 }), { inputs: 9, bytes: 20 * MB });
});

test('the store is required', () => {
  assert.throws(() => new QuickInputLedger({}), /store/);
});

test('a refused progress write fails the attempt', () => {
  const { ledger } = build({ store: { read: () => null, write: () => false } });
  assert.throws(() => ledger.mark('user', 'text', 'id', { saved: true }), /ledger write failed/);
  assert.throws(() => ledger.countAttempt('user', 'text', 'id', 10), /ledger write failed/);
});
