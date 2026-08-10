#!/usr/bin/env node
/** Build a deterministic resolved-study install for the visual journey lane. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Ti86SchoolCalcCodec,
  encodeTi86StudyPrescription,
} from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import { curateAdaptiveStudy } from '../../../backend/src/2_domains/school/schoolcalc/adaptiveStudy.mjs';
import { BuildAdaptiveStudyArtifact } from '../../../backend/src/3_applications/school/schoolcalc/BuildAdaptiveStudyArtifact.mjs';
import { createTi86StringFile } from './lib/ti86-string-file.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');
const ROOT = path.resolve(EXTENSION, '..', '..');
const DIST = path.join(EXTENSION, 'dist');

const installOutput = execFileSync(process.execPath, [path.join(HERE, 'build-complete-install.mjs')], {
  cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
});
process.stdout.write(installOutput);
const canonicalPath = installOutput.match(/adaptive v1 audited install [^:]+: (.+)\n/)?.[1];
if (!canonicalPath) throw new Error('could not locate the canonical adaptive install');
const canonical = JSON.parse(readFileSync(path.join(canonicalPath, 'complete-install.json'), 'utf8'));

const unit = {
  unitId: 'geometry-diameter', title: 'Circle Geometry', subject: 'math', bank: 'geometry-diameter-bank',
  passing: { percent: 80 },
  schoolcalc: {
    mode: 'adaptive_flashcards',
    study: { cardCount: 1, maxExposuresPerCard: 1 },
    quiz: { itemCount: 1 },
  },
};
const bank = {
  id: 'geometry-diameter-bank', title: 'Circle Geometry',
  items: [{
    id: 'diameter-1', type: 'multiple_choice', prompt: 'Find the diameter.',
    choices: ['6 units', '12 units'], answer: '12 units',
    schoolcalc: {
      promptGraphic: { primitives: [
        { type: 'circle', cx: 50, cy: 50, radius: 35 },
        { type: 'line', x1: 15, y1: 50, x2: 85, y2: 50 },
        { type: 'point', x: 50, y: 50 },
        { type: 'label', x: 56, y: 27, text: '6' },
      ] },
      answerGraphic: { primitives: [
        { type: 'circle', cx: 50, cy: 50, radius: 35 },
        { type: 'line', x1: 15, y1: 50, x2: 85, y2: 50 },
        { type: 'label', x: 42, y: 27, text: '12' },
      ] },
    },
  }],
};
const curation = curateAdaptiveStudy({ unit, bank });
const artifact = await new BuildAdaptiveStudyArtifact({
  codec: new Ti86SchoolCalcCodec(), artifacts: { putArtifact: async (value) => value },
}).execute({ unit, bank, curation });
const prescription = encodeTi86StudyPrescription({
  schema: 'school.calc.study-prescription/v1',
  deviceId: 'TI86A', requestId: 1, sessionCode: '012345',
  prescriptionId: 'JOURNEY1', studySessionId: 'JOURNEY1', learnerKey: 1,
  artifactId: artifact.artifactId, artifactVariableName: artifact.variableName,
  artifactByteLength: artifact.bytes.length, artifactDigest: artifact.byteDigest,
  requiredClientVersion: 1, cardCount: 1, itemCount: 1,
  maxExposuresPerCard: 1, passingPercent: 80, bankRevision: curation.bankRevision,
});
const fixtureFiles = [
  {
    fileName: `${artifact.variableName}.86s`, kind: 'string', magic: 'SCP1',
    bytes: createTi86StringFile({ name: artifact.variableName, record: artifact.bytes, comment: 'SchoolCalc journey artifact' }),
  },
  {
    fileName: 'DSSTUDY.86s', kind: 'string', magic: 'SCSP',
    bytes: createTi86StringFile({ name: 'DSSTUDY', record: prescription, comment: 'SchoolCalc journey prescription' }),
  },
];
const sourceEntries = canonical.transfer.map((entry) => ({
  ...entry, bytes: readFileSync(path.join(canonicalPath, entry.fileName)),
}));
const launcher = sourceEntries.pop();
const ordered = [...sourceEntries, ...fixtureFiles, launcher].map((entry, transferIndex) => ({
  transferIndex,
  fileName: entry.fileName,
  kind: entry.kind,
  ...(entry.magic ? { magic: entry.magic } : {}),
  byteLength: entry.bytes.length,
  sha256: digest(entry.bytes),
  bytes: entry.bytes,
}));
const manifestEntries = ordered.map(({ bytes, ...entry }) => entry);
const releaseId = digest(Buffer.from(JSON.stringify(manifestEntries))).slice(0, 12);
const output = path.join(DIST, `journey-ti86a-${releaseId}`);
mkdirSync(output, { recursive: true });
ordered.forEach(({ fileName, bytes }) => writeFileSync(path.join(output, fileName), bytes));
const manifest = {
  ...canonical,
  releaseId,
  transfer: manifestEntries,
  journeyFixture: {
    schema: 'school.calc.adaptive-journey-fixture/v1', sessionCode: '012345',
    artifactId: artifact.artifactId, bankRevision: curation.bankRevision,
  },
};
writeFileSync(path.join(output, 'complete-install.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`[ti86] adaptive journey fixture ${releaseId}: ${output}\n`);

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
