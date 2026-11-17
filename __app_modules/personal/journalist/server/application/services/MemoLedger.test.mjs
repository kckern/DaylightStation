import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoLedger } from './MemoLedger.mjs';

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
