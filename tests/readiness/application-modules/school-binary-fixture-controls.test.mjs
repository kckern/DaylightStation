import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateRawFixtures, binaryFixturePins, rawFixturePins } from './raw-utf8-fixture.mjs';
const destination = 'data/household/school/artifacts/issued/agenda/learner/20260826T202655359Z.png';
const bytes = Buffer.from([137,80,78,71,13,10,26,10,0,255,128]);
const descriptor = (data = bytes, dest = destination, encoding = 'binary') => ({ destination: dest, encoding, sha256: createHash('sha256').update(data).digest('hex'), byteLength: data.length, base64: data.toString('base64') });
const fixture = () => ({ fixtureFiles: { 'data/users/learner/profile.yml': {} }, rawBinaryFiles: [descriptor()] });
test('reviewed retained PNG bytes roundtrip with byte hash, length and existing roster', () => {
  const value = fixture(); const before = JSON.stringify(value); assert.deepEqual(validateRawFixtures(value), []);
  assert.equal(Buffer.from(value.rawBinaryFiles[0].base64, 'base64').equals(bytes), true);
  assert.equal(binaryFixturePins(value)[0].sha256, value.rawBinaryFiles[0].sha256); assert.equal(JSON.stringify(value), before);
  delete value.fixtureFiles['data/users/learner/profile.yml']; assert.throws(() => validateRawFixtures(value));
});
test('School UTF8 and Piano UTF8 representations remain byte-identical with binary pack added', () => {
  const value = fixture(); value.rawUTF8Files = [descriptor(Buffer.from('created: 2026-01-01T00:00:00.000Z\n'), 'data/household/piano/producer/loops/a.yml', 'utf8'), descriptor(Buffer.from('schema: school.word-lexicon/v2\n'), 'media/school/language/korean-vocab/lexicon.yml', 'utf8')];
  const before = JSON.stringify(value.rawUTF8Files); assert.equal(rawFixturePins(value).length, 2); assert.equal(JSON.stringify(value.rawUTF8Files), before);
});
test('binary paths reject traversal, symlink-like aliases, config, devices and unreviewed formats', () => {
  for (const dest of ['data/household/school/artifacts/issued/agenda/learner/../a.png', 'data//household/school/artifacts/issued/agenda/learner/20260826T202655359Z.png', 'data/system/config/auth.yml', 'data/system/secrets.yml', 'data/household/hardware/devices.yml', 'media/school/a.png', destination.replace('.png', '.exe')]) {
    const value = fixture(); value.rawBinaryFiles[0].destination = dest; assert.throws(() => validateRawFixtures(value));
  }
});
test('binary type, hash, byte count, canonical encoding and cross-type collision are enforced', () => {
  for (const patch of [{ sha256: '0'.repeat(64) }, { byteLength: 1 }, { encoding: 'utf8' }, { base64: '%%%' }]) {
    const value = fixture(); Object.assign(value.rawBinaryFiles[0], patch); assert.throws(() => validateRawFixtures(value));
  }
  const text = fixture(); text.rawBinaryFiles[0] = descriptor(Buffer.from('fake PNG')); assert.throws(() => validateRawFixtures(text));
  const collision = fixture(); collision.fixtureFiles[destination] = {}; assert.throws(() => validateRawFixtures(collision));
  const duplicate = fixture(); duplicate.rawBinaryFiles.push({ ...duplicate.rawBinaryFiles[0] }); assert.throws(() => validateRawFixtures(duplicate));
  const binaryInUTF8 = fixture(); binaryInUTF8.rawUTF8Files = [{ ...binaryInUTF8.rawBinaryFiles[0], encoding: 'utf8' }]; binaryInUTF8.rawBinaryFiles = []; assert.throws(() => validateRawFixtures(binaryInUTF8));
});
test('only reviewed media asset PNG/JPEG/MP3 types and finite aggregate size are admitted', () => {
  const value = fixture(); value.rawBinaryFiles = [descriptor(Buffer.from([255,216,255,0]), 'media/school/language/korean-vocab/words/week-01/a/image.jpg'), descriptor(Buffer.from('ID3\0binary'), 'media/school/language/korean-vocab/words/week-01/a/term.mp3')];
  assert.equal(binaryFixturePins(value).length, 2);
  const large = Buffer.alloc(1048576, 65); value.rawUTF8Files = Array.from({ length: 8 }, (_, i) => descriptor(large, 'data/household/piano/producer/loops/a' + i + '.yml', 'utf8'));
  assert.throws(() => validateRawFixtures(value));
});
