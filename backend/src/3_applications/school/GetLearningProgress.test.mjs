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
    const logger = { error: vi.fn(), warn: vi.fn() };
    const { evidence, cohorts } = fixture();
    const useCase = new GetLearningProgress({
      evidenceSources: [evidence], cohortDirectory: cohorts,
      followUpSources: [{ listFollowUps: async () => { throw new Error('advisor offline'); } }],
      logger, clock: () => new Date('2026-08-03T00:00:00.000Z'),
    });
    await expect(useCase.execute()).resolves.toMatchObject({ summary: { evidenceCount: 1 }, followUps: [] });
    expect(logger.warn).toHaveBeenCalledWith('school.progress.follow-up-source-failed', { scopeType: 'household', scopeId: 'household', error: 'advisor offline' });
  });

  it('publishes filter options separately from a snapshot', async () => {
    const { useCase } = fixture();
    await expect(useCase.options()).resolves.toMatchObject({ learners: [{ id: 'kid-a' }], scopes: expect.any(Array), periods: [] });
  });

  describe('expectation sources (Task 11: feeding the outline)', () => {
    const outlineRow = (over = {}) => ({
      schema: 'school.learning-evidence/v1', evidenceId: 'e1', learnerId: 'kid-a',
      occurredAt: '2026-08-01T12:00:00.000Z', verification: 'verified',
      activity: { id: 'quiz', kind: 'quiz', sessionId: 's1', graded: true },
      learning: { unitId: 'frac.01' }, measures: { engagements: 1, responses: 1, correct: 1 },
      source: { surface: 'web', transport: 'screen' }, ...over,
    });
    const expectation = (over = {}) => ({
      schema: 'school.learning-expectation/v1', expectationId: 'outline-frac-01',
      scopeType: 'household', scopeId: 'home',
      target: { kind: 'unit', id: 'frac.01' }, dueAt: '9999-12-31T00:00:00.000Z',
      expectedCompletedPercent: 100, ...over,
    });

    it('behaves exactly as before when no expectationSources are wired: empty outstanding, no outline anywhere', async () => {
      const { useCase } = fixture();
      const result = await useCase.execute();
      expect(result.curriculumHistory.outstanding).toEqual([]);
    });

    it('threads a single source\'s expectations into curriculumHistory', async () => {
      const evidence = { listEvidence: vi.fn(async () => [outlineRow()]) };
      const cohorts = {
        resolveScope: vi.fn(async ({ type, id }) => ({ type, id, label: 'Home', learnerIds: ['kid-a'] })),
      };
      const useCase = new GetLearningProgress({
        evidenceSources: [evidence], cohortDirectory: cohorts,
        expectationSources: [{ listExpectations: vi.fn(async () => [expectation()]) }],
        clock: () => new Date('2026-08-03T00:00:00.000Z'),
      });
      const result = await useCase.execute();
      expect(result.curriculumHistory.roots[0]).toMatchObject({
        kind: 'unit', id: 'frac.01',
        outline: { expectationId: 'outline-frac-01', expectedCompletedPercent: 100 },
      });
    });

    it('merges sources: the FIRST source in the array wins a same-target collision', async () => {
      const evidence = { listEvidence: vi.fn(async () => []) };
      const cohorts = {
        resolveScope: vi.fn(async ({ type, id }) => ({ type, id, label: 'Home', learnerIds: ['kid-a'] })),
      };
      const configured = { listExpectations: vi.fn(async () => [expectation({ expectationId: 'configured-wins' })]) };
      const derived = { listExpectations: vi.fn(async () => [expectation({ expectationId: 'derived-loses' })]) };
      const useCase = new GetLearningProgress({
        evidenceSources: [evidence], cohortDirectory: cohorts,
        expectationSources: [configured, derived],
        clock: () => new Date('2026-08-03T00:00:00.000Z'),
      });
      const result = await useCase.execute();
      expect(result.curriculumHistory.outstanding).toEqual([
        expect.objectContaining({ expectationId: 'configured-wins' }),
      ]);
    });

    it('contains a failed optional expectation source without hiding progress', async () => {
      const logger = { error: vi.fn(), warn: vi.fn() };
      const { evidence, cohorts } = fixture();
      const useCase = new GetLearningProgress({
        evidenceSources: [evidence], cohortDirectory: cohorts,
        expectationSources: [{ listExpectations: async () => { throw new Error('outline offline'); } }],
        logger, clock: () => new Date('2026-08-03T00:00:00.000Z'),
      });
      await expect(useCase.execute()).resolves.toMatchObject({ summary: { evidenceCount: 1 } });
      expect(logger.warn).toHaveBeenCalledWith('school.progress.expectation-source-failed', { scopeType: 'household', scopeId: 'household', error: 'outline offline' });
    });
  });
});
