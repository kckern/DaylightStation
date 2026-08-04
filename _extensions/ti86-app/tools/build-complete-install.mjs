#!/usr/bin/env node
/** Build and audit one exact, complete TI86A SchoolCalc offline installation. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTi86StringFile } from './inspect-ti86-string.mjs';
import {
  decodeTi86InstalledState,
  decodeTi86LearnerRoster,
  decodeTi86ProgressProjection,
} from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import { decodeSchoolCalcLocalState } from './lib/schoolcalc-local-state.mjs';
import { openSchoolCalcRecord } from './lib/schoolcalc-record-view.mjs';
import {
  verifyTi86BasicProgram, verifyTi86Program,
} from './lib/ti86-program.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');
const ROOT = path.resolve(EXTENSION, '..', '..');
const DIST = path.join(EXTENSION, 'dist');
const PACKS = path.join(DIST, 'content-packs');

for (const builder of [
  'build-schoolcalc-client.mjs',
  'build-schoolcalc-launcher.mjs',
  'build-catalog-packs.mjs',
  'build-starter-install.mjs',
  'build-ti86a-provisioning.mjs',
]) {
  execFileSync(process.execPath, [path.join(HERE, builder)], { cwd: ROOT, stdio: 'inherit' });
}
const packs = JSON.parse(readFileSync(path.join(PACKS, 'manifest.json'), 'utf8'));
if (packs.schema !== 'school.calc.ti86-pack-manifest/v1' || !Array.isArray(packs.artifacts) || packs.artifacts.length === 0) {
  throw new Error('TI-86 pack manifest is invalid or empty');
}

const transfer = [
  // Send programs independently. A link interruption can then be retried at
  // one named variable instead of leaving a large group partially installed
  // while ASCHL misleadingly remains launchable.
  file('SCHLCALC.86p', DIST, 'program'),
  file('SCLEARN.86p', DIST, 'program'),
  file('SCQR.86p', DIST, 'program'),
  file('SCCAT.86p', DIST, 'program'),
  file('SCREQ.86p', DIST, 'program'),
  file('SCQUEUE.86p', DIST, 'program'),
  file('SCSYNC.86p', DIST, 'program'),
  file('SCNATIVE.86p', DIST, 'program'),
  file('SCPROF.86p', DIST, 'program'),
  file('SCTUTOR.86p', DIST, 'program'),
  file('DSID.86s', DIST, 'string', 'SCI1'),
  file('DSUSERS.86s', DIST, 'string', 'SCU1'),
  file('DSPROG.86s', DIST, 'string', 'SCG1'),
  file('DSCAT0.86s', DIST, 'string', 'SCC1'),
  file('DSINST0.86s', DIST, 'string', 'SCM1'),
  file('DSINST.86s', DIST, 'string', 'SCM1'),
  ...packs.artifacts.map((artifact) => file(artifact.fileName, PACKS, 'content-pack', 'SCP1', artifact)),
  // Commit the neutral continuation only after every referenced Catalog and
  // content variable has transferred. Both names overwrite stale test state.
  file('DSLOCAL0.86s', DIST, 'local-state', 'SCL1'),
  file('DSLOCAL1.86s', DIST, 'local-state', 'SCL1'),
  // Install the editable launcher last so an interrupted transfer cannot look
  // ready merely because ASCHL sorts first in PRGM.
  file('ASCHL.86p', DIST, 'basic-launcher'),
];

const programs = transfer.filter(({ kind }) => kind === 'program').map((entry) => {
  const expectedName = path.basename(entry.name, '.86p');
  return verifyTi86Program(entry.bytes, { expectedName });
});
verifyTi86BasicProgram(transfer.at(-1).bytes, { expectedName: 'ASCHL' });

for (const entry of transfer.filter(({ kind }) => ['string', 'content-pack', 'local-state'].includes(kind))) {
  const parsed = parseTi86StringFile(entry.bytes);
  const expectedName = path.basename(entry.name, '.86s');
  if (parsed.name !== expectedName) throw new Error(`${entry.name} contains ${parsed.name}`);
  const record = parsed.variableData.subarray(2);
  verifyEnvelope(record, entry.magic);
  if (entry.kind === 'local-state') {
    decodeSchoolCalcLocalState(record);
  } else if (entry.magic === 'SCU1') {
    decodeTi86LearnerRoster(record);
  } else if (entry.magic === 'SCM1') {
    decodeTi86InstalledState(record);
  } else if (entry.magic === 'SCG1') {
    decodeTi86ProgressProjection(record);
  } else {
    // SCI1, SCC1, and SCP1 use the exact offset-oriented typed-document shape
    // consumed by the calculator reader. Envelope/CRC validity alone is not
    // sufficient evidence that Catalog and lesson paths are traversable.
    openSchoolCalcRecord(record, { expectedMagic: entry.magic });
  }
}

auditStarterRelationships(transfer);

const entries = transfer.map(({ name, bytes, kind, magic }, transferIndex) => Object.freeze({
  transferIndex,
  fileName: name,
  kind,
  ...(magic ? { magic } : {}),
  byteLength: bytes.length,
  sha256: digest(bytes),
}));
const releaseId = digest(Buffer.from(JSON.stringify(entries))).slice(0, 12);
const bundle = path.join(DIST, `install-ti86a-${releaseId}`);
mkdirSync(bundle, { recursive: true });
for (const entry of transfer) copyFileSync(entry.source, path.join(bundle, entry.name));
copyFileSync(path.join(DIST, 'schoolcalc-client-release.json'), path.join(bundle, 'schoolcalc-client-release.json'));
const manifest = {
  schema: 'school.calc.ti86-complete-install/v1',
  releaseId,
  deviceId: 'TI86A',
  programs: programs.map(({ name }) => name),
  launcher: 'ASCHL',
  learners: ['Soren', 'Alan', 'Milo', 'Felix'],
  courses: packs.artifacts.map(({ source }) => source.address.split('/')[2]),
  transfer: entries,
};
writeFileSync(path.join(bundle, 'complete-install.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`[ti86] complete audited install ${releaseId}: ${bundle}\n`);
process.stdout.write(`[ti86] ${manifest.programs.length} assembly programs, 1 launcher, 4 learners, ${manifest.courses.length} courses\n`);

function file(name, directory, kind, magic = null, artifact = null) {
  const source = path.join(directory, name);
  return { name, source, kind, magic, artifact, bytes: readFileSync(source) };
}

function verifyEnvelope(record, magic) {
  if (record.length < 9 || record.toString('ascii', 0, 4) !== magic || record[4] !== 1) {
    throw new Error(`${magic} envelope header is invalid`);
  }
  if (record.readUInt16LE(5) + 9 !== record.length) throw new Error(`${magic} envelope length is invalid`);
  if (record.readUInt16LE(record.length - 2) !== crc16(record.subarray(0, -2))) {
    throw new Error(`${magic} envelope CRC is invalid`);
  }
}

function auditStarterRelationships(entries) {
  const recordByName = new Map(entries
    .filter(({ kind }) => ['string', 'content-pack', 'local-state'].includes(kind))
    .map((entry) => {
      const parsed = parseTi86StringFile(entry.bytes);
      return [parsed.name, parsed.variableData.subarray(2)];
    }));
  const state0 = decodeSchoolCalcLocalState(recordByName.get('DSLOCAL0'));
  const state = decodeSchoolCalcLocalState(recordByName.get('DSLOCAL1'));
  if (state0.generation + 1 !== state.generation) {
    throw new Error('starter SCL1 slots are not consecutive generations');
  }
  const catalog = openSchoolCalcRecord(recordByName.get('DSCAT0'), { expectedMagic: 'SCC1' });
  if (catalog.path('generationKey').value !== state.catalogGenerationKey) {
    throw new Error('starter SCL1 does not select the bundled SCC1 generation');
  }
  const installed = decodeTi86InstalledState(recordByName.get('DSINST0'));
  if (installed.catalogGenerationKey !== state.catalogGenerationKey) {
    throw new Error('starter SCM1 does not select the bundled SCC1 generation');
  }
  const roster = decodeTi86LearnerRoster(recordByName.get('DSUSERS'));
  const progress = decodeTi86ProgressProjection(recordByName.get('DSPROG'));
  if (progress.deviceId !== 'TI86A'
      || progress.profiles.length !== roster.profiles.length
      || !progress.profiles.every(({ learnerKey }) => roster.profiles.some((profile) => profile.learnerKey === learnerKey))) {
    throw new Error('starter SCG1 does not cover the provisioned learner roster');
  }
  const packs = entries.filter(({ kind }) => kind === 'content-pack');
  if (packs.length !== installed.installedArtifacts.length) {
    throw new Error('starter Catalog and install manifest lesson counts disagree');
  }
  for (const pack of packs) {
    const metadata = installed.installedArtifacts.find(({ artifactId }) => artifactId === pack.artifact.artifactId);
    if (!metadata) throw new Error(`starter Catalog artifact ${pack.artifact.artifactId} is not installed`);
    const artifact = recordByName.get(metadata.variableName);
    if (!artifact) throw new Error(`starter artifact variable ${metadata.variableName} is absent`);
    const view = openSchoolCalcRecord(artifact, { expectedMagic: 'SCP1' });
    if (view.path('artifactId')?.value !== pack.artifact.artifactId
        || view.path('lesson', 'modules')?.count !== pack.artifact.source.moduleIds.length) {
      throw new Error(`starter artifact ${pack.artifact.artifactId} cannot hydrate its modules`);
    }
  }
}

function crc16(bytes) {
  let crc = 0xFFFF;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
  }
  return crc;
}

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
