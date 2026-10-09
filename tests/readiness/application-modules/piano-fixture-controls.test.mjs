import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import { validateRawFixtures, rawFixturePins } from './raw-utf8-fixture.mjs';
const destination = 'data/household/piano/producer/loops/a.yml';
const text = 'created: 2026-01-01T00:00:00.000Z\nmodified: 2026-01-02T00:00:00.000Z\n';
const row = bytes => ({ destination, encoding: 'utf8', byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), base64: bytes.toString('base64') });
const fixture = () => ({ fixtureFiles: {}, rawUTF8Files: [row(Buffer.from(text))] });
test('legacy JSON fixtures retain their exact representation and absent raw schema', () => {
  const value = { fixtureFiles: { 'data/test.yml': { flag: true, nested: [1, 2] } } }; const before = JSON.stringify(value);
  assert.deepEqual(validateRawFixtures(value), []); assert.equal(JSON.stringify(value), before);
});
test('raw YAML retains Date types that JSON coercion would silently repair', () => {
  const value = fixture(); validateRawFixtures(value); const bytes = Buffer.from(value.rawUTF8Files[0].base64, 'base64');
  assert.equal(bytes.toString(), text); assert.ok(yaml.load(bytes.toString()).created instanceof Date);
  assert.equal(typeof JSON.parse(JSON.stringify(yaml.load(text))).created, 'string');
});
test('raw paths cannot address traversal, startup, secrets, devices or arbitrary data', () => {
  for (const destination of ['/data/a.yml', 'data/household/piano/producer/loops/../a.yml', 'data//household/piano/producer/loops/a.yml', 'data/household/piano/producer/loops\\a.yml', 'data/system/secrets.yml', 'data/system/config/auth.yml', 'data/household/hardware/devices.yml', 'media/a.bin']) {
    const value = fixture(); value.rawUTF8Files[0].destination = destination; assert.throws(() => validateRawFixtures(value));
  }
});
test('raw exact byte hash, UTF8, size, encoding and canonical base64 are enforced', () => {
  for (const patch of [{ sha256: '0'.repeat(64) }, { byteLength: 1 }, { byteLength: 1048577 }, { encoding: 'latin1' }, { base64: '%%%bad' }]) {
    const value = fixture(); Object.assign(value.rawUTF8Files[0], patch); assert.throws(() => validateRawFixtures(value));
  }
  for (const bytes of [Buffer.from([0xc3, 0x28]), Buffer.from([0x00])]) assert.throws(() => validateRawFixtures({ fixtureFiles: {}, rawUTF8Files: [row(bytes)] }));
});
test('raw duplicate and JSON collision reject before scratch creation', () => {
  const duplicate = fixture(); duplicate.rawUTF8Files.push({ ...duplicate.rawUTF8Files[0] }); assert.throws(() => validateRawFixtures(duplicate));
  const collision = fixture(); collision.fixtureFiles[destination] = {}; assert.throws(() => validateRawFixtures(collision));
});
test('MusicXML requires existing projected roster identity and retains exact UTF8', () => {
  const value = fixture(); value.rawUTF8Files[0] = { ...row(Buffer.from('<?xml version="1.0"?><score-partwise>é</score-partwise>')), destination: 'data/users/roster/apps/piano/composer/a.musicxml' };
  assert.throws(() => validateRawFixtures(value)); value.fixtureFiles['data/users/roster/profile.yml'] = {};
  assert.equal(rawFixturePins(value)[0].destination, value.rawUTF8Files[0].destination);
});
test('finite raw fixture pack cannot exceed eight MiB', () => {
  const bytes = Buffer.alloc(1048576, 65); const template = row(bytes);
  const value = { fixtureFiles: {}, rawUTF8Files: Array.from({ length: 9 }, (_, i) => ({ ...template, destination: 'data/household/piano/producer/loops/a' + i + '.yml' })) };
  assert.throws(() => validateRawFixtures(value));
  value.rawUTF8Files.pop(); assert.equal(validateRawFixtures(value).length, 8);
});
