import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoLedger, memoLimits } from './MemoLedger.mjs';

const DAY = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 10, 18, 20, 0, 0);

function memoryStore(files = new Map()) {
  return {
    files,
    read: (username) => (files.has(username) ? structuredClone(files.get(username)) : null),
    write: (username, data) => { files.set(username, structuredClone(data)); return true; },
  };
}

function build({ store = memoryStore(), ...options } = {}) {
  const time = { now: START };
  const ledger = new MemoLedger({ store, clock: () => time.now, ...options });
  return { ledger, store, time };
}

test('a memo has no record until something is noted about it', () => {
  const { ledger } = build();
  assert.equal(ledger.record('user_1', 'm1'), null);
  ledger.mark('user_1', 'm1', { saved: true });
  assert.deepEqual(ledger.record('user_1', 'm1'), { startedAt: new Date(START).toISOString(), saved: true });
  assert.equal(ledger.record('user_2', 'm1'), null);
});

test('progress adds up and the start time stays', () => {
  const { ledger, time } = build();
  ledger.mark('user_1', 'm1', { saved: true });
  time.now += 60_000;
  ledger.mark('user_1', 'm1', { echoSent: true });
  assert.deepEqual(ledger.record('user_1', 'm1'), {
    startedAt: new Date(START).toISOString(), saved: true, echoSent: true,
  });
});

test('the record is in the store, so another ledger over the same store sees it', () => {
  const first = build();
  first.ledger.mark('user_1', 'm1', { saved: true, echoSent: true });
  const second = build({ store: first.store });
  assert.equal(second.ledger.record('user_1', 'm1').echoSent, true);
});

test('records older than 35 days are dropped when the ledger is next written', () => {
  const { ledger, time } = build();
  ledger.mark('user_1', 'old', { saved: true });
  time.now += 36 * DAY;
  ledger.mark('user_1', 'new', { saved: true });
  assert.equal(ledger.record('user_1', 'old'), null);
  assert.ok(ledger.record('user_1', 'new'));
});

test('the store is required', () => {
  assert.throws(() => new MemoLedger({}), /store/);
});

// ---- daily allowance ----

const MB = 1024 * 1024;
// 20:00 UTC on 18 Nov is 12:00 in Los Angeles: twelve hours to local midnight.
const TWELVE_HOURS = 12 * 60 * 60;

test('a new memo is admitted and counted when its transcription starts', () => {
  const { ledger } = build({ limits: { memos: 2, bytes: 10 * MB } });
  assert.deepEqual(ledger.admission('user_1', 'm1', MB), { allowed: true });
  ledger.countTranscription('user_1', 'm1', MB);
  assert.deepEqual(ledger.usage('user_1'), { memos: 1, bytes: MB });
  assert.equal(ledger.record('user_1', 'm1').saved, false);
});

test('past the memo count a new memo is refused until local midnight', () => {
  const { ledger } = build({ limits: { memos: 2, bytes: 10 * MB } });
  ledger.countTranscription('user_1', 'm1', 1);
  ledger.countTranscription('user_1', 'm2', 1);
  assert.deepEqual(ledger.admission('user_1', 'm3', 1), {
    allowed: false, limit: 'memos', retryAfterSeconds: TWELVE_HOURS,
  });
  // Another user has their own day.
  assert.deepEqual(ledger.admission('user_2', 'm3', 1), { allowed: true });
});

test('a memo already counted today is not counted against the memo limit again', () => {
  const { ledger } = build({ limits: { memos: 1, bytes: 10 * MB } });
  ledger.countTranscription('user_1', 'm1', MB);
  assert.deepEqual(ledger.admission('user_1', 'm1', MB), { allowed: true });
  ledger.countTranscription('user_1', 'm1', MB);
  assert.deepEqual(ledger.usage('user_1'), { memos: 1, bytes: 2 * MB });
});

test('every transcription attempt spends bytes, and past the byte limit the next is refused', () => {
  const { ledger } = build({ limits: { memos: 60, bytes: 3 * MB } });
  ledger.countTranscription('user_1', 'm1', MB);
  ledger.countTranscription('user_1', 'm1', MB);
  assert.deepEqual(ledger.admission('user_1', 'm1', MB), { allowed: true });
  assert.deepEqual(ledger.admission('user_1', 'm1', MB + 1), {
    allowed: false, limit: 'bytes', retryAfterSeconds: TWELVE_HOURS,
  });
});

test('a memo that will not be transcribed again is admitted whatever the day has used', () => {
  const { ledger } = build({ limits: { memos: 1, bytes: MB } });
  ledger.countTranscription('user_1', 'm1', MB);
  ledger.mark('user_1', 'm1', { saved: true });
  ledger.countTranscription('user_1', 'm2', 1);
  ledger.mark('user_1', 'm2', { outcome: 'empty' });
  assert.deepEqual(ledger.admission('user_1', 'm1', MB), { allowed: true });
  assert.deepEqual(ledger.admission('user_1', 'm2', MB), { allowed: true });
  assert.equal(ledger.admission('user_1', 'm3', 1).allowed, false);
});

test('the count is in the store and survives a restart', () => {
  const first = build({ limits: { memos: 1, bytes: 10 * MB } });
  first.ledger.countTranscription('user_1', 'm1', MB);
  const second = build({ store: first.store, limits: { memos: 1, bytes: 10 * MB } });
  assert.equal(second.ledger.admission('user_1', 'm2', 1).allowed, false);
});

test('a new local day starts a new count', () => {
  const { ledger, time } = build({ limits: { memos: 1, bytes: 10 * MB } });
  ledger.countTranscription('user_1', 'm1', MB);
  assert.equal(ledger.admission('user_1', 'm2', 1).allowed, false);
  time.now += TWELVE_HOURS * 1000 + 1000;
  assert.deepEqual(ledger.admission('user_1', 'm2', 1), { allowed: true });
  assert.deepEqual(ledger.usage('user_1'), { memos: 0, bytes: 0 });
});

test('the day follows the timezone it is given', () => {
  // 20:00 UTC is 05:00 the next day in Tokyo: nineteen hours to midnight there.
  const { ledger } = build({ limits: { memos: 0, bytes: MB }, timezone: () => 'Asia/Tokyo' });
  assert.equal(ledger.admission('user_1', 'm1', 1).retryAfterSeconds, 19 * 60 * 60);
});

test('the defaults are 60 memos and 200 MB a day', () => {
  const { ledger } = build();
  for (let i = 0; i < 60; i += 1) ledger.countTranscription('user_1', `m${i}`, 1);
  assert.equal(ledger.admission('user_1', 'one-more', 1).limit, 'memos');
  const other = build();
  other.ledger.countTranscription('user_1', 'big', 200 * MB);
  assert.equal(other.ledger.admission('user_1', 'next', 1).limit, 'bytes');
});

test('the limits come from config, and a bad value leaves the default', () => {
  assert.deepEqual(memoLimits({ daily_memos: 10, daily_megabytes: 50 }), { memos: 10, bytes: 50 * MB });
  assert.deepEqual(memoLimits({ daily_memos: 0, daily_megabytes: 'lots' }), {});
  assert.deepEqual(memoLimits(undefined), {});
  assert.deepEqual(memoLimits(null), {});
  const { ledger } = build({ limits: memoLimits({ daily_memos: -1 }) });
  ledger.countTranscription('user_1', 'm1', 1);
  assert.deepEqual(ledger.admission('user_1', 'm2', 1), { allowed: true });
});
