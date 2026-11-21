import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { keyName, interpretLine, startRemoteKeys } from '../src/remoteKeys.mjs';

test('kernel codes map to browser key names', () => {
  assert.equal(keyName(115), 'AudioVolumeUp');
  assert.equal(keyName(164), 'MediaPlayPause');
  assert.equal(keyName(163), 'MediaTrackNext');
  assert.equal(keyName(30), 'a');
  assert.equal(keyName(103), 'ArrowUp');
  assert.equal(keyName(999), 'Unidentified(999)');
});

test('a key press is logged at info and sent with the address', () => {
  const { log, bus } = interpretLine(JSON.stringify({ type: 'key', address: '91:77:21:0a:f1:98', name: 'QXS-001 Keyboard', code: 115, scan: 0xc00e9, state: 'down' }));
  assert.deepEqual(log, ['info', 'bt.remote.key', bus]);
  assert.deepEqual(bus, { address: '91:77:21:0A:F1:98', name: 'QXS-001 Keyboard', code: 115, key: 'AudioVolumeUp', usage: '0xc00e9', state: 'down' });
});

test('releases are debug; unmapped reports warn and are not sent', () => {
  assert.equal(interpretLine(JSON.stringify({ type: 'key', address: 'AA:BB:CC:DD:EE:FF', code: 115, state: 'up' })).log[0], 'debug');
  const u = interpretLine(JSON.stringify({ type: 'unmapped', address: 'aa:bb:cc:dd:ee:ff', report: '02 40' }));
  assert.deepEqual(u, { log: ['warn', 'bt.remote.unmapped', { address: 'AA:BB:CC:DD:EE:FF', report: '02 40' }], bus: null });
  assert.deepEqual(interpretLine('not json'), { log: null, bus: null });
  assert.deepEqual(interpretLine(JSON.stringify({ type: 'key', code: 1 })), { log: null, bus: null });
});

test('helper lines split across chunks become one event each', () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
  const logs = []; const sent = [];
  const r = startRemoteKeys({ spawn: () => child, logEvent: (...a) => logs.push(a), send: (t, p) => sent.push([t, p]), logger: null });
  const line = JSON.stringify({ type: 'key', address: '9D:28:06:79:F3:A5', code: 114, state: 'down' });
  child.stdout.emit('data', Buffer.from(line.slice(0, 10)));
  child.stdout.emit('data', Buffer.from(line.slice(10) + '\n' + JSON.stringify({ type: 'gone', address: '9D:28:06:79:F3:A5', node: '/dev/input/event22' }) + '\n'));
  assert.deepEqual(sent.map(([t, p]) => [t, p.key]), [['bt.remote.key', 'AudioVolumeDown']]);
  assert.deepEqual(logs.map((l) => l[1]), ['bt.remote.key', 'bt.remote.gone']);
  r.stop();
});
