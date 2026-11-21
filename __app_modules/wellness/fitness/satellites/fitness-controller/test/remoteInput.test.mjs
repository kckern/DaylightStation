import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { IRemoteInputSource, isRemoteInputSource } from '../src/remote-input/ports/IRemoteInputSource.mjs';
import { LinuxEvdevRemoteSource, keyName, kernelLineToEvent } from '../src/remote-input/adapters/LinuxEvdevRemoteSource.mjs';
import { BluezGattReportSource } from '../src/remote-input/adapters/BluezGattReportSource.mjs';
import { runHelper } from '../src/remote-input/adapters/helperProcess.mjs';
import { normalizeDecoder, decodeReport } from '../src/remote-input/reportDecoder.mjs';
import { startRemoteInput, eventToRecords } from '../src/remote-input/RemoteInputService.mjs';
import { startDecoderRefresh } from '../src/remote-input/decoderConfig.mjs';

// Made-up addresses; never a real household device.
const REMOTE_1 = 'AA:BB:CC:00:00:01';
const REMOTE_2 = 'AA:BB:CC:00:00:02';
const PAD_REMOTE = 'AA:BB:CC:00:00:03';

// A stick-and-four-buttons remote: buttons are bits of byte 0, the stick two
// 2-bit fields of byte 1 (0 / 1 centre / 2). The shape input.yml carries.
const STICK_PAD = {
  id: 'stick_pad', address: PAD_REMOTE.toLowerCase(),
  report_decoder: {
    att_handle: 0x001f,
    buttons: {
      ButtonA: { byte: 0, mask: 0x10 }, ButtonB: { byte: 0, mask: 0x01 },
      ButtonC: { byte: 0, mask: 0x08 }, ButtonD: { byte: 0, mask: 0x02 },
      TriggerCircle: { byte: 0, mask: 0x40 }, TriggerBack: { byte: 0, mask: 0x80 },
    },
    axes: [
      { byte: 1, shift: 6, bits: 2, values: { 0: 'StickUp', 2: 'StickDown' } },
      { byte: 1, shift: 4, bits: 2, values: { 0: 'StickLeft', 2: 'StickRight' } },
    ],
  },
};
// Captured report bytes (idle = 0050).
const CAPTURED = [['1052', 'ButtonA'], ['0150', 'ButtonB'], ['0851', 'ButtonC'], ['0250', 'ButtonD'],
  ['4050', 'TriggerCircle'], ['8050', 'TriggerBack'], ['0010', 'StickUp'], ['0090', 'StickDown'],
  ['0040', 'StickLeft'], ['0060', 'StickRight']];

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
  return child;
}
/** A runHelper stand-in: records the mode and lets the test push lines. */
function fakeRunner() {
  const r = { mode: null, stopped: false };
  r.run = ({ mode, onLine, onExit, onStart }) => {
    r.mode = mode; r.line = (m) => onLine(m); r.exit = (i) => onExit(i); onStart?.();
    return { stop() { r.stopped = true; } };
  };
  return r;
}

// ---- port ----------------------------------------------------------------

test('the port throws until implemented, and the guard checks the shape', () => {
  const p = new IRemoteInputSource();
  assert.throws(() => p.start({ onEvent() {} }), /must be implemented/);
  assert.throws(() => p.stop(), /must be implemented/);
  assert.equal(isRemoteInputSource(p), false); // no id
  assert.equal(isRemoteInputSource(new LinuxEvdevRemoteSource({ runHelper: fakeRunner().run })), true);
  assert.equal(isRemoteInputSource(new BluezGattReportSource({ runHelper: fakeRunner().run })), true);
  assert.equal(isRemoteInputSource({ start() {}, stop() {} }), false);
});

// ---- generic report decoder ----------------------------------------------

test('a decoder spec decodes the captured reports to distinct controls', () => {
  const dec = normalizeDecoder(STICK_PAD);
  assert.equal(dec.address, PAD_REMOTE);
  assert.equal(dec.channel, 0x1f);
  const on = (hex) => Object.entries(decodeReport(dec, (hex.match(/../g)).map((h) => parseInt(h, 16))))
    .filter(([, v]) => v).map(([k]) => k);
  assert.deepEqual(on('0050'), []);
  for (const [hex, control] of CAPTURED) assert.deepEqual(on(hex), [control], hex);
  assert.equal(decodeReport(dec, [0x10]), null, 'too short for byte 1');
});

