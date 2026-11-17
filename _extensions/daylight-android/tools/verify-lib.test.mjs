import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bakedPayloadFailure, byVersion, newestVersion, sha256Hex } from './verify-lib.mjs';

test('build-tools versions order by number, not by text', () => {
  assert.ok(byVersion('9.0.0', '33.0.2') < 0);
  assert.ok(byVersion('33.0.2', '9.0.0') > 0);
  assert.ok(byVersion('33.0.2', '33.0.10') < 0);
  assert.equal(byVersion('30.0.3', '30.0.3'), 0);
});

test('a release candidate suffix does not outrank a higher number', () => {
  assert.ok(byVersion('34.0.0-rc3', '35.0.0') < 0);
  assert.ok(byVersion('34.0.0-rc1', '34.0.0-rc3') < 0);
});

test('newestVersion picks the numerically highest name', () => {
  assert.equal(newestVersion(['9.0.0', '33.0.2', '30.0.3']), '33.0.2');
  assert.equal(newestVersion([]), undefined);
});

test('sha256Hex matches a known digest', () => {
  assert.equal(sha256Hex(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('a baked payload that matches the built payload passes', () => {
  const jar = Buffer.from('payload bytes');
  assert.equal(bakedPayloadFailure(jar, sha256Hex(jar) + '\n'), null);
  assert.equal(bakedPayloadFailure(jar, sha256Hex(jar).toUpperCase() + '  portal.jar\n'), null);
});

test('a baked payload that differs from the built payload fails and says it is stale', () => {
  const message = bakedPayloadFailure(Buffer.from('old payload'), sha256Hex(Buffer.from('new payload')) + '\n');
  assert.match(message, /stale payload/);
});

test('no .sha256 file means nothing to compare', () => {
  assert.equal(bakedPayloadFailure(Buffer.from('x'), null), null);
  assert.equal(bakedPayloadFailure(Buffer.from('x'), undefined), null);
});

test('a .sha256 file without a digest is a failure, not a pass', () => {
  assert.match(bakedPayloadFailure(Buffer.from('x'), 'not a hash\n'), /does not hold a sha256/);
});
