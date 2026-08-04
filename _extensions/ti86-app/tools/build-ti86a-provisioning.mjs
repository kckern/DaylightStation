#!/usr/bin/env node
/** Build the first TI-86's device-bound household student roster. */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ti86SchoolCalcCodec } from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import { createTi86StringFile } from './lib/ti86-string-file.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'dist');
const codec = new Ti86SchoolCalcCodec();
const deviceId = 'TI86A';
const generation = 'sha256:ti86a-household-roster-v1';
const profiles = [
  { learnerKey: 1, label: 'Soren' },
  { learnerKey: 2, label: 'Alan' },
  { learnerKey: 3, label: 'Milo' },
  { learnerKey: 4, label: 'Felix' },
];
const progressProfiles = [
  progressProfile({ learnerKey: 1, learnerId: 'soren', scorePercent: 80, correct: 4, total: 5, history: true }),
  progressProfile({ learnerKey: 2, learnerId: 'alan', scorePercent: 100, correct: 3, total: 3 }),
  progressProfile({ learnerKey: 3, learnerId: 'milo', scorePercent: 67, correct: 2, total: 3 }),
  progressProfile({ learnerKey: 4, learnerId: 'felix', scorePercent: 75, correct: 3, total: 4 }),
];

mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'DSID.86s'), createTi86StringFile({
  name: 'DSID', record: codec.encodeDeviceIdentity({ deviceId }), comment: 'SchoolCalc TI86A identity',
}));
writeFileSync(path.join(OUT, 'DSUSERS.86s'), createTi86StringFile({
  name: 'DSUSERS',
  record: codec.encodeLearnerRoster({ schema: 'school.calc.learner-roster/v1', deviceId, generation, profiles }),
  comment: 'SchoolCalc TI86A learners',
}));
writeFileSync(path.join(OUT, 'DSPROG.86s'), createTi86StringFile({
  name: 'DSPROG',
  record: codec.encodeProgressProjection({
    schema: 'school.calc.progress-projection/v1',
    deviceId,
    generation: 'sha256:ti86a-starter-progress-v1',
    profiles: progressProfiles,
  }),
  comment: 'SchoolCalc TI86A progress',
}));
process.stdout.write(`[ti86] provisioned ${deviceId}: ${profiles.map(({ label }) => label).join(', ')}\n`);

function progressProfile({ learnerKey, learnerId, scorePercent, correct, total, history = false }) {
  return {
    learnerKey,
    learnerId,
    summary: {
      evidenceCount: total,
      engagementCount: total,
      responseCount: total,
      correctCount: correct,
      completionCount: 1,
      activityCount: 1,
      assessmentCount: 1,
      scorePercent,
      lastActivityAt: '2026-08-01T18:00:00.000Z',
    },
    recentScores: [{
      activityKind: 'quiz',
      occurredAt: '2026-08-01T18:00:00.000Z',
      verification: 'verified',
      score: { correct, total, percent: scorePercent },
    }],
    followUps: [{
      actionId: `review:${learnerId}:starter`,
      kind: 'review',
      label: 'Review percent',
      availability: 'ready',
      target: { type: 'lesson', id: 'mental-percent' },
      priority: 30,
    }],
    curriculumHistory: history ? {
      roots: [{
        key: 'subject=math', kind: 'subject', id: 'math',
        summary: { activityCount: 1, completionCount: 1, pendingCount: 0, scorePercent },
        children: [{
          key: 'subject=math|course=mental-percent', kind: 'course', id: 'mental-percent',
          summary: { activityCount: 1, completionCount: 1, pendingCount: 0, scorePercent },
          children: [],
        }],
      }],
    } : { roots: [] },
  };
}
