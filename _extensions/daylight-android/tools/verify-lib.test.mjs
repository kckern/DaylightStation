import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bakedPayloadFailure, byVersion, newestVersion, sha256Hex, synthLibraryFailure } from './verify-lib.mjs';

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

const synthLibrary = (parts, size = 1024 * 1024) => {
  const body = Buffer.alloc(size);
  let at = 64;
  for (const part of parts) { body.write(part, at, 'latin1'); at += part.length + 8; }
  return body;
};
const SFIZZ = 'SfizzEngine created (sfizz vendored) sr=%.0f';
const JNI = 'Java_net_kckern_daylight_cap_synth_shell_PianoEngine_nativeLoadPreset';

test('a synth library with the JNI exports and sfizz linked in passes', () => {
  assert.equal(synthLibraryFailure(synthLibrary([JNI, SFIZZ])), null);
});

test('a synth library built without sfizz is refused', () => {
  assert.match(synthLibraryFailure(synthLibrary([JNI])), /sfizz is not linked/);
});

test('a synth library whose JNI names belong to another package is refused', () => {
  const old = 'Java_net_kckern_pianobridge_PianoEngine_nativeLoadPreset';
  assert.match(synthLibraryFailure(synthLibrary([old, SFIZZ])), /JNI exports/);
});

test('a synth library too small to hold a sampler is refused', () => {
  assert.match(synthLibraryFailure(synthLibrary([JNI, SFIZZ], 200 * 1024)), /too small/);
});

test('a missing synth library is refused', () => {
  assert.match(synthLibraryFailure(null), /missing/);
  assert.match(synthLibraryFailure(Buffer.alloc(0)), /missing/);
});

test('an optimized synth library below one mebibyte passes', () => {
  // The optimized armeabi-v7a library is about 0.9 MB.
  assert.equal(synthLibraryFailure(synthLibrary([JNI, SFIZZ], 900 * 1024)), null);
});

test('a synth library the size of an unoptimized build is refused', () => {
  assert.match(synthLibraryFailure(synthLibrary([JNI, SFIZZ], 2400 * 1024)), /unoptimized/);
});

test('a synth library that names the build machine home directory is refused', () => {
  const lib = synthLibrary([JNI, SFIZZ, '/home/builder/src/sfizz/Synth.cpp']);
  assert.match(synthLibraryFailure(lib, '/home/builder'), /build machine/);
  assert.equal(synthLibraryFailure(lib, '/home/someone-else'), null);
  assert.equal(synthLibraryFailure(lib), null);
});
