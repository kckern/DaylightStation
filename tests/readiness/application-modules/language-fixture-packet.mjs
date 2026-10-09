import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateRawFixtures } from './raw-utf8-fixture.mjs';

// Independently reviewed authored corpus and two existing media files only.
// Expectations are pinned before HTTP; changing backing requires renewed review.
export function applyLanguagePacket(packet, fixtureFiles, dataRoot, make) {
  assert.equal(packet.schema, 'daylight.language-fixture-packet/v1');
  assert.equal(packet.expectationMode, 'pinned-independent-source-backing-snapshot');
  assert.equal(packet.dataRoot, dataRoot);
  assert.equal(packet.mediaRoot, path.join(path.dirname(dataRoot), 'media'));
  assert.equal(fs.realpathSync(packet.mediaRoot), packet.mediaRoot);
  const inputs = packet.backingInputs.map(row => ({ ...row }));
  const allowed = file => [dataRoot, packet.mediaRoot].some(root => file.startsWith(root + path.sep));
  for (const row of inputs) {
    assert.ok(allowed(row.path)); assert.equal(fs.realpathSync(row.path), row.path);
    const stat = fs.lstatSync(row.path); assert.ok(!stat.isSymbolicLink());
    assert.equal(stat.dev, row.dev); assert.equal(stat.ino, row.ino);
    if (row.kind === 'directory') { assert.ok(stat.isDirectory()); assert.deepEqual(fs.readdirSync(row.path).sort(), row.entries); }
    else { assert.ok(stat.isFile()); assert.equal(createHash('sha256').update(fs.readFileSync(row.path)).digest('hex'), row.sha256); }
  }
  const materialize = (rows, encoding) => rows.map(row => {
    assert.ok(allowed(row.sourceFile));
    assert.ok(inputs.some(input => input.path === row.sourceFile && input.sha256 === row.sha256));
    const root = encoding === 'binary' ? packet.mediaRoot : dataRoot;
    assert.equal(row.destination, (encoding === 'binary' ? 'media/' : 'data/') + path.relative(root, row.sourceFile).split(path.sep).join('/'));
    return { destination: row.destination, encoding, byteLength: row.byteLength, sha256: row.sha256, base64: fs.readFileSync(row.sourceFile).toString('base64') };
  });
  const rawUTF8Files = materialize(packet.rawUTF8Files, 'utf8'), rawBinaryFiles = materialize(packet.rawBinaryFiles, 'binary');
  assert.equal(rawUTF8Files.length, 1); assert.equal(rawBinaryFiles.length, 2);
  assert.match(packet.schoolConfigDestination, /^data\/household(?:-[A-Za-z0-9_-]+)?\/school\/school\.yml$/);
  const school = fixtureFiles[packet.schoolConfigDestination]; assert.ok(school);
  assert.deepEqual(packet.configProjection, { sentence_ladder: { cues: { record: 'ding.mp3' } } });
  Object.assign(school, packet.configProjection);
  validateRawFixtures({ fixtureFiles, rawUTF8Files, rawBinaryFiles });
  assert.equal(packet.manifest.cases.length, 6);
  const manifest = { schema: 'comparator-v1', cases: packet.manifest.cases.map(c => make(c.id, c.path, c.expected.body, c.expected.headers)) };
  assert.deepEqual(manifest, packet.manifest, 'Language contracts must use reviewed shared case defaults');
  return { inputs, rawUTF8Files, rawBinaryFiles, manifest, contract: { expectationMode: packet.expectationMode, preparationArtifactSha256: packet.preparationArtifactSha256, courseValidation: packet.courseValidation, binaryResponses: 4, normalizationReasons: packet.normalizationReasons } };
}
