import { describe, expect, it, vi } from 'vitest';
import { validateFlashcardEnrollment } from './index.mjs';
import { createSchoolProgramEnrollmentValidators } from '#apps/school/SchoolProgramEnrollmentValidators.mjs';
import { SetAssignments } from '#apps/school/usecases/SetAssignments.mjs';

const DECK = 'language/korean/week-01-classroom';

describe('flashcard enrollment policy.mode', () => {
  it('defaults to fsrs and keeps existing FSRS policies unchanged', () => {
    const { errors, enrollment } = validateFlashcardEnrollment({ programId: 'flashcards', deckId: 'biology/cells', policy: { minimumReviews: 2 } });
    expect(errors).toEqual([]);
    expect(enrollment.policy).toEqual({ mode: 'fsrs', minimumReviews: 2 });
  });
  it('accepts word-ladder inside policy', () => {
    const { errors, enrollment } = validateFlashcardEnrollment({ programId: 'flashcards', deckId: DECK, policy: { mode: 'word-ladder' } });
    expect(errors).toEqual([]);
    expect(enrollment).toEqual({ programId: 'flashcards', corpusId: DECK, deckId: DECK, policy: { mode: 'word-ladder' } });
  });
  it('rejects an unknown mode and FSRS-only keys under word-ladder', () => {
    expect(validateFlashcardEnrollment({ programId: 'flashcards', deckId: DECK, policy: { mode: 'leitner' } }).errors)
      .toContain('policy.mode must be fsrs or word-ladder');
    const { errors } = validateFlashcardEnrollment({ programId: 'flashcards', deckId: DECK, policy: { mode: 'word-ladder', newCardLimit: 5, masteryPercent: 80, minimumReviews: 3 } });
    expect(errors).toEqual([
      'policy.newCardLimit is not used by word-ladder',
      'policy.masteryPercent is not used by word-ladder',
      'policy.minimumReviews is not used by word-ladder',
    ]);
  });
  it('keeps an optional display title', () => {
    const { enrollment } = validateFlashcardEnrollment({ programId: 'flashcards', deckId: DECK, title: '  Korean words ', policy: { mode: 'word-ladder' } });
    expect(enrollment.title).toBe('Korean words');
    expect(validateFlashcardEnrollment({ programId: 'flashcards', deckId: DECK, title: 7 }).errors).toContain('title must be a non-empty string when present');
  });
  it('policy.mode survives validate → SetAssignments → reload', async () => {
    const stored = [];
    const assignments = { put: vi.fn(async (record) => { stored.push(structuredClone(record)); return record; }), get: vi.fn(async () => stored.at(-1) ?? null) };
    const programValidators = createSchoolProgramEnrollmentValidators({ flashcardStudyService: { getDeck: async () => ({ id: DECK }) } });
    const useCase = new SetAssignments({
      assignments, grownUps: { assert: vi.fn() }, programValidators,
      clock: () => new Date('2026-09-22T12:00:00.000Z'), logger: { info: vi.fn(), warn: vi.fn() },
    });
    const raw = { programId: 'flashcards', deckId: DECK, title: 'Korean words', policy: { mode: 'word-ladder' }, schedule: { daysOfWeek: [1, 2, 3, 4, 5] } };
    await useCase.execute({ learnerId: 'learner-1', assignedBy: 'parent', programs: [raw] });
    const reloaded = (await assignments.get('learner-1')).programs[0];
    expect(reloaded).toMatchObject({ policy: { mode: 'word-ladder' }, title: 'Korean words', schedule: { daysOfWeek: [1, 2, 3, 4, 5] } });
    // A grown-up saving again (the round trip that used to delete top-level keys) keeps it.
    await useCase.execute({ learnerId: 'learner-1', assignedBy: 'parent', programs: [reloaded] });
    expect((await assignments.get('learner-1')).programs[0].policy.mode).toBe('word-ladder');
  });
});
