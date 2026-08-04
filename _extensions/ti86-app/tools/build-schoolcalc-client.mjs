#!/usr/bin/env node
/** Build the complete first-party TI-86 client release as one transfer group. */
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  createTi86ProgramGroup,
  verifyTi86ProgramGroup,
} from './lib/ti86-program.mjs';
import { createTi86ClientReleaseManifest } from './lib/ti86-runtime-module.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');
const ROOT = path.resolve(EXTENSION, '..', '..');
const DIST = path.join(EXTENSION, 'dist');
const VERSION = '0.1.0';

runBuilder('build-schoolcalc-shell.mjs');
runBuilder('build-standard-runtime.mjs');
runBuilder('build-qr-runtime.mjs');
runBuilder('build-catalog-runtime.mjs');
runBuilder('build-request-runtime.mjs');
runBuilder('build-result-queue-runtime.mjs');
runBuilder('build-sync-runtime.mjs');
runBuilder('build-native-runtime.mjs');
runBuilder('build-profile-runtime.mjs');
runBuilder('build-tutor-runtime.mjs');

const shellFile = readFileSync(path.join(DIST, 'SCHLCALC.86p'));
const standardRuntimeFile = readFileSync(path.join(DIST, 'SCLEARN.86p'));
const qrRuntimeFile = readFileSync(path.join(DIST, 'SCQR.86p'));
const catalogRuntimeFile = readFileSync(path.join(DIST, 'SCCAT.86p'));
const requestRuntimeFile = readFileSync(path.join(DIST, 'SCREQ.86p'));
const resultQueueRuntimeFile = readFileSync(path.join(DIST, 'SCQUEUE.86p'));
const syncRuntimeFile = readFileSync(path.join(DIST, 'SCSYNC.86p'));
const nativeRuntimeFile = readFileSync(path.join(DIST, 'SCNATIVE.86p'));
const profileRuntimeFile = readFileSync(path.join(DIST, 'SCPROF.86p'));
const tutorRuntimeFile = readFileSync(path.join(DIST, 'SCTUTOR.86p'));
const coreProgramFiles = [
  shellFile, standardRuntimeFile, qrRuntimeFile, catalogRuntimeFile, requestRuntimeFile,
  resultQueueRuntimeFile,
  syncRuntimeFile,
  nativeRuntimeFile,
  profileRuntimeFile,
];
const manifest = createTi86ClientReleaseManifest({
  version: VERSION,
  shellFile,
  moduleFiles: [
    standardRuntimeFile, qrRuntimeFile, catalogRuntimeFile, requestRuntimeFile,
    resultQueueRuntimeFile,
    syncRuntimeFile,
    nativeRuntimeFile,
    profileRuntimeFile,
    tutorRuntimeFile,
  ],
});
// A TI-86 group file has a 16-bit data-section length. The tenth reviewed
// runtime therefore ships as a second atomic transfer group while the release
// manifest still pins the complete installed client.
const coreGroup = createTi86ProgramGroup({
  programFiles: coreProgramFiles,
  comment: `SchoolCalc TI-86 client ${VERSION}`,
});
verifyTi86ProgramGroup(coreGroup, {
  expectedNames: ['SCHLCALC', 'SCLEARN', 'SCQR', 'SCCAT', 'SCREQ', 'SCQUEUE', 'SCSYNC', 'SCNATIVE', 'SCPROF'],
});
const tutorGroup = createTi86ProgramGroup({
  programFiles: [tutorRuntimeFile],
  comment: `SchoolCalc TI-86 tutor ${VERSION}`,
});
verifyTi86ProgramGroup(tutorGroup, { expectedNames: ['SCTUTOR'] });

mkdirSync(DIST, { recursive: true });
writeFileSync(path.join(DIST, 'SCHOOLCALC.86g'), coreGroup);
writeFileSync(path.join(DIST, 'SCTUTOR.86g'), tutorGroup);
writeFileSync(path.join(DIST, 'schoolcalc-client-release.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`[ti86] built ${path.join(DIST, 'SCHOOLCALC.86g')} (${coreGroup.length} bytes; core programs)\n`);
process.stdout.write(`[ti86] built ${path.join(DIST, 'SCTUTOR.86g')} (${tutorGroup.length} bytes; SCTUTOR)\n`);
process.stdout.write(`[ti86] wrote digest-pinned release manifest ${VERSION}\n`);

function runBuilder(filename) {
  const result = spawnSync(process.execPath, [path.join(HERE, filename)], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`${filename} failed:\n${result.stdout}${result.stderr}`);
  process.stdout.write(result.stdout);
}
