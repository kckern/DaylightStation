#!/usr/bin/env node
/** Build and audit the canonical SchoolCalc Adaptive Study v1 installation. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTi86StringFile } from './inspect-ti86-string.mjs';
import { openSchoolCalcRecord } from './lib/schoolcalc-record-view.mjs';
import { verifyTi86BasicProgram, verifyTi86Program } from './lib/ti86-program.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');
const ROOT = path.resolve(EXTENSION, '..', '..');
const DIST = path.join(EXTENSION, 'dist');

for (const builder of [
  'build-schoolcalc-shell.mjs',
  'build-standard-runtime.mjs',
  'build-result-queue-runtime.mjs',
  'build-qr-runtime.mjs',
  'build-sync-runtime.mjs',
  'build-schoolcalc-launcher.mjs',
  'build-ti86a-provisioning.mjs',
]) {
  execFileSync(process.execPath, [path.join(HERE, builder)], { cwd: ROOT, stdio: 'inherit' });
}

const transfer = [
  file('SCHLCALC.86p', 'program'),
  file('SCLEARN.86p', 'program'),
  file('SCQUEUE.86p', 'program'),
  file('SCQR.86p', 'program'),
  file('SCSYNC.86p', 'program'),
  file('DSID.86s', 'string', 'SCI1'),
  // A partially transferred release must never look launchable.
  file('ASCHL.86p', 'basic-launcher'),
];

const programs = transfer.filter(({ kind }) => kind === 'program').map((entry) => (
  verifyTi86Program(entry.bytes, { expectedName: path.basename(entry.name, '.86p') })
));
verifyTi86BasicProgram(transfer.at(-1).bytes, { expectedName: 'ASCHL' });

const identity = parseTi86StringFile(transfer.find(({ name }) => name === 'DSID.86s').bytes);
if (identity.name !== 'DSID') throw new Error(`DSID.86s contains ${identity.name}`);
const identityRecord = identity.variableData.subarray(2);
verifyEnvelope(identityRecord, 'SCI1');
const identityView = openSchoolCalcRecord(identityRecord, { expectedMagic: 'SCI1' });
if (identityView.path('deviceId')?.value !== 'TI86A') throw new Error('DSID device binding is invalid');

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

const manifest = {
  schema: 'school.calc.ti86-complete-install/v1',
  product: 'schoolcalc-adaptive-study/v1',
  releaseId,
  deviceId: 'TI86A',
  programs: programs.map(({ name }) => name),
  launcher: 'ASCHL',
  inactiveLearnerRoutes: ['SCCAT', 'SCPROF', 'SCTUTOR', 'SCNATIVE', 'SCREQ'],
  transfer: entries,
};
writeFileSync(path.join(bundle, 'complete-install.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`[ti86] adaptive v1 audited install ${releaseId}: ${bundle}\n`);
process.stdout.write(`[ti86] ${manifest.programs.length} assembly programs, DSID, launcher; inactive routes omitted\n`);

function file(name, kind, magic = null) {
  const source = path.join(DIST, name);
  return { name, source, kind, magic, bytes: readFileSync(source) };
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
