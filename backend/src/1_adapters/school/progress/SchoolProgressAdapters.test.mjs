import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { YamlSchoolAttemptEvidenceSource } from './YamlSchoolAttemptEvidenceSource.mjs';
import { YamlLearningEvidenceRepository } from './YamlLearningEvidenceRepository.mjs';
import { ConfiguredLearningExpectationSource } from './ConfiguredLearningExpectationSource.mjs';
import {
  ConfiguredAcademicPeriodSource,
  ConfiguredSchoolLearningDirectory,
} from './ConfiguredSchoolLearningDirectory.mjs';

const temporaryDirectories = [];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true }));
});

const roster = [
  { id: 'dad', name: 'Dad', birthyear: 1980 },
  { id: 'kid-a', name: 'Alpha', birthyear: 2014 },
  { id: 'kid-b', name: 'Beta', birthyear: 2016 },
];
const users = { getHouseholdRoster: vi.fn(() => roster) };

describe('configured School learner/cohort directory', () => {
  it('filters the household roster through school.yml policy while retaining household order', () => {
    const directory = new ConfiguredSchoolLearningDirectory({
      userService: users, config: { learners: ['kid-b', 'kid-a'] },
      clock: () => new Date('2026-08-01T00:00:00.000Z'),
    });
    expect(directory.listLearners().map(({ id }) => id)).toEqual(['kid-a', 'kid-b']);
    expect(directory.listLearners().map(({ id }) => id)).not.toContain('dad');
  });

  it('falls back to minors only and resolves learner, household, and classroom scopes', () => {
    const directory = new ConfiguredSchoolLearningDirectory({
      userService: users,
      config: { progress: { cohorts: [{ type: 'classroom', id: 'math', label: 'Math class', learnerIds: ['kid-b'] }] } },
      clock: () => new Date('2026-08-01T00:00:00.000Z'),
    });
    expect(directory.listLearners().map(({ id }) => id)).toEqual(['kid-a', 'kid-b']);
    expect(directory.resolveScope({ type: 'learner', id: 'kid-a' })).toMatchObject({ learnerIds: ['kid-a'] });
    expect(directory.resolveScope({ type: 'household', id: 'household' })).toMatchObject({ learnerIds: ['kid-a', 'kid-b'] });
    expect(directory.resolveScope({ type: 'classroom', id: 'math' })).toMatchObject({ learnerIds: ['kid-b'] });
  });

  it('rejects a cohort containing someone excluded from the School roster', () => {
    const directory = new ConfiguredSchoolLearningDirectory({
      userService: users,
      config: {
        learners: ['kid-a'],
        progress: { cohorts: [{ type: 'classroom', id: 'bad', label: 'Bad', learnerIds: ['dad'] }] },
      },
    });
    expect(() => directory.listScopes()).toThrow(/non-learner members: dad/);
  });
});

describe('configured academic periods', () => {
  it('serves arbitrary period kinds from config', () => {
    const source = new ConfiguredAcademicPeriodSource({ config: { progress: { academicPeriods: [{
      periodId: 'fall', kind: 'semester', label: 'Fall',
      startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-12-01T00:00:00.000Z',
    }] } } });
    expect(source.getPeriod('fall')).toMatchObject({ kind: 'semester' });
    expect(source.getPeriod('missing')).toBeNull();
  });
});

describe('YAML attempt evidence adapter', () => {
  it('reads only the requested learners/window and emits domain evidence', () => {
    const datastore = { readAllAttempts: vi.fn(() => [{
      id: 'att-1', at: '2026-08-01T12:00:00.000Z', sessionId: 's1',
      bankId: 'math/work/check', itemId: 'q1', itemType: 'multiple_choice',
      mode: 'quiz', correct: true, attributedTo: 'kid-a', transport: 'screen',
    }]) };
    const source = new YamlSchoolAttemptEvidenceSource({ datastore });
    expect(source.listEvidence({
      learnerIds: ['kid-a'], from: '2026-08-01T00:00:00.000Z', to: '2026-08-02T00:00:00.000Z',
    })).toEqual([expect.objectContaining({ learnerId: 'kid-a', learning: expect.objectContaining({ subjectId: 'math' }) })]);
  });
});

