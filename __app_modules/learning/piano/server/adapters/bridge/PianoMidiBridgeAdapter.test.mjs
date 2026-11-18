import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PianoMidiBridgeAdapter } from './PianoMidiBridgeAdapter.mjs';

function fakeWs() {
  const made = [];
  class FakeWs extends EventEmitter {
    constructor(url, options) { super(); this.url = url; this.options = options; made.push(this); }
    close() {}
  }
  return { FakeWs, made };
}
const noLog = { info() {}, warn() {}, debug() {}, error() {} };

test('the old bridge: the socket opens with no options and a note.on wakes', () => {
  const { FakeWs, made } = fakeWs();
  const a = new PianoMidiBridgeAdapter({ bridgeUrl: 'ws://tablet:8770', WebSocketImpl: FakeWs, logger: noLog, fetchImpl: async () => ({}) });
  let woke = 0;
  a.start(() => { woke += 1; });
  assert.equal(made[0].url, 'ws://tablet:8770');
  assert.equal(made[0].options, undefined);
  made[0].emit('message', Buffer.from('{"type":"note.on","note":60}'));
  assert.equal(woke, 1);
  a.stop();
});

test('the Android app: the upgrade carries the token header, and its note.on wakes the same way', () => {
  const { FakeWs, made } = fakeWs();
  const a = new PianoMidiBridgeAdapter({
    bridgeUrl: 'ws://tablet:8780/', headers: { 'X-Daylight-Token': 'tok' }, relay: 'setting',
    WebSocketImpl: FakeWs, logger: noLog, fetchImpl: async () => ({}),
  });
  let woke = 0;
  a.start(() => { woke += 1; });
  assert.deepEqual(made[0].options, { headers: { 'X-Daylight-Token': 'tok' } });
  made[0].emit('message', Buffer.from('{"type":"note.on","note":60,"velocity":80,"t":1}'));
  assert.equal(woke, 1);
  a.stop();
});

test('the Android app: a suppress deadline is set as power.wakeSuppressUntilSec through POST /settings', async () => {
  const calls = [];
  const a = new PianoMidiBridgeAdapter({
    bridgeUrl: 'ws://tablet:8780/', headers: { 'X-Daylight-Token': 'tok' }, relay: 'setting',
    logger: noLog, now: () => 1_800_000_000_000,
    fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ ok: true }) }; },
  });
  await a.suppressWakeUntil(1_800_000_000_000 + 30 * 60_000 + 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://tablet:8780/settings');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['X-Daylight-Token'], 'tok');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  // Rounded up to the next whole second, so the hold never ends early.
  assert.deepEqual(JSON.parse(calls[0].init.body), { key: 'power.wakeSuppressUntilSec', value: 1_800_001_801 });
});

test('the Android app: a deadline now or past clears the hold with 0, and one past 2038 is held at the maximum', async () => {
  const bodies = [];
  const a = new PianoMidiBridgeAdapter({
    bridgeUrl: 'ws://tablet:8780/', relay: 'setting', logger: noLog, now: () => 5_000_000,
    fetchImpl: async (url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ ok: true }) }; },
  });
  await a.suppressWakeUntil(5_000_000);
  await a.suppressWakeUntil(1);
  await a.suppressWakeUntil(9e15);
  assert.deepEqual(bodies.map((b) => b.value), [0, 0, 2147483647]);
});

test('the Android app: a refused or failed relay is logged, never thrown', async () => {
  const warns = [];
  const logger = { ...noLog, warn: (e, d) => warns.push([e, d]) };
  const refused = new PianoMidiBridgeAdapter({
    bridgeUrl: 'ws://tablet:8780/', relay: 'setting', logger, now: () => 0,
    fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({ ok: false, error: 'unknown_setting' }) }),
  });
  await refused.suppressWakeUntil(60_000);
  const down = new PianoMidiBridgeAdapter({
    bridgeUrl: 'ws://tablet:8780/', relay: 'setting', logger, now: () => 0,
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
  });
  await down.suppressWakeUntil(60_000);
  assert.deepEqual(warns.map((w) => w[0]), ['piano-midi-wake.suppress-relay-failed', 'piano-midi-wake.suppress-relay-failed']);
  assert.equal(warns[0][1].status, 404);
  assert.match(warns[1][1].error, /ECONNREFUSED/);
});

test('the old bridge keeps its read-merge-write relay', async () => {
  const calls = [];
  const a = new PianoMidiBridgeAdapter({
    bridgeUrl: 'ws://tablet:8770', logger: noLog,
    fetchImpl: async (url, init) => { calls.push([url, init.method]); return { ok: true, json: async () => ({ values: { targetMac: 'x' } }) }; },
  });
  await a.suppressWakeUntil(123);
  assert.deepEqual(calls, [['http://tablet:8770/config', 'GET'], ['http://tablet:8770/config', 'POST']]);
});
