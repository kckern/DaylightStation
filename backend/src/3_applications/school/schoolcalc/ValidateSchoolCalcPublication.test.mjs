import { describe, expect, it, vi } from 'vitest';
import { ValidateSchoolCalcPublication } from './ValidateSchoolCalcPublication.mjs';

const catalog = {
  schema: 'school.catalog/v1',
  catalogId: 'main',
  title: 'Main',
  subjects: [{
    subjectId: 'quantitative-studies',
    title: 'Quantitative studies',
    courses: [{
      courseId: 'foundations',
      title: 'Foundations',
      units: [{
        unitId: 'first-unit',
        title: 'First unit',
        lessons: [
          {
            lessonId: 'alpha',
            title: 'Alpha',
            modules: [{
              moduleId: 'notes', type: 'lecture_notes', documentId: 'notes-alpha',
            }],
          },
          {
            lessonId: 'beta',
            title: 'Beta',
            modules: [{
              moduleId: 'check', type: 'quiz', bankId: 'checks:beta',
            }],
          },
        ],
      }],
    }],
  }],
};

function address(lessonId) {
  return `main/quantitative-studies/foundations/first-unit/${lessonId}`;
}

function harness({ summaries = [{ catalogId: 'main', title: 'Main' }], raw = catalog, failures = {} } = {}) {
  const execute = vi.fn(async (context) => {
    const lessonAddress = address(context.lessonId);
    if (failures[lessonAddress]) throw new Error(failures[lessonAddress]);
    const module = context.lessonId === 'alpha'
      ? { moduleId: 'notes', type: 'lecture_notes', document: {} }
      : { moduleId: 'check', type: 'quiz', bank: {} };
    return {
      lesson: { modules: [module] },
      capabilities: context.lessonId === 'alpha'
        ? ['reader@1']
        : ['quiz@1', 'response.choice@1'],
    };
  });
  return {
    execute,
    validator: new ValidateSchoolCalcPublication({
      catalogs: {
        listCatalogs: async () => summaries,
        getCatalog: async () => raw,
      },
      bundles: { execute },
    }),
  };
}

describe('ValidateSchoolCalcPublication', () => {
  it('eagerly resolves every lesson and returns deterministic promotion evidence', async () => {
    const { validator, execute } = harness();
    const result = await validator.execute();

    expect(result).toEqual({
      schema: 'school.calc.publication-report/v1',
      ok: true,
      catalogErrors: {},
      lessonErrors: {},
      capabilities: ['quiz@1', 'reader@1', 'response.choice@1'],
      summary: {
        catalogs: 1,
        validCatalogs: 1,
        installSets: 0,
        lessons: 2,
        validLessons: 2,
        modules: 2,
        resolvedModules: 2,
      },
    });
    expect(execute.mock.calls.map(([context]) => context.lessonId)).toEqual(['alpha', 'beta']);
  });

  it('reports a dangling lesson reference without hiding later valid lessons', async () => {
    const { validator, execute } = harness({
      failures: { [address('alpha')]: "SchoolCalc document 'notes-alpha' was not found" },
    });
    const result = await validator.execute();

    expect(result.ok).toBe(false);
    expect(result.lessonErrors).toEqual({
      [address('alpha')]: ["SchoolCalc document 'notes-alpha' was not found"],
    });
    expect(result.summary).toMatchObject({ lessons: 2, validLessons: 1, modules: 2, resolvedModules: 1 });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('aggregates malformed, mismatched, duplicate, and unavailable catalogs', async () => {
    const raws = {
      broken: { schema: 'wrong', catalogId: 'broken' },
      mismatch: { ...catalog, catalogId: 'other' },
      missing: null,
    };
    const validator = new ValidateSchoolCalcPublication({
      catalogs: {
        listCatalogs: async () => [
          { catalogId: 'missing' },
          { catalogId: 'broken' },
          { catalogId: 'mismatch' },
          { catalogId: 'missing' },
          { title: 'No identity' },
        ],
        getCatalog: async (catalogId) => raws[catalogId],
      },
      bundles: { execute: vi.fn() },
    });

    const result = await validator.execute();
    expect(result.ok).toBe(false);
    expect(result.catalogErrors.broken).toEqual(expect.arrayContaining([
      'schema must be school.catalog/v1',
      'catalog.title: is required',
      'subjects: must be a non-empty array',
    ]));
    expect(result.catalogErrors.mismatch).toEqual([
      "catalog 'mismatch' declares catalogId 'other'",
    ]);
    expect(result.catalogErrors.missing).toEqual([
      "catalog 'missing' was listed but could not be loaded",
      "duplicate catalog summary 'missing'",
    ]);
    expect(result.catalogErrors['$catalogs[4]']).toEqual(['catalog summary has no catalogId']);
    expect(result.summary).toMatchObject({ catalogs: 5, validCatalogs: 0, lessons: 0 });
  });

  it('turns repository discovery failure into a fail-closed report', async () => {
    const validator = new ValidateSchoolCalcPublication({
      catalogs: { listCatalogs: async () => { throw new Error('mount unreadable'); } },
      bundles: { execute: vi.fn() },
    });

    await expect(validator.execute()).resolves.toMatchObject({
      ok: false,
      catalogErrors: { $catalogs: ['catalog discovery failed: mount unreadable'] },
      summary: { catalogs: 0, validCatalogs: 0, lessons: 0, validLessons: 0 },
    });
  });

  it('rejects an empty publication mount', async () => {
    const { validator } = harness({ summaries: [] });

    await expect(validator.execute()).resolves.toMatchObject({
      ok: false,
      catalogErrors: { $catalogs: ['no catalogs were published'] },
      summary: { catalogs: 0, validCatalogs: 0 },
    });
  });
});
