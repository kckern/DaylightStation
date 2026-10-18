import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const module = await import('./bluetooth-control.mjs').catch(() => ({}));
const address = '12:34:56:78:9A:BC';
const state = {
  ok: true,
  adapter: { supported: true, enabled: true, discovering: false, name: 'Tablet' },
  devices: [{ address, name: 'Example speaker', type: 'classic', bond: 'bonded', connected: false, profiles: ['audio'], role: 'audio', rssi: -40 }],
  pairing: null, lastError: null,
  capabilities: { scan: true, pair: true, unpair: true, audio: true, midi: true, pin: true, confirm: false },
};

// These cases catch wrong routes, JSON keys, and missing profile/confirmation conversions.
for (const [args, expected] of [
  [[], { method: 'GET', path: '/bluetooth' }],
  [['status'], { method: 'GET', path: '/bluetooth' }],
  [['list'], { method: 'GET', path: '/bluetooth' }],
  [['scan'], { method: 'POST', path: '/bluetooth/scan', body: { durationMs: 12000 } }],
  [['scan', '1000'], { method: 'POST', path: '/bluetooth/scan', body: { durationMs: 1000 } }],
  [['scan', '30000'], { method: 'POST', path: '/bluetooth/scan', body: { durationMs: 30000 } }],
  [['scan', '3500'], { method: 'POST', path: '/bluetooth/scan', body: { durationMs: 3500 } }],
  [['stop'], { method: 'POST', path: '/bluetooth/scan/stop', body: {} }],
  [['pair', address.toLowerCase()], { method: 'POST', path: '/bluetooth/pair', body: { address } }],
  [['unpair', address], { method: 'POST', path: '/bluetooth/unpair', body: { address } }],
  [['connect', address, 'audio'], { method: 'POST', path: '/bluetooth/connect', body: { address, profile: 'audio' } }],
  [['connect', address, 'midi'], { method: 'POST', path: '/bluetooth/connect', body: { address, profile: 'midi' } }],
  [['disconnect', address, 'midi'], { method: 'POST', path: '/bluetooth/disconnect', body: { address, profile: 'midi' } }],
  [['disconnect', address, 'audio'], { method: 'POST', path: '/bluetooth/disconnect', body: { address, profile: 'audio' } }],
  [['power', 'on'], { method: 'POST', path: '/bluetooth/power', body: { enabled: true } }],
  [['power', 'off'], { method: 'POST', path: '/bluetooth/power', body: { enabled: false } }],
  [['confirm', address, 'yes'], { method: 'POST', path: '/bluetooth/pairing', body: { address, accept: true } }],
  [['confirm', address, 'no'], { method: 'POST', path: '/bluetooth/pairing', body: { address, accept: false } }],
  [['pin', address, '012345'], { method: 'POST', path: '/bluetooth/pairing', body: { address, accept: true, pin: '012345' } }],
  [['cancel', address], { method: 'POST', path: '/bluetooth/pairing', body: { address, accept: false } }],
]) {
  test(`parses Bluetooth ${args[0] || 'default'} ${args[2] === 'midi' ? 'midi' : ''}`, () => {
    assert.equal(typeof module.parseBluetoothCommand, 'function', 'Bluetooth parser is implemented');
    assert.deepEqual(module.parseBluetoothCommand(args), expected);
  });
}

for (const args of [
  ['status', 'extra'], ['list', 'extra'], ['scan', '0'], ['scan', '-1'], ['scan', '1.5'],
  ['scan', '999'], ['scan', '30001'], ['scan', '12ms'], ['scan', 'Infinity'], ['scan', '9007199254740992'], ['scan', '2', 'extra'],
  ['stop', 'extra'], ['pair'], ['pair', 'invalid'], ['pair', address, 'extra'],
  ['unpair'], ['connect', address], ['connect', address, 'speaker'],
  ['disconnect', address, 'midi', 'extra'], ['power', 'yes'], ['power', 'on', 'extra'],
  ['confirm', address, 'true'], ['confirm', address], ['pin', address],
  ['pin', address, ''], ['pin', address, '12345678901234567'], ['pin', address, '\n'],
  ['pin', address, '1234', 'extra'], ['cancel'], ['cancel', address, 'extra'], ['unknown'],
]) {
  test(`rejects invalid Bluetooth arguments (${args[0]}, ${args.length} args) before transport`, async () => {
    assert.equal(typeof module.runBluetoothCommand, 'function', 'Bluetooth dispatcher is implemented');
    let calls = 0;
    const code = await module.runBluetoothCommand(args, {
      base: 'http://bridge.example', fetchImpl: async () => { calls++; throw new Error('must not reach transport'); },
      write: () => {}, writeError: () => {},
    });
    assert.equal(code, 1);
    assert.equal(calls, 0);
  });
}

test('dispatches JSON POST and reports acceptance without claiming a connection', async () => {
  assert.equal(typeof module.runBluetoothCommand, 'function', 'Bluetooth dispatcher is implemented');
  const requests = [];
  const output = [];
  const code = await module.runBluetoothCommand(['connect', address, 'audio'], {
    base: 'http://bridge.example',
    fetchImpl: async (url, init) => { requests.push({ url, method: init.method, type: init.headers['content-type'], body: JSON.parse(init.body) }); return Response.json({ ok: true, accepted: true }); },
    write: (line) => output.push(line), writeError: (line) => assert.fail(line),
  });
  assert.equal(code, 0);
  assert.deepEqual(requests, [{ url: 'http://bridge.example/bluetooth/connect', method: 'POST', type: 'application/json', body: { address, profile: 'audio' } }]);
  assert.match(output.join('\n'), /accepted/i);
  assert.doesNotMatch(output.join('\n'), /connected|paired/i);
});

