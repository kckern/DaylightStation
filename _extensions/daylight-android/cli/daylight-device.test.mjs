import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRequest, parseArgs, resolveDevice } from './daylight-device.mjs';

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

test('settings set posts key and value, coercing booleans and integers', () => {
  const r = buildRequest(resolveDevice(fleet, 'portal'), ports, parseArgs(['settings', 'set', 'debug.execEnabled', 'true']));
  assert.equal(r.method, 'POST');
  assert.equal(r.url, 'http://192.0.2.10:8780/settings');
  assert.deepEqual(JSON.parse(r.body), { key: 'debug.execEnabled', value: true });
  const n = buildRequest(resolveDevice(fleet, 'portal'), ports, parseArgs(['settings', 'set', 'a.count', '30']));
  assert.deepEqual(JSON.parse(n.body), { key: 'a.count', value: 30 });
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
