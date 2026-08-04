import { describe, expect, it, vi } from 'vitest';
import { GetLearningCatalog } from './GetLearningCatalog.mjs';

const catalog = {
  schema: 'school.catalog/v1', catalogId: 'main', title: 'Main', subjects: [{
    subjectId: 'quantitative', title: 'Quantitative', courses: [{
      courseId: 'rates', title: 'Rates', units: [{
        unitId: 'unit-rates', title: 'Unit rates', lessons: [{
          lessonId: 'intro', title: 'Introduction', modules: [{
            moduleId: 'probe', type: 'learning_probe', bankId: 'rates/check',
            phase: 'check', difficulty: 2, conceptIds: ['unit-rate'],
            feedback: { timing: 'immediate', onIncorrect: 'explain_then_retry', maxAttemptsPerItem: 2 },
          }],
        }],
      }],
    }],
  }],
};

describe('GetLearningCatalog', () => {
  it('returns validated authored hierarchy and a surface-neutral hydrated lesson', async () => {
    const lessonBundles = { execute: vi.fn(async () => ({
      schema: 'school.learning-lesson/v1', address: 'main/quantitative/rates/unit-rates/intro',
      context: {}, lesson: { lessonId: 'intro', modules: [] }, capabilities: [],
    })) };
    const query = new GetLearningCatalog({
      catalogs: {
        listCatalogs: async () => [{ catalogId: 'main', title: 'Main' }],
        getCatalog: async () => catalog,
      },
      lessonBundles,
    });
    await expect(query.list()).resolves.toMatchObject({
      schema: 'school.catalog-index/v1',
      catalogs: [{ subjects: [{ courses: [{ units: [{ lessons: [{ lessonId: 'intro' }] }] }] }] }],
    });
    await expect(query.lesson({
      catalogId: 'main', subjectId: 'quantitative', courseId: 'rates',
      unitId: 'unit-rates', lessonId: 'intro',
    })).resolves.toMatchObject({ schema: 'school.learning-lesson/v1', lesson: { lessonId: 'intro' } });
  });

  it('filters every hierarchy level by learner/Guest access and refuses hidden hydration', async () => {
    const withSecondLesson = structuredClone(catalog);
    withSecondLesson.subjects[0].courses[0].units[0].lessons.push({
      lessonId: 'advanced', title: 'Advanced rates', modules: [{
        moduleId: 'quiz', type: 'quiz', bankId: 'rates/advanced',
      }],
    });
    withSecondLesson.installSets = [{
      installSetId: 'whole-unit', title: 'Whole unit',
      lessonAddresses: [
        'main/quantitative/rates/unit-rates/intro',
        'main/quantitative/rates/unit-rates/advanced',
      ],
    }];
    const access = {
      resolve: vi.fn(async ({ learners }) => ({
        learners: learners.map(({ learnerId }) => ({
          learnerId, lessonAddresses: ['main/quantitative/rates/unit-rates/intro'],
        })),
        guest: { lessonAddresses: ['main/quantitative/rates/unit-rates/advanced'] },
      })),
    };
    const lessonBundles = { execute: vi.fn(async (address) => ({
      schema: 'school.learning-lesson/v1', address: Object.values(address).join('/'),
      context: {}, lesson: { lessonId: address.lessonId, modules: [] }, capabilities: [],
    })) };
    const query = new GetLearningCatalog({
      catalogs: {
        listCatalogs: async () => [{ catalogId: 'main', title: 'Main' }],
        getCatalog: async () => withSecondLesson,
      },
      lessonBundles,
      access,
      learners: { hasLearner: async (id) => id === 'kid-a' },
    });

    const learner = await query.list({ learnerId: 'kid-a' });
    expect(learner.catalogs[0].subjects[0].courses[0].units[0].lessons)
      .toEqual([expect.objectContaining({ lessonId: 'intro' })]);
    expect(learner.catalogs[0].installSets).toEqual([]);
    const guest = await query.list();
    expect(guest.catalogs[0].subjects[0].courses[0].units[0].lessons)
      .toEqual([expect.objectContaining({ lessonId: 'advanced' })]);
    await expect(query.lesson({
      learnerId: 'kid-a', catalogId: 'main', subjectId: 'quantitative', courseId: 'rates',
      unitId: 'unit-rates', lessonId: 'advanced',
    })).rejects.toBeInstanceOf(Error);
    expect(lessonBundles.execute).not.toHaveBeenCalled();
    await expect(query.list({ learnerId: 'unknown' })).rejects.toThrow(/unknown learner/);
  });
});
