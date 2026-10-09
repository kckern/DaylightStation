import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateRawFixtures } from './raw-utf8-fixture.mjs';

// A reviewed independent preparation snapshot, never captured API bodies.
// Changed backing requires renewed independent projection and case approval.
export function applySchoolPacket(packet, fixtureFiles, dataRoot) {
  assert.equal(packet.schema, 'daylight.school-fixture-packet/v1');
  assert.equal(packet.expectationMode, 'pinned-independent-source-backing-snapshot');
  assert.equal(packet.dataRoot, dataRoot);
  assert.equal(packet.mediaRoot, path.join(path.dirname(dataRoot), 'media'));
  assert.equal(fs.realpathSync(packet.mediaRoot), packet.mediaRoot);
  assert.equal(new Date().getUTCFullYear(), packet.teacherUTCYear, 'Teacher age contract year changed');
  const allowedRoot = file => [packet.dataRoot, packet.mediaRoot].some(root => file.startsWith(root + path.sep));
  const inputs = packet.backingGuards.map(row => ({ ...row }));
  for (const row of packet.directoryGuards) {
    assert.ok(allowedRoot(row.path));
    if (row.absent) { assert.ok(!fs.existsSync(row.path)); inputs.push({ ...row }); continue; }
    assert.equal(fs.realpathSync(row.path), row.path);
    const stat = fs.statSync(row.path); assert.ok(stat.isDirectory());
    assert.deepEqual(fs.readdirSync(row.path).sort(), row.entries);
    inputs.push({ ...row, kind: 'directory', dev: stat.dev, ino: stat.ino });
  }
  for (const row of inputs) {
    assert.ok(allowedRoot(row.path));
    if (row.absent) { assert.ok(!fs.existsSync(row.path)); continue; }
    assert.equal(fs.realpathSync(row.path), row.path);
    const stat = fs.statSync(row.path); assert.equal(stat.dev, row.dev); assert.equal(stat.ino, row.ino);
    if (row.kind !== 'directory') assert.equal(createHash('sha256').update(fs.readFileSync(row.path)).digest('hex'), row.sha256);
  }
  const materialize = (rows, encoding) => rows.map(row => {
    assert.ok(allowedRoot(row.sourceFile));
    const guard = inputs.find(input => input.path === row.sourceFile);
    assert.ok(guard && guard.sha256 === row.sha256, 'Missing exact backing byte guard');
    return { destination: row.destination, sha256: row.sha256, byteLength: row.byteLength, encoding,
      base64: fs.readFileSync(row.sourceFile).toString('base64') };
  });
  const rawUTF8Files = materialize(packet.rawUTF8Files, 'utf8'), rawBinaryFiles = materialize(packet.rawBinaryFiles, 'binary');
  const school = fixtureFiles[packet.schoolConfigDestination]; assert.ok(school);
  for (const key of Object.keys(packet.mergeSchoolConfig)) assert.ok(['teachers', 'catalog'].includes(key), 'Unreviewed School config projection');
  Object.assign(school, packet.mergeSchoolConfig);
  school.lifecycle = { enabled: true, virtualDevices: true };
  validateRawFixtures({ fixtureFiles, rawUTF8Files, rawBinaryFiles });
  assert.equal(packet.manifest.cases.length, 9);
  for (const row of packet.manifest.cases) assert.equal(row.expected.headers['content-type'], 'application/json; charset=utf-8');
  return { inputs, rawUTF8Files, rawBinaryFiles, manifest: packet.manifest,
    contract: { expectationMode: packet.expectationMode, dataRefreshRequiredOnBackingChange: true,
      preparationArtifactSha256: packet.preparationArtifactSha256, teacherUTCYear: packet.teacherUTCYear,
      mediaMapping: 'Exact guarded adjacent host media files copied under disposable media/school',
      lifecycle: 'Candidate-only enabled lifecycle with virtual adapters; reviewed finite GETs only' } };
}
