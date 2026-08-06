import { describe, expect, it } from 'vitest';
import { CurriculumExpectationSource } from './CurriculumExpectationSource.mjs';

const unit = ({ unitId, courseId, sequence = 1, subject = 'math' }) => ({
  unitId, courseId, sequence, subject, title: unitId, objectives: [], grades: [],
});

function fakeCurriculum(units) {
  return { listUnits: async () => units };
}

describe('CurriculumExpectationSource', () => {
  it('emits one expectation per cataloged unit, grouped by course, ordered by authored sequence', async () => {
    const units = [
      unit({ unitId: 'frac.02', courseId: 'math-fractions', sequence: 2 }),
      unit({ unitId: 'frac.01', courseId: 'math-fractions', sequence: 1 }),
      unit({ unitId: 'caps.01', courseId: 'history-capitals', sequence: 1, subject: 'history' }),
    ];
    const source = new CurriculumExpectationSource({ curriculum: fakeCurriculum(units) });
    const result = await source.listExpectations({ scope: { type: 'household', id: 'home' } });

    expect(result).toHaveLength(3);
    result.forEach((expectation) => {
      expect(expectation).toMatchObject({
        schema: 'school.learning-expectation/v1',
        scopeType: 'household', scopeId: 'home',
      });
    });
    const fractionUnitIds = result
      .filter((e) => e.target.id.startsWith('frac.'))
      .map((e) => e.target.id);
    expect(fractionUnitIds).toEqual(['frac.01', 'frac.02']);
    expect(result.map((e) => e.target)).toEqual(expect.arrayContaining([
      { kind: 'unit', id: 'frac.01' }, { kind: 'unit', id: 'frac.02' }, { kind: 'unit', id: 'caps.01' },
    ]));
  });

  it('answers at whatever scope is asked — it has no fixed scope of its own', async () => {
    const units = [unit({ unitId: 'frac.01', courseId: 'math-fractions' })];
    const source = new CurriculumExpectationSource({ curriculum: fakeCurriculum(units) });
    const household = await source.listExpectations({ scope: { type: 'household', id: 'home' } });
    const learner = await source.listExpectations({ scope: { type: 'learner', id: 'kid-a' } });
    expect(household).toHaveLength(1);
    expect(learner).toHaveLength(1);
    expect(household[0].scopeType).toBe('household');
    expect(learner[0].scopeType).toBe('learner');
    expect(learner[0].scopeId).toBe('kid-a');
  });

  it('skips units with no courseId — the honesty rule: no course, no outline claim', async () => {
    const units = [
      unit({ unitId: 'orphan', courseId: null }),
      unit({ unitId: 'frac.01', courseId: 'math-fractions' }),
    ];
    const source = new CurriculumExpectationSource({ curriculum: fakeCurriculum(units) });
    const result = await source.listExpectations({ scope: { type: 'household', id: 'home' } });
    expect(result.map((e) => e.target.id)).toEqual(['frac.01']);
  });

  it('an empty catalog emits nothing', async () => {
    const source = new CurriculumExpectationSource({ curriculum: fakeCurriculum([]) });
    expect(await source.listExpectations({ scope: { type: 'household', id: 'home' } })).toEqual([]);
  });

  it('synthesizes dueAt to land inside a bounded [from, to) window, so a period-scoped query still sees it', async () => {
    const units = [unit({ unitId: 'frac.01', courseId: 'math-fractions' })];
    const source = new CurriculumExpectationSource({ curriculum: fakeCurriculum(units) });
    const result = await source.listExpectations({
      scope: { type: 'household', id: 'home' },
      from: '2026-08-01T00:00:00.000Z', to: '2026-12-01T00:00:00.000Z',
    });
    expect(result).toHaveLength(1);
    expect(result[0].dueAt >= '2026-08-01T00:00:00.000Z').toBe(true);
    expect(result[0].dueAt < '2026-12-01T00:00:00.000Z').toBe(true);
  });

  it('an unbounded query (no to) still returns the outline', async () => {
    const units = [unit({ unitId: 'frac.01', courseId: 'math-fractions' })];
    const source = new CurriculumExpectationSource({ curriculum: fakeCurriculum(units) });
    const result = await source.listExpectations({ scope: { type: 'household', id: 'home' } });
    expect(result).toHaveLength(1);
  });

  it('rejects a bad expectedCompletedPercent at construction', () => {
    expect(() => new CurriculumExpectationSource({
      curriculum: fakeCurriculum([]), expectedCompletedPercent: 0,
    })).toThrow(/expectedCompletedPercent/);
  });

  it('requires a curriculum accessor', () => {
    expect(() => new CurriculumExpectationSource({})).toThrow(/curriculum/);
  });
});
