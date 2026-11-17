import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRequest, parseArgs, resolveDevice, send } from './daylight-device.mjs';

const fleet = { portal: { host: '192.0.2.10', token: 'x'.repeat(64) }, broken: { host: '192.0.2.11' } };
const ports = { port: 8780, lifelinePort: 8781 };

test('resolveDevice returns host and token', () => {
  assert.deepEqual(resolveDevice(fleet, 'portal'), { host: '192.0.2.10', token: 'x'.repeat(64) });
});

test('resolveDevice names the known devices when the name is wrong', () => {
  assert.throws(() => resolveDevice(fleet, 'piano'), /unknown device 'piano'.*portal/);
});

test('resolveDevice refuses a device with no token, without printing anything secret', () => {
  assert.throws(() => resolveDevice(fleet, 'broken'), /no token for 'broken'/);
});

test('status is a GET on the control port with the token header', () => {
  const r = buildRequest(resolveDevice(fleet, 'portal'), ports, parseArgs(['status']));
  assert.equal(r.url, 'http://192.0.2.10:8780/status');
  assert.equal(r.method, 'GET');
  assert.equal(r.headers['X-Daylight-Token'], 'x'.repeat(64));
});

test('settings set posts the value as the string that was typed; the device coerces it to the declared type', () => {
  const r = buildRequest(resolveDevice(fleet, 'portal'), ports, parseArgs(['settings', 'set', 'debug.execEnabled', 'true']));
  assert.equal(r.method, 'POST');
  assert.equal(r.url, 'http://192.0.2.10:8780/settings');
  assert.deepEqual(JSON.parse(r.body), { key: 'debug.execEnabled', value: 'true' });
  const n = buildRequest(resolveDevice(fleet, 'portal'), ports, parseArgs(['settings', 'set', 'a.count', '30']));
  assert.deepEqual(JSON.parse(n.body), { key: 'a.count', value: '30' });
});

test('a string setting can be set to text that looks like a boolean or a number', () => {
  for (const raw of ['true', 'false', '123', '-7', '007']) {
    const r = buildRequest(resolveDevice(fleet, 'portal'), ports, parseArgs(['settings', 'set', 'wifi.ssid', raw]));
    assert.strictEqual(JSON.parse(r.body).value, raw);
  }
  const spaced = parseArgs(['settings', 'set', 'kiosk.title', 'Front', 'door', '2']);
  assert.strictEqual(spaced.body.value, 'Front door 2');
});

const fakeFetch = (status, text) => async () => ({ ok: status >= 200 && status < 300, status, text: async () => text });
const sink = () => { const lines = []; return { lines, log: (l) => lines.push(l), error: (l) => lines.push(l) }; };

test('a 2xx response exits 0 and prints the body', async () => {
  const out = sink();
  assert.equal(await send({ url: 'http://192.0.2.10:8781/status', method: 'GET', headers: {} }, fakeFetch(200, '{"ok":true}'), out), 0);
  assert.match(out.lines.join('\n'), /"ok": true/);
});

test('a lifeline refusal (409) exits non-zero and shows the reason', async () => {
  const out = sink();
  const request = buildRequest(resolveDevice(fleet, 'portal'), ports, parseArgs(['lifeline', 'rollback']));
  const code = await send(request, fakeFetch(409, '{"ok":false,"error":"no previous payload"}'), out);
  assert.equal(code, 1);
  assert.match(out.lines.join('\n'), /no previous payload/);
  assert.match(out.lines.join('\n'), /HTTP 409/);
});

test('the token never appears in what the CLI prints', async () => {
  const out = sink();
  const request = buildRequest(resolveDevice(fleet, 'portal'), ports, parseArgs(['status']));
  await send(request, fakeFetch(401, '{"ok":false,"error":"unauthorized"}'), out);
  assert.ok(!out.lines.join('\n').includes('x'.repeat(64)));
});

test('settings reset is a DELETE with the key', () => {
  const r = buildRequest(resolveDevice(fleet, 'portal'), ports, parseArgs(['settings', 'reset', 'a.count']));
  assert.equal(r.method, 'DELETE');
  assert.equal(r.url, 'http://192.0.2.10:8780/settings?key=a.count');
});

test('lifeline commands use the lifeline port', () => {
  const r = buildRequest(resolveDevice(fleet, 'portal'), ports, parseArgs(['lifeline', 'rollback']));
  assert.equal(r.url, 'http://192.0.2.10:8781/payload/rollback');
  assert.equal(r.method, 'POST');
});

test('an unknown command is an error', () => {
  assert.throws(() => parseArgs(['frobnicate']), /unknown command 'frobnicate'/);
});

test('get passes a path and query through to the control port', () => {
  const r = buildRequest(resolveDevice(fleet, 'portal'), ports, parseArgs(['get', '/midi/tap']));
  assert.equal(r.method, 'GET');
  assert.equal(r.url, 'http://192.0.2.10:8780/midi/tap');
  const q = buildRequest(resolveDevice(fleet, 'portal'), ports, parseArgs(['get', '/hid/bluetooth/radio/scan', 'ms=5000']));
  assert.equal(q.url, 'http://192.0.2.10:8780/hid/bluetooth/radio/scan?ms=5000');
  assert.equal(q.body, undefined);
});

test('post turns key=value arguments into a query string and a leading { into a JSON body', () => {
  const q = buildRequest(resolveDevice(fleet, 'portal'), ports, parseArgs(['post', '/speaker/bt-cycle', 'settleMs=5000']));
  assert.equal(q.method, 'POST');
  assert.equal(q.url, 'http://192.0.2.10:8780/speaker/bt-cycle?settleMs=5000');
  const b = buildRequest(resolveDevice(fleet, 'portal'), ports, parseArgs(['post', '/bluetooth/scan', '{"durationMs":5000}']));
  assert.deepEqual(JSON.parse(b.body), { durationMs: 5000 });
  const e = buildRequest(resolveDevice(fleet, 'portal'), ports, parseArgs(['post', '/hid/bluetooth/bond', 'address=00:00:5E:00:53:01', 'transport=le']));
  assert.equal(e.url, 'http://192.0.2.10:8780/hid/bluetooth/bond?address=00%3A00%3A5E%3A00%3A53%3A01&transport=le');
});

test('a raw path must start with a slash', () => {
  assert.throws(() => parseArgs(['get', 'status']), /path must start with/);
  assert.throws(() => parseArgs(['post']), /path must start with/);
});

test('a raw JSON body that does not parse is an error before anything is sent', () => {
  assert.throws(() => parseArgs(['post', '/bluetooth/scan', '{durationMs']), /JSON body/);
});

test('lifeline reset-settings posts to the lifeline port, where a stranded device still answers', () => {
  const r = buildRequest(resolveDevice(fleet, 'portal'), ports, parseArgs(['lifeline', 'reset-settings']));
  assert.equal(r.method, 'POST');
  assert.equal(r.url, `http://${fleet.portal.host}:8781/settings/reset`);
  assert.equal(r.headers['X-Daylight-Token'], fleet.portal.token);
  assert.equal(r.body, undefined);
});