test('list prints the observed adapter and device state', async () => {
  assert.equal(typeof module.runBluetoothCommand, 'function', 'Bluetooth dispatcher is implemented');
  const output = [];
  const code = await module.runBluetoothCommand(['list'], {
    base: 'http://bridge.example',
    fetchImpl: async (url, init) => { assert.equal(url, 'http://bridge.example/bluetooth'); assert.equal(init.method, 'GET'); assert.equal(init.body, undefined); return Response.json(state); },
    write: (line) => output.push(line), writeError: (line) => assert.fail(line),
  });
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(output[0]), state);
});

for (const [name, response] of [
  ['HTTP failure', () => Response.json({ ok: true }, { status: 503 })],
  ['bridge rejection', () => Response.json({ ok: false, code: 'action_failed', error: 'Action could not be completed' })],
  ['malformed response', () => new Response('not JSON')],
  ['transport failure', () => { throw new Error('unreachable'); }],
]) {
  test(`returns nonzero for ${name}`, async () => {
    assert.equal(typeof module.runBluetoothCommand, 'function', 'Bluetooth dispatcher is implemented');
    const errors = [];
    assert.equal(await module.runBluetoothCommand(['pair', address], { base: 'http://bridge.example', fetchImpl: response, write: () => assert.fail('must not print success'), writeError: (line) => errors.push(line) }), 1);
    assert.ok(errors.length);
  });
}

// Successful transport is insufficient: only an explicit action acceptance is success.
for (const result of [{ ok: true }, { ok: true, accepted: false }, { ok: true, accepted: 'true' }]) {
  test(`rejects a POST without explicit acceptance (${String(result.accepted)})`, async () => {
    const output = [];
    const code = await module.runBluetoothCommand(['pair', address], {
      base: 'http://bridge.example', fetchImpl: async () => Response.json(result),
      write: (line) => output.push(line), writeError: () => {},
    });
    assert.equal(code, 1);
    assert.deepEqual(output, []);
  });
}

for (const result of [
  { ok: true }, { ok: true, adapter: null, devices: [] },
  { ok: true, adapter: [], devices: [] }, { ok: true, adapter: {}, devices: [] },
  { ...state, adapter: { ...state.adapter, enabled: 'true' } },
  { ...state, devices: {} }, { ...state, devices: [null] },
  { ...state, devices: [{ ...state.devices[0], connected: 'false' }] },
]) {
  test(`rejects malformed Bluetooth status (${JSON.stringify(result)})`, async () => {
    const output = [];
    const code = await module.runBluetoothCommand(['status'], {
      base: 'http://bridge.example', fetchImpl: async () => Response.json(result),
      write: (line) => output.push(line), writeError: () => {},
    });
    assert.equal(code, 1);
    assert.deepEqual(output, []);
  });
}

for (const failure of [false, true, 'transport']) {
  test(`never prints a submitted PIN, including echoed ${failure || 'success'} responses`, async () => {
    assert.equal(typeof module.runBluetoothCommand, 'function', 'Bluetooth dispatcher is implemented');
    const output = [];
    const pin = '901234';
    const code = await module.runBluetoothCommand(['pin', address, pin], {
      base: 'http://bridge.example',
      fetchImpl: async () => { if (failure === 'transport') throw new Error(`transport echoed ${pin}`); return Response.json({ ok: !failure, accepted: !failure, error: failure ? `Invalid PIN ${pin}` : null, pin, nested: { PIN: pin }, info: `echo ${pin}` }); },
      write: (line) => output.push(line), writeError: (line) => output.push(line),
    });
    assert.equal(code, failure ? 1 : 0);
    assert.doesNotMatch(output.join('\n'), /901234/);
  });
}

// Execute each public entry: importing the old duplicate used to omit modern commands.
const entries = [
  'cli/pianobridge.cli.mjs',
  '__app_modules/learning/piano/cli/pianobridge.cli.mjs',
  '__app_modules/learning/piano/satellites/piano-bridge/pbctl.mjs',
];
const transport = `globalThis.fetch = async (url, init) => { const expected = JSON.parse(process.env.TEST_REQUEST); if (url !== 'http://bridge.example' + expected.path || init.method !== expected.method || (expected.body && JSON.stringify(JSON.parse(init.body)) !== JSON.stringify(expected.body))) throw new Error('wrong command dispatch'); return Response.json(JSON.parse(process.env.TEST_RESPONSE), {status: Number(process.env.TEST_STATUS || 200)}); };`;
function execute(entry, args, response = state, expected = { method: 'GET', path: '/bluetooth' }, status = 200) {
  return spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(transport)}`, entry, ...args], {
    encoding: 'utf8', env: { ...process.env, PB_HOST: 'bridge.example', TEST_REQUEST: JSON.stringify(expected), TEST_RESPONSE: JSON.stringify(response), TEST_STATUS: String(status) },
  });
}
for (const entry of entries) {
  test(`${entry} exposes Bluetooth list`, () => {
    const result = execute(entry, ['bluetooth', 'list']);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.deepEqual(JSON.parse(result.stdout), state);
  });
  test(`${entry} exits nonzero when Bluetooth action is rejected`, () => {
    const result = execute(entry, ['bluetooth', 'pair', address], { ok: false, error: 'Action could not be completed' }, { method: 'POST', path: '/bluetooth/pair', body: { address } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Action could not be completed/);
  });
  test(`${entry} retains existing diagnostic commands`, () => {
    const result = execute(entry, ['info'], { ok: true, version: 'example' }, { method: 'GET', path: '/info' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { ok: true, version: 'example' });
  });
}
