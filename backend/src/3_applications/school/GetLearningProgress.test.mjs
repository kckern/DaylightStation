import { describe, expect, it, vi } from 'vitest';
import { GetLearningProgress } from './GetLearningProgress.mjs';

const row = (over = {}) => ({
  schema: 'school.learning-evidence/v1', evidenceId: 'e1', learnerId: 'kid-a',
  occurredAt: '2026-08-01T12:00:00.000Z', verification: 'verified',
  activity: { id: 'quiz', kind: 'quiz', sessionId: 's1', graded: true },
  learning: { subjectId: 'math' }, measures: { engagements: 1, responses: 1, correct: 1 },
  source: { surface: 'web', transport: 'screen' }, ...over,
});

function fixture(over = {}) {
  const evidence = { listEvidence: vi.fn(async () => [row()]) };
  const cohorts = {
    resolveScope: vi.fn(async ({ type, id }) => ({ type, id, label: 'Home', learnerIds: ['kid-a'] })),
    listLearners: vi.fn(async () => [{ id: 'kid-a', name: 'Alpha' }]),
    listScopes: vi.fn(async () => [{ type: 'household', id: 'home', label: 'Home' }]),
  };
  const periods = {
    getPeriod: vi.fn(async () => ({
      schema: 'school.academic-period/v1', periodId: 'fall', kind: 'term', label: 'Fall',
      startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-12-01T00:00:00.000Z',
    })),
    listPeriods: vi.fn(async () => []),
  };
  return {
    evidence, cohorts, periods,
    useCase: new GetLearningProgress({
      evidenceSources: [evidence], cohortDirectory: cohorts, academicPeriods: periods,
      clock: () => new Date('2026-08-03T00:00:00.000Z'), ...over,
    }),
  };
}

describe('GetLearningProgress', () => {
  it('resolves membership and configured academic time before reading evidence', async () => {
    const { useCase, evidence } = fixture();
    const result = await useCase.execute({ scopeType: 'classroom', scopeId: 'algebra', periodId: 'fall' });
    expect(evidence.listEvidence).toHaveBeenCalledWith({
      learnerIds: ['kid-a'], from: '2026-08-01T00:00:00.000Z', to: '2026-12-01T00:00:00.000Z',
    });
    expect(result).toMatchObject({ scope: { type: 'classroom', id: 'algebra' }, summary: { scorePercent: 100 } });
  });

  it('deduplicates identical source evidence and rejects an identity collision', async () => {
    const duplicate = { listEvidence: async () => [row()] };
    const f = fixture();
    const okay = new GetLearningProgress({
      evidenceSources: [f.evidence, duplicate], cohortDirectory: f.cohorts,
      clock: () => new Date('2026-08-03T00:00:00.000Z'),
    });
    await expect(okay.execute()).resolves.toMatchObject({ summary: { evidenceCount: 1 } });

    const conflict = new GetLearningProgress({
      evidenceSources: [f.evidence, { listEvidence: async () => [row({ learnerId: 'kid-b' })] }],
      cohortDirectory: f.cohorts, clock: () => new Date('2026-08-03T00:00:00.000Z'),
    });
    await expect(conflict.execute()).rejects.toThrow(/evidence collision/);
  });

  it('contains a failed optional follow-up provider without hiding progress', async () => {
    const logger = { error: vi.fn() };
    const { evidence, cohorts } = fixture();
    const useCase = new GetLearningProgress({
      evidenceSources: [evidence], cohortDirectory: cohorts,
      followUpSources: [{ listFollowUps: async () => { throw new Error('advisor offline'); } }],
      logger, clock: () => new Date('2026-08-03T00:00:00.000Z'),
    });
    await expect(useCase.execute()).resolves.toMatchObject({ summary: { evidenceCount: 1 }, followUps: [] });
    expect(logger.error).toHaveBeenCalledWith('school.progress.follow-up-source-failed', { error: 'advisor offline' });
  });

  it('publishes filter options separately from a snapshot', async () => {
    const { useCase } = fixture();
    await expect(useCase.options()).resolves.toMatchObject({ learners: [{ id: 'kid-a' }], scopes: expect.any(Array), periods: [] });
  });
});
