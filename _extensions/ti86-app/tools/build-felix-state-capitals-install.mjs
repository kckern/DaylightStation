#!/usr/bin/env node
/** Build the audited TI86A Adaptive Study install requested for Felix. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GeneratedBankSource } from '../../../backend/src/1_adapters/school/generated-content/GeneratedBankSource.mjs';
import {
  Ti86SchoolCalcCodec,
  decodeTi86Envelope,
  decodeTi86StudyPrescription,
  encodeTi86StudyPrescription,
} from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import { curateAdaptiveStudy } from '../../../backend/src/2_domains/school/schoolcalc/adaptiveStudy.mjs';
import { BuildAdaptiveStudyArtifact } from '../../../backend/src/3_applications/school/schoolcalc/BuildAdaptiveStudyArtifact.mjs';
import { createTi86StringFile } from './lib/ti86-string-file.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');
const ROOT = path.resolve(EXTENSION, '..', '..');
const DIST = path.join(EXTENSION, 'dist');
const GENERATED_BANKS = path.join(ROOT, 'data', 'content', 'school', 'generated-banks');

const DEVICE_ID = 'TI86A';
const LEARNER_ID = 'felix';
const LEARNER_KEY = 4;
const SESSION_CODE = '000000';
const PRESCRIPTION_ID = 'FELIXCAP1';
const STUDY_SESSION_ID = 'FELIXCAP1';

const canonicalOutput = execFileSync(process.execPath, [path.join(HERE, 'build-complete-install.mjs')], {
  cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
});
process.stdout.write(canonicalOutput);
const canonicalPath = canonicalOutput.match(/adaptive v1 audited install [^:]+: (.+)\n/)?.[1];
if (!canonicalPath) throw new Error('could not locate the canonical Adaptive Study install');
const canonical = JSON.parse(readFileSync(path.join(canonicalPath, 'complete-install.json'), 'utf8'));

const bank = new GeneratedBankSource({ dataDir: GENERATED_BANKS }).resolve('geo:us-state-capitals');
if (!bank || bank.items.length !== 50) throw new Error('canonical US state-capitals bank is unavailable or incomplete');
const unit = {
  unitId: 'us-state-capitals',
  courseId: 'geography',
  title: 'US State Capitals',
  subject: 'geography',
  bank: bank.id,
  passing: { percent: 80 },
  schoolcalc: {
    mode: 'adaptive_flashcards',
    study: { cardCount: 12, maxExposuresPerCard: 4 },
    quiz: { itemCount: 10 },
  },
};
const curation = curateAdaptiveStudy({ unit, bank });
const artifact = await new BuildAdaptiveStudyArtifact({
  codec: new Ti86SchoolCalcCodec(),
  artifacts: { putArtifact: async (value) => value },
}).execute({ unit, bank, curation });
const prescription = encodeTi86StudyPrescription({
  schema: 'school.calc.study-prescription/v1',
  deviceId: DEVICE_ID,
  requestId: 1,
  sessionCode: SESSION_CODE,
  prescriptionId: PRESCRIPTION_ID,
  studySessionId: STUDY_SESSION_ID,
  learnerKey: LEARNER_KEY,
  artifactId: artifact.artifactId,
  artifactVariableName: artifact.variableName,
  artifactByteLength: artifact.bytes.length,
  artifactDigest: artifact.byteDigest,
  requiredClientVersion: 1,
  cardCount: curation.policy.cardCount,
  itemCount: curation.policy.itemCount,
  maxExposuresPerCard: curation.policy.maxExposuresPerCard,
  passingPercent: curation.policy.passingPercent,
  bankRevision: curation.bankRevision,
});

const decodedArtifact = decodeTi86Envelope(artifact.bytes, 'SCP1');
const decodedPrescription = decodeTi86StudyPrescription(prescription);
const cardIds = decodedArtifact.lesson.modules[0].bank.items.map(({ id }) => id);
const quizIds = decodedArtifact.lesson.modules[1].bank.items.map(({ id }) => id);
if (decodedArtifact.context.subject.title !== 'geography'
    || cardIds.join('\n') !== curation.cardIds.join('\n')
    || quizIds.join('\n') !== curation.quizIds.join('\n')) {
  throw new Error('compiled state-capitals artifact changed its subject or authored item order');
}
if (decodedPrescription.deviceId !== DEVICE_ID
    || decodedPrescription.learnerKey !== LEARNER_KEY
    || decodedPrescription.sessionCode !== SESSION_CODE
    || decodedPrescription.cardCount !== 12
    || decodedPrescription.itemCount !== 10) {
  throw new Error('Felix state-capitals prescription binding is invalid');
}

const fixtureFiles = [
  {
    fileName: `${artifact.variableName}.86s`, kind: 'string', magic: 'SCP1',
    bytes: createTi86StringFile({
      name: artifact.variableName,
      record: artifact.bytes,
      comment: 'Felix state capitals artifact',
    }),
  },
  {
    fileName: 'DSSTUDY.86s', kind: 'string', magic: 'SCSP',
    bytes: createTi86StringFile({
      name: 'DSSTUDY',
      record: prescription,
      comment: 'Felix state capitals prescription',
    }),
  },
];
const sourceEntries = canonical.transfer.map((entry) => ({
  ...entry,
  bytes: readFileSync(path.join(canonicalPath, entry.fileName)),
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
const transfer = ordered.map(({ bytes, ...entry }) => entry);
const releaseId = digest(Buffer.from(JSON.stringify(transfer))).slice(0, 12);
const output = path.join(DIST, `state-capitals-felix-${releaseId}`);
mkdirSync(output, { recursive: true });
ordered.forEach(({ fileName, bytes }) => writeFileSync(path.join(output, fileName), bytes));
const manifest = {
  ...canonical,
  releaseId,
  transfer,
  provisioning: {
    schema: 'school.calc.adaptive-provisioning/v1',
    deviceId: DEVICE_ID,
    learnerId: LEARNER_ID,
    learnerKey: LEARNER_KEY,
    sessionCode: SESSION_CODE,
    prescriptionId: PRESCRIPTION_ID,
    studySessionId: STUDY_SESSION_ID,
    bankId: bank.id,
    bankRevision: curation.bankRevision,
    artifactId: artifact.artifactId,
    artifactVariableName: artifact.variableName,
    cardIds: curation.cardIds,
    quizIds: curation.quizIds,
    policy: curation.policy,
  },
};
writeFileSync(path.join(output, 'complete-install.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`[ti86] Felix state-capitals install ${releaseId}: ${output}\n`);
process.stdout.write(`[ti86] code ${SESSION_CODE}; ${cardIds.length} cards; ${quizIds.length} quiz items; artifact ${artifact.variableName}\n`);

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
