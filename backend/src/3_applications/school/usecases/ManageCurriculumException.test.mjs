import { describe, it, expect, vi } from 'vitest';
import { ManageCurriculumException } from './ManageCurriculumException.mjs';

function fixture() {
  const history = [];
  const store = {
    append: vi.fn(async (record) => history.push(record)),
    list: vi.fn(async () => history),
    active: vi.fn(async () => history.filter((record) => record.operation === 'applied'
      && !history.some((candidate) => candidate.operation === 'retracted' && candidate.exceptionId === record.exceptionId))),
  };
  const service = new ManageCurriculumException({
    store,
    curriculum: { listUnits: async () => [
      { unitId: 'lesson-1', module: 'module-a', courseId: 'course-1' },
      { unitId: 'lesson-2', module: 'module-a', courseId: 'course-1' },
      { unitId: 'replacement', module: 'module-b', courseId: 'course-1' },
    ] },
    teacherGate: { assert: vi.fn() }, clock: () => new Date('2026-08-24T12:00:00.000Z'),
  });
  return { service, history };
}

describe('ManageCurriculumException', () => {
  it.each([
    ['excused', { advancesGate: true, grantsMastery: false }],
    ['deferred', { remainsOutstanding: true }],
    ['replaced', { advancesGate: true, grantsMastery: false }],
  ])('previews and appends learner exception %s', async (kind, effect) => {
    const { service, history } = fixture();
    const args = { kind, learnerId: 'learner3', targetType: 'lesson', targetId: 'lesson-1',
      replacementLessonId: kind === 'replaced' ? 'replacement' : null,
      reason: 'learner-specific decision', decidedBy: 'parent', apply: true };
    const receipt = await service.execute(args);
    expect(receipt).toMatchObject({ applied: true, effects: effect,
      exception: { kind, learnerId: 'learner3', resolvedLessonIds: ['lesson-1'] } });
    expect(history).toHaveLength(1);
  });

  it('snapshots a paused module and retracts it without deleting history', async () => {
    const { service, history } = fixture();
    const applied = await service.execute({ kind: 'paused', targetType: 'module', targetId: 'module-a', courseId: 'course-1',
      reason: 'broken', decidedBy: 'parent', apply: true });
    expect(applied.exception.resolvedLessonIds).toEqual(['lesson-1', 'lesson-2']);
    const retracted = await service.retract({ exceptionId: applied.exception.exceptionId,
      reason: 'content repaired', retractedBy: 'parent', apply: true });
    expect(retracted.applied).toBe(true);
    expect(history.map((record) => record.operation)).toEqual(['applied', 'retracted']);
    expect((await service.list()).active).toEqual([]);
  });

  it('rejects a global pause for a learner difficulty rationale', async () => {
    const { service } = fixture();
    await expect(service.execute({ kind: 'paused', targetType: 'lesson', targetId: 'lesson-1',
      reason: 'too hard for Learner3', decidedBy: 'parent' })).rejects.toThrow(/paused reason/);
  });
});
