import { describe, expect, it, vi } from 'vitest';
import { OpenCatalogLearningSession } from './OpenCatalogLearningSession.mjs';

const bundle = {
  schema: 'school.learning-lesson/v1',
  context: {
    catalog: { catalogId: 'main', tags: ['household'] },
    subject: { subjectId: 'quant', areaIds: ['stem'] },
    course: { courseId: 'rates', classifications: ['core'] },
    unit: { unitId: 'unit-rates', tags: ['measurement'] },
  },
  lesson: {
    lessonId: 'intro', tags: ['foundation'], modules: [{
      moduleId: 'check', type: 'learning_probe', conceptIds: ['unit-rate'],
      tags: ['formative'], bank: { id: 'rates/check', title: 'Check', audience: 'assigned', items: [] },
    }],
  },
};

describe('OpenCatalogLearningSession', () => {
  it('re-resolves access and derives immutable bank/mode/evidence context from authored content', async () => {
    const catalog = { lesson: vi.fn(async () => bundle) };
    const grader = { openResolvedSession: vi.fn(() => ({ sessionId: 'ses-1' })) };
    const useCase = new OpenCatalogLearningSession({ catalog, grader });
    const learning = {
      catalogId: 'main', subjectId: 'quant', courseId: 'rates', unitId: 'unit-rates',
      lessonId: 'intro', moduleId: 'check', conceptIds: ['forged'], classifications: ['elective'],
    };
    await expect(useCase.execute({
      learnerId: 'kid-a', learning, bankId: 'rates/check', mode: 'learning_probe',
    })).resolves.toEqual({ sessionId: 'ses-1' });
    expect(catalog.lesson).toHaveBeenCalledWith({
      learnerId: 'kid-a', catalogId: 'main', subjectId: 'quant', courseId: 'rates',
      unitId: 'unit-rates', lessonId: 'intro',
    });
    expect(grader.openResolvedSession).toHaveBeenCalledWith({
      userId: 'kid-a', bankSnapshot: bundle.lesson.modules[0].bank, mode: 'learning_probe',
      fresh: false,
      learningContext: {
        catalogId: 'main', subjectId: 'quant', courseId: 'rates', unitId: 'unit-rates',
        lessonId: 'intro', moduleId: 'check', areaIds: ['stem'], conceptIds: ['unit-rate'],
        classifications: ['core'],
        tags: ['household', 'measurement', 'foundation', 'formative'],
      },
    });
  });

  it('rejects a client mode or bank assertion that disagrees with the publication', async () => {
    const useCase = new OpenCatalogLearningSession({
      catalog: { lesson: async () => bundle },
      grader: { openResolvedSession: vi.fn() },
    });
    const learning = {
      catalogId: 'main', subjectId: 'quant', courseId: 'rates', unitId: 'unit-rates',
      lessonId: 'intro', moduleId: 'check',
    };
    await expect(useCase.execute({ learnerId: 'kid-a', learning, mode: 'quiz' }))
      .rejects.toThrow(/requires mode learning_probe/);
    await expect(useCase.execute({ learnerId: 'kid-a', learning, bankId: 'other' }))
      .rejects.toThrow(/does not use bank other/);
  });

  it('allows a flashcard module to open its linked bank only through the explicit graded test purpose', async () => {
    const flashcardBundle = structuredClone(bundle);
    flashcardBundle.lesson.modules[0] = { ...flashcardBundle.lesson.modules[0], moduleId: 'cards', type: 'flashcards' };
    const grader = { openResolvedSession: vi.fn(() => ({ sessionId: 'test-1' })) };
    const useCase = new OpenCatalogLearningSession({ catalog: { lesson: async () => flashcardBundle }, grader });
    const learning = { catalogId: 'main', subjectId: 'quant', courseId: 'rates', unitId: 'unit-rates', lessonId: 'intro', moduleId: 'cards' };
    await expect(useCase.execute({ learnerId: 'kid-a', learning, bankId: 'rates/check', mode: 'quiz', purpose: 'flashcard_test' })).resolves.toEqual({ sessionId: 'test-1' });
    expect(grader.openResolvedSession).toHaveBeenCalledWith(expect.objectContaining({ mode: 'quiz' }));
  });
  it('builds a limited immutable Test snapshot from server-resolved forms', async () => {
    const flashcardBundle = structuredClone(bundle);
    flashcardBundle.lesson.modules[0] = { ...flashcardBundle.lesson.modules[0], moduleId: 'cards', type: 'flashcards', bank: { ...flashcardBundle.lesson.modules[0].bank, items: [{ id: 'a', type: 'multiple_choice' }, { id: 'b', type: 'matching' }] } };
    const grader = { openResolvedSession: vi.fn(() => ({ sessionId: 'test-1' })) };
    const useCase = new OpenCatalogLearningSession({ catalog: { lesson: async () => flashcardBundle }, grader });
    const learning = { catalogId: 'main', subjectId: 'quant', courseId: 'rates', unitId: 'unit-rates', lessonId: 'intro', moduleId: 'cards' };
    await useCase.execute({ learnerId: 'kid-a', learning, mode: 'quiz', purpose: 'flashcard_test', testPlan: { count: 1, types: ['matching'] } });
    expect(grader.openResolvedSession).toHaveBeenCalledWith(expect.objectContaining({ bankSnapshot: expect.objectContaining({ items: [{ id: 'b', type: 'matching' }] }) }));
  });
});