describe('generic School learning evidence repository', () => {
  const reflection = (overrides = {}) => ({
    schema: 'school.learning-evidence/v1', evidenceId: 'reflection-1', learnerId: 'kid-a',
    occurredAt: '2026-08-01T12:00:00.000Z', verification: 'self_reported',
    activity: { id: 'fractions-check', kind: 'reflection', graded: false },
    learning: { subjectId: 'math', conceptIds: ['equivalence'] },
    measures: { engagements: 1, responses: 0, correct: 0 },
    source: { surface: 'web', transport: 'screen' },
    selfRegulation: { phase: 'self_reflection', confidence: 2, strategyIds: [] },
    ...overrides,
  });

  function repositoryFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'school-evidence-'));
    temporaryDirectories.push(root);
    return new YamlLearningEvidenceRepository({
      configService: {
        getUserProfile: (id) => (id === 'kid-a' ? { id } : null),
        getUserDir: (id) => path.join(root, id),
      },
    });
  }

  it('persists date-sharded evidence and reads a half-open time window', () => {
    const repository = repositoryFixture();
    expect(repository.appendEvidence(reflection())).toMatchObject({ status: 'recorded' });
    repository.appendEvidence(reflection({
      evidenceId: 'reflection-2', occurredAt: '2026-08-02T12:00:00.000Z',
    }));

    expect(repository.listEvidence({
      learnerIds: ['kid-a'],
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-02T00:00:00.000Z',
    })).toEqual([expect.objectContaining({ evidenceId: 'reflection-1' })]);
  });

  it('makes an identical retry idempotent and rejects changed reuse of the evidence ID', () => {
    const repository = repositoryFixture();
    repository.appendEvidence(reflection());
    expect(repository.appendEvidence(reflection())).toMatchObject({ status: 'duplicate' });
    expect(() => repository.appendEvidence(reflection({
      selfRegulation: { phase: 'self_reflection', confidence: 5, strategyIds: [] },
    }))).toThrow(/conflicts with its first write/);
  });

  it('does not create a ledger for a profile outside the School roster', () => {
    const repository = repositoryFixture();
    expect(() => repository.appendEvidence(reflection({ learnerId: 'unknown' }))).toThrow(/unknown learner/);
  });
});

describe('configured School learning expectations', () => {
  it('validates data-driven targets and returns only the requested scope and time window', () => {
    const source = new ConfiguredLearningExpectationSource({ config: { progress: { expectations: [
      {
        expectationId: 'fractions-by-friday', scopeType: 'classroom', scopeId: 'math',
        target: { kind: 'unit', id: 'fractions' }, dueAt: '2026-08-08T00:00:00.000Z',
        expectedCompletedPercent: 80,
      },
      {
        expectationId: 'reading-by-friday', scopeType: 'classroom', scopeId: 'reading',
        target: { kind: 'unit', id: 'chapter-one' }, dueAt: '2026-08-08T00:00:00.000Z',
        expectedCompletedPercent: 100,
      },
    ] } } });
    expect(source.listExpectations({
      scope: { type: 'classroom', id: 'math' },
      from: '2026-08-01T00:00:00.000Z', to: '2026-08-09T00:00:00.000Z',
    })).toEqual([expect.objectContaining({ expectationId: 'fractions-by-friday' })]);
  });

  it('fails fast on duplicate expectation identity', () => {
    const entry = {
      expectationId: 'same', scopeType: 'household', scopeId: 'home',
      target: { kind: 'course', id: 'course-a' }, dueAt: '2026-08-08T00:00:00.000Z',
      expectedCompletedPercent: 50,
    };
    expect(() => new ConfiguredLearningExpectationSource({
      config: { progress: { expectations: [entry, entry] } },
    })).toThrow(/duplicate expectationId/);
  });
});
