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
    bridgeUrl: 'ws://tablet:8780/', headers: { 'X-Daylight-Token': 'tok' }, suppressRelay: false,
    WebSocketImpl: FakeWs, logger: noLog, fetchImpl: async () => ({}),
  });
  let woke = 0;
  a.start(() => { woke += 1; });
  assert.deepEqual(made[0].options, { headers: { 'X-Daylight-Token': 'tok' } });
  made[0].emit('message', Buffer.from('{"type":"note.on","note":60,"velocity":80,"t":1}'));
  assert.equal(woke, 1);
  a.stop();
});

test('with the relay off, suppressing a wake sends nothing to the device and says so once', async () => {
  const calls = [];
  const logs = [];
  const a = new PianoMidiBridgeAdapter({
    bridgeUrl: 'ws://tablet:8780/', suppressRelay: false,
    logger: { ...noLog, info: (e) => logs.push(e) },
    fetchImpl: async (...args) => { calls.push(args); return { ok: true, json: async () => ({ values: {} }) }; },
  });
  await a.suppressWakeUntil(Date.now() + 60_000);
  await a.suppressWakeUntil(Date.now() + 60_000);
  assert.equal(calls.length, 0);
  assert.deepEqual(logs, ['piano-midi-wake.suppress-relay-unsupported']);
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