test('specs accept hex strings and skip what they cannot use', () => {
  const d = normalizeDecoder({ address: REMOTE_1, report_decoder: { att_handle: '0x0020', buttons: { X: { byte: '0', mask: '0x04' }, Bad: { byte: 0 } } } });
  assert.deepEqual(d, { address: REMOTE_1, channel: 0x20, buttons: [{ control: 'X', byte: 0, mask: 4 }], axes: [], holdAxesWhileButtons: false });
  assert.equal(normalizeDecoder({ address: REMOTE_1, report_decoder: { att_handle: 1 } }), null, 'no controls');
  assert.equal(normalizeDecoder({ report_decoder: STICK_PAD.report_decoder }), null, 'no address');
  assert.equal(normalizeDecoder({ address: REMOTE_1 }), null);
});

// ---- BlueZ GATT report adapter (fake helper) -----------------------------

test('gatt adapter: press/release per control, matched by address only', () => {
  const r = fakeRunner();
  const src = new BluezGattReportSource({ runHelper: r.run });
  assert.equal(src.setDecoders([STICK_PAD, { id: 'junk' }]), 1);
  const events = [];
  src.start({ onEvent: (e) => events.push(e) });
  assert.equal(r.mode, 'gatt');
  const controls = (hex, address = PAD_REMOTE.toLowerCase(), att = 31) => {
    events.length = 0;
    r.line({ type: 'gatt', address, name: 'Any name', att, value: hex });
    return events.filter((e) => e.kind === 'control').map((e) => [e.control, e.state]);
  };
  assert.deepEqual(controls('0050'), []);
  for (const [hex, control] of CAPTURED) {
    assert.deepEqual(controls(hex), [[control, 'down']], hex);
    assert.deepEqual(controls('0050'), [[control, 'up']], `${hex} release`);
  }
  // Same bytes from a remote with no decoder: reported raw, never decoded.
  assert.deepEqual(controls('1052', REMOTE_2), []);
  assert.deepEqual(events.map((e) => e.kind), ['report']);
  // Another channel on the decoded remote: raw only.
  assert.deepEqual(controls('04', PAD_REMOTE, 0x17), []);
  src.stop();
  assert.equal(r.stopped, true);
});

test('gatt adapter: normalized event shape, unavailable and exit', () => {
  const r = fakeRunner();
  const src = new BluezGattReportSource({ runHelper: r.run, decoders: [STICK_PAD] });
  const events = [];
  src.start({ onEvent: (e) => events.push(e) });
  r.line({ type: 'gatt', address: PAD_REMOTE.toLowerCase(), name: 'Any name', att: 31, value: '4050' });
  assert.deepEqual(events, [
    { kind: 'report', source: 'gatt', address: PAD_REMOTE, name: 'Any name', channel: '0x001f', raw: '4050' },
    { kind: 'control', source: 'gatt', address: PAD_REMOTE, name: 'Any name', control: 'TriggerCircle', state: 'down', code: null, usage: 'gatt:0x001f', raw: '4050' },
  ]);
  events.length = 0;
  r.line({ type: 'monitor-unavailable' });
  r.exit({ code: 1, signal: null, restartInMs: 1000 });
  assert.deepEqual(events, [{ kind: 'unavailable', source: 'gatt' },
    { kind: 'source-exit', source: 'gatt', code: 1, signal: null, restartInMs: 1000 }]);
});

// A remote whose button reports hide the stick (the stick reads centre while a
// button is down), declared by `axes_hold_while_buttons`.
const HIDING_PAD = { ...STICK_PAD, report_decoder: { ...STICK_PAD.report_decoder, axes_hold_while_buttons: true } };

/** Feed hex reports through a gatt adapter; return [control, state] pairs. */
function playReports(decoder, reports) {
  const r = fakeRunner();
  const src = new BluezGattReportSource({ runHelper: r.run, decoders: [decoder] });
  const out = [];
  src.start({ onEvent: (e) => { if (e.kind === 'control') out.push([e.control, e.state]); } });
  for (const value of reports) r.line({ type: 'gatt', address: PAD_REMOTE, att: 31, value });
  return out;
}

test('axes_hold_while_buttons: a held stick survives button taps (captured: hold right, tap trigger twice, let go)', () => {
  assert.deepEqual(playReports(HIDING_PAD, ['0060', '4050', '0060', '4050', '0050']), [
    ['StickRight', 'down'],
    ['TriggerCircle', 'down'],
    ['TriggerCircle', 'up'],
    ['TriggerCircle', 'down'],
    ['TriggerCircle', 'up'], ['StickRight', 'up'], // released together: the stick was centred too
  ]);
});

