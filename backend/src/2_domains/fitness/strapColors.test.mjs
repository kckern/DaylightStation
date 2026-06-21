import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cssColorForStrap, makeDeviceColorResolver, hashColorForDevice } from './strapColors.mjs';

test('maps strap color names to the SSOT hex (matches the live UI)', () => {
  assert.equal(cssColorForStrap('red'), '#ff6b6b');
  assert.equal(cssColorForStrap('yellow'), '#f0c836');
  assert.equal(cssColorForStrap('green'), '#51cf66');
  assert.equal(cssColorForStrap('blue'), '#6ab8ff');
  assert.equal(cssColorForStrap('watch'), '#e9ecef');
  assert.equal(cssColorForStrap('GREEN'), '#51cf66');   // case-insensitive
  assert.equal(cssColorForStrap('nope'), null);
  assert.equal(cssColorForStrap(null), null);
});

test('resolver maps an HR device id (string or number) to its assigned colour', () => {
  // fitness.yml device_colors.heart_rate shape: { [deviceId]: colorName }
  const resolve = makeDeviceColorResolver({ 28812: 'red', 28688: 'yellow', 40475: 'watch' });
  assert.equal(resolve('28812'), '#ff6b6b');   // felix, looked up by string
  assert.equal(resolve(28812), '#ff6b6b');      // and by number
  assert.equal(resolve('40475'), '#e9ecef');   // kckern watch
});

test('resolver falls back to a stable per-device hash when unconfigured', () => {
  const resolve = makeDeviceColorResolver({});
  const a = resolve('99999');
  assert.match(a, /^hsl\(/);
  assert.equal(a, hashColorForDevice('99999'));  // deterministic
  assert.equal(resolve(null), null);
});
