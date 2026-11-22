/**
 * YamlLearningEvidenceRepository.listEvidence with a window reads only the day
 * files the window can touch, and answers exactly what reading every file
 * and filtering rows answered before.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const reads = [];
vi.mock('#system/utils/FileIO.mjs', async () => {
  const actual = await vi.importActual('#system/utils/FileIO.mjs');
  return {
    ...actual,
    loadYamlSafe: (file) => { reads.push(path.basename(file)); return actual.loadYamlSafe(file); },
  };
});

const { YamlLearningEvidenceRepository } = await import(
  '../../../../__app_modules/learning/school/server/adapters/progress/YamlLearningEvidenceRepository.mjs'
);

const row = (learnerId, occurredAt, n) => ({
  schema: 'school.learning-evidence/v1', evidenceId: `${learnerId}-${n}`, learnerId, occurredAt,
  verification: 'verified', activity: { kind: 'piano_lesson' },
});
const yaml = (rows) => rows.map((r) => [
  `- schema: ${r.schema}`, `  evidenceId: ${r.evidenceId}`, `  learnerId: ${r.learnerId}`,
  `  occurredAt: '${r.occurredAt}'`, `  verification: ${r.verification}`, '  activity:', `    kind: ${r.activity.kind}`,
].join('\n')).join('\n') + '\n';

const FIXTURE = {
  'kid-a': {
    '2026-11-14': ['2026-11-14T08:00:00.000Z', '2026-11-14T23:59:59.999Z'],
    '2026-11-15': ['2026-11-15T00:00:00.000Z', '2026-11-15T12:00:00.000Z'],
    '2026-11-18': ['2026-11-18T03:00:00.000Z'],
    '2026-11-23': ['2026-11-23T00:00:00.000Z', '2026-11-23T11:59:00.000Z', '2026-11-23T23:00:00.000Z'],
    '2026-11-24': ['2026-11-24T10:00:00.000Z'],
    '2026-12-01': ['2026-12-01T10:00:00.000Z'],
  },
  'kid-b': {
    '2026-11-16': ['2026-11-16T09:00:00.000Z'],
    '2026-11-25': ['2026-11-25T09:00:00.000Z'],
  },
};

let root;
let repo;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-evidence-window-'));
  for (const [learner, days] of Object.entries(FIXTURE)) {
    const dir = path.join(root, learner, 'apps', 'school', 'learning-evidence');
    fs.mkdirSync(dir, { recursive: true });
    let n = 0;
    for (const [day, stamps] of Object.entries(days)) {
      fs.writeFileSync(path.join(dir, `${day}.yml`), yaml(stamps.map((at) => row(learner, at, n++))));
    }
    fs.writeFileSync(path.join(dir, 'notes.yml'), 'not: evidence\n');
  }
  repo = new YamlLearningEvidenceRepository({
    configService: { getUserDir: (id) => path.join(root, id), getUserProfile: (id) => (FIXTURE[id] ? { id } : null) },
  });
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
beforeEach(() => { reads.length = 0; });

// The old behavior: every day file read, then rows kept by string comparison.
function oracle(learnerIds, from, to) {
  return repo.listEvidence({ learnerIds })
    .filter((e) => (from === null || e.occurredAt >= from) && (to === null || e.occurredAt < to));
}

const WINDOWS = [
  ['2026-11-15T00:00:00.000Z', '2026-11-25T00:00:00.000Z'],
  ['2026-11-14T23:59:59.999Z', '2026-11-15T00:00:00.000Z'],
  ['2026-11-15T00:00:00.001Z', '2026-11-23T11:59:00.000Z'],
  ['2026-11-23T11:59:00.000Z', '2026-11-23T11:59:00.001Z'],
  ['2026-11-16', '2026-11-24'],
  ['2026-11-01T00:00:00.000Z', null],
  [null, '2026-11-18T03:00:00.001Z'],
  [null, null],
  ['2027-01-01T00:00:00.000Z', '2027-02-01T00:00:00.000Z'],
  ['not-a-date', '2026-11-16T00:00:00.000Z'],
];

describe('YamlLearningEvidenceRepository.listEvidence — windowed reads', () => {
  it.each(WINDOWS)('matches reading every file for [%s, %s)', (from, to) => {
    const expected = oracle(['kid-a', 'kid-b'], from, to);
    expect(repo.listEvidence({ learnerIds: ['kid-a', 'kid-b'], from, to })).toEqual(expected);
  });

  it('reads only the day files whose name is in [from day, to day]', () => {
    repo.listEvidence({ learnerIds: ['kid-a', 'kid-b'], from: '2026-11-15T00:00:00.000Z', to: '2026-11-23T12:00:00.000Z' });
    expect(reads.sort()).toEqual(['2026-11-15', '2026-11-16', '2026-11-18', '2026-11-23']);
  });

  it('still reads everything on a side with no date bound', () => {
    repo.listEvidence({ learnerIds: ['kid-a'], from: null, to: '2026-11-15T00:00:00.000Z' });
    expect(reads.sort()).toEqual(['2026-11-14', '2026-11-15']);
    reads.length = 0;
    repo.listEvidence({ learnerIds: ['kid-a'] });
    expect(reads).toHaveLength(Object.keys(FIXTURE['kid-a']).length);
  });

  it('never reads a corrupt file outside the window', () => {
    const dir = path.join(root, 'kid-b', 'apps', 'school', 'learning-evidence');
    fs.writeFileSync(path.join(dir, '2026-10-01.yml'), 'not: a list\n');
    try {
      expect(() => repo.listEvidence({ learnerIds: ['kid-b'], from: '2026-11-01T00:00:00.000Z', to: null })).not.toThrow();
      expect(() => repo.listEvidence({ learnerIds: ['kid-b'] })).toThrow(/corrupt/);
    } finally {
      fs.rmSync(path.join(dir, '2026-10-01.yml'));
    }
  });
});