test('axes_hold_while_buttons: hold left, tap A (captured 0040 1052 0040)', () => {
  assert.deepEqual(playReports(HIDING_PAD, ['0040', '1052', '0040', '0050']), [
    ['StickLeft', 'down'], ['ButtonA', 'down'], ['ButtonA', 'up'], ['StickLeft', 'up'],
  ]);
});

test('axes_hold_while_buttons: a stick already let go is not brought back by a button', () => {
  assert.deepEqual(playReports(HIDING_PAD, ['0060', '0050', '4050', '0050']), [
    ['StickRight', 'down'], ['StickRight', 'up'], ['TriggerCircle', 'down'], ['TriggerCircle', 'up'],
  ]);
});

test('axes_hold_while_buttons: a stick moved to another direction during a button wins once the button is up', () => {
  assert.deepEqual(playReports(HIDING_PAD, ['0060', '4050', '0040']), [
    // one report's changes come out in spec order, as for any direction change
    ['StickRight', 'down'], ['TriggerCircle', 'down'], ['TriggerCircle', 'up'], ['StickLeft', 'down'], ['StickRight', 'up'],
  ]);
});

test('without axes_hold_while_buttons the stick follows each report as before', () => {
  assert.deepEqual(playReports(STICK_PAD, ['0060', '4050', '0060']), [
    ['StickRight', 'down'], ['TriggerCircle', 'down'], ['StickRight', 'up'], ['TriggerCircle', 'up'], ['StickRight', 'down'],
  ]);
});

// ---- Linux evdev adapter (fake helper) -----------------------------------

test('kernel codes map to browser key names', () => {
  assert.equal(keyName(115), 'AudioVolumeUp');
  assert.equal(keyName(164), 'MediaPlayPause');
  assert.equal(keyName(163), 'MediaTrackNext');
  assert.equal(keyName(30), 'a');
  assert.equal(keyName(103), 'ArrowUp');
  assert.equal(keyName(999), 'Unidentified(999)');
});

test('evdev adapter: helper lines become normalized events', () => {
  const r = fakeRunner();
  const src = new LinuxEvdevRemoteSource({ runHelper: r.run });
  const events = [];
  src.start({ onEvent: (e) => events.push(e) });
  assert.equal(r.mode, 'kernel');
  r.line({ type: 'key', address: REMOTE_1.toLowerCase(), name: 'Remote Keyboard', code: 115, scan: 0xc00e9, state: 'down' });
  r.line({ type: 'unmapped', address: REMOTE_1, report: '02 40' });
  r.line({ type: 'open', address: REMOTE_1, name: 'Remote Keyboard', node: '/dev/input/event22', kind: 'ev' });
  r.line({ type: 'gone', address: REMOTE_1, node: '/dev/input/event22' });
  r.line({ type: 'key', code: 1 }); // no address: dropped
  assert.deepEqual(events, [
    { kind: 'control', source: 'kernel', address: REMOTE_1, name: 'Remote Keyboard', control: 'AudioVolumeUp', state: 'down', code: 115, usage: '0xc00e9' },
    { kind: 'unrecognized', source: 'kernel', address: REMOTE_1, raw: '02 40' },
    { kind: 'device-open', source: 'kernel', address: REMOTE_1, name: 'Remote Keyboard', node: '/dev/input/event22', nodeKind: 'ev' },
    { kind: 'device-gone', source: 'kernel', address: REMOTE_1, node: '/dev/input/event22' },
  ]);
  assert.equal(kernelLineToEvent({ type: 'other', address: REMOTE_1 }), null);
});

test('helper lines split across chunks become one line each; mode is passed', () => {
  const child = fakeChild(); let args = null;
  const lines = [];
  const h = runHelper({ mode: 'kernel', spawn: (_c, a) => { args = a; return child; }, onLine: (m) => lines.push(m), logger: null });
  assert.equal(args.at(-1), 'kernel');
  const line = JSON.stringify({ type: 'key', address: REMOTE_2, code: 114, state: 'down' });
  child.stdout.emit('data', Buffer.from(line.slice(0, 10)));
  child.stdout.emit('data', Buffer.from(line.slice(10) + '\nnot json\n' + JSON.stringify({ type: 'gone', address: REMOTE_2 }) + '\n'));
  assert.deepEqual(lines.map((l) => l.type), ['key', 'gone']);
  h.stop();
});

// ---- application service (fake adapter) ---------------------------------

class FakeSource extends IRemoteInputSource {
  constructor(id) { super(); this.id = id; this.started = false; }
  start({ onEvent }) { this.started = true; this.emit = onEvent; }
  stop() { this.started = false; }
}

test('service: control events log and send the bt.remote.key payload unchanged', () => {
  const a = new FakeSource('a'); const b = new FakeSource('b');
  const logs = []; const sent = [];
  const svc = startRemoteInput({ sources: [a, b], logEvent: (...l) => logs.push(l), send: (t, p) => sent.push([t, p]), logger: null });
  assert.equal(a.started && b.started, true);
  a.emit({ kind: 'control', source: 'a', address: REMOTE_1, name: 'R', control: 'AudioVolumeUp', state: 'down', code: 115, usage: '0xc00e9' });
  b.emit({ kind: 'control', source: 'b', address: PAD_REMOTE, name: 'P', control: 'ButtonA', state: 'up', code: null, usage: 'gatt:0x001f', raw: '0050' });
  assert.deepEqual(sent, [
    ['bt.remote.key', { address: REMOTE_1, name: 'R', code: 115, key: 'AudioVolumeUp', usage: '0xc00e9', state: 'down' }],
    ['bt.remote.key', { address: PAD_REMOTE, name: 'P', code: null, key: 'ButtonA', usage: 'gatt:0x001f', state: 'up', raw: '0050' }],
  ]);
  assert.deepEqual(logs.map((l) => [l[0], l[1]]), [['info', 'bt.remote.key'], ['debug', 'bt.remote.key']]);
  svc.stop();
  assert.equal(a.started || b.started, false);
});

test('service: lifecycle events keep their log names and are not sent', () => {
  const cases = [
    [{ kind: 'unrecognized', address: REMOTE_1, raw: '02 40' }, ['warn', 'bt.remote.unmapped', { address: REMOTE_1, report: '02 40' }]],
    [{ kind: 'report', address: REMOTE_1, name: 'R', channel: '0x001f', raw: '0050' }, ['debug', 'bt.remote.gatt', { address: REMOTE_1, name: 'R', att: '0x001f', value: '0050' }]],
    [{ kind: 'device-open', address: REMOTE_1, name: 'R', node: '/dev/x', nodeKind: 'ev' }, ['info', 'bt.remote.open', { address: REMOTE_1, name: 'R', node: '/dev/x', kind: 'ev' }]],
    [{ kind: 'device-gone', address: REMOTE_1, node: '/dev/x' }, ['info', 'bt.remote.gone', { address: REMOTE_1, node: '/dev/x' }]],
    [{ kind: 'unavailable', source: 'g' }, ['warn', 'bt.remote.monitor-unavailable', { source: 'g' }]],
  ];
  for (const [e, log] of cases) assert.deepEqual(eventToRecords(e), { log, bus: null }, e.kind);
  assert.deepEqual(eventToRecords({ kind: 'nope' }), { log: null, bus: null });
});

test('service: refuses a source that does not implement the port', () => {
  assert.throws(() => startRemoteInput({ sources: [{ start() {} }] }), /IRemoteInputSource/);
});

// ---- decoder refresh -----------------------------------------------------

test('decoder refresh applies the served table, logs count on change or announce, keeps it on failure', async () => {
  const bodies = [{ decoders: [STICK_PAD] }, { decoders: [STICK_PAD] }, null, { decoders: [] }];
  let i = 0;
  const fetchImpl = async () => { const b = bodies[i++]; return b ? { ok: true, json: async () => b } : { ok: false, status: 503 }; };
  const applied = []; const logs = [];
  const r = startDecoderRefresh({ url: 'x', fetchImpl, apply: (e) => { applied.push(e.length); return e.length; },
    logEvent: (...l) => logs.push(l), setIntervalImpl: () => null, clearIntervalImpl: () => {} });
  await r.refresh();            // first load (in flight from start)
  await r.refresh({ announce: true }); // unchanged, but announced
  await r.refresh();            // 503: table kept
  await r.refresh();            // emptied
  assert.deepEqual(applied, [1, 0]);
  assert.deepEqual(logs, [
    ['info', 'bt.remote.decoders', { count: 1, ids: ['stick_pad'] }],
    ['info', 'bt.remote.decoders', { count: 1, ids: ['stick_pad'] }],
    ['warn', 'bt.remote.decoders-unavailable', { error: 'HTTP 503' }],
    ['info', 'bt.remote.decoders', { count: 0, ids: [] }],
  ]);
});
