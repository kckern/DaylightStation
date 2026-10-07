import { describe, it, expect } from 'vitest';
import * as assessment from './practiceAssessment.mjs';
import { validateUnit } from './curriculum/unitValidation.mjs';
const practice = { programId: 'flashcards', deckId: 'language/test/one', requiredCardIds: ['a', 'b'], questionCards: {
  q1: { cardIds: ['a'], kind: 'application', explanation: 'Ask permission.' },
  q2: { cardIds: ['b'], kind: 'vocabulary', explanation: 'Recall the meaning.' },
} };
const unit = { unitId: 'test.01', title: 'Test', subject: 'language', provenance: { source: 'Test source', reviewState: 'approved' }, document: 'print/test-a@123456789', passing: { percent: 100 }, retry: { variants: 2 }, practice, assessmentForms: ['print/test-a@123456789', 'print/test-b@123456789'] };
const words = { a: { state: 'mastered', recognizedCount: 1, matched: true }, b: { state: 'mastered', recognizedCount: 1, matched: true } };
const failed = { sessionId: 's1', unitId: 'test.01', learnerId: 'test-learner', gradedPercent: 50, gradedAt: '2026-10-07T12:00:00Z', missedItemIds: ['q2'], practiceAssessment: { practice, questionIds: ['q1', 'q2'] } };
const project = (overrides = {}) => assessment.projectPracticeAssessment({ unit, status: { words }, sessions: [], dayFiles: [], ...overrides });
describe('practice assessment', () => {
  it('retains validated unit linkage and refuses invalid mappings', () => {
    expect(validateUnit(unit).unit?.practice).toEqual(practice);
    expect(validateUnit({ ...unit, practice: { ...practice, requiredCardIds: [] } }).errors.join(' ')).toMatch(/requiredCardIds/);
    expect(validateUnit({ ...unit, practice: { ...practice, questionCards: { q1: { cardIds: ['ghost'], kind: 'application', explanation: 'Review.' } } } }).errors.join(' ')).toMatch(/ghost/);
    expect(validateUnit({ ...unit, program: 'flashcards' }).errors.join(' ')).toMatch(/exclusive/);
  });
  it('requires recognition and matching for every required card, including excluded cards', () => {
    expect(project().stage).toBe('quiz_ready');
    for (const a of [{}, { ...words.a, matched: false }, { ...words.a, recognizedCount: 0 }, { ...words.a, excluded: true }]) {
      expect(project({ status: { words: { ...words, a } } }).stage).toBe('practice');
    }
  });
  it('keeps correct answers and requires new evidence after the miss', () => {
    expect(project({ sessions: [failed] })).toMatchObject({ stage: 'review', resolvedQuestionIds: ['q1'], unresolvedQuestionIds: ['q2'], reviewCardIds: ['b'] });
    const evidence = (at, correct = true) => ({ items: { x: { wordId: 'b', task: '3.1', source: 'course-review', courseUnitId: 'test.01', at, result: { correct } }, y: { wordId: 'b', task: '2.2', source: 'course-review', courseUnitId: 'test.01', at, result: { correct } } } });
    expect(project({ sessions: [failed], dayFiles: [evidence('2026-10-07T11:00:00Z')] }).stage).toBe('review');
    expect(project({ sessions: [failed], dayFiles: [evidence('2026-10-07T13:00:00Z', false)] }).stage).toBe('review');
    expect(project({ sessions: [failed], dayFiles: [evidence('2026-10-07T13:00:00Z')] }).stage).toBe('retry_ready');
  });
  it('completes cumulatively and ignores later spaced-review state', () => {
    const retry = { ...failed, sessionId: 's2', remediationOf: 's1', gradedAt: '2026-10-08T12:00:00Z', gradedPercent: 100, missedItemIds: [], practiceAssessment: { practice, questionIds: ['q2'] } };
    expect(project({ sessions: [failed, retry], status: { words: {} } })).toMatchObject({ stage: 'completed', resolvedQuestionIds: ['q1', 'q2'] });
    expect(project({ sessions: [failed, retry, retry] }).resolvedQuestionIds).toHaveLength(2);
    expect(project({ sessions: [{ ...failed, gradedPercent: null }] }).resolvedQuestionIds).toEqual([]);
  });
  it('freezes issued mappings and honors corrected grades', () => {
    const changed = { ...unit, practice: { ...practice, questionCards: { q3: { cardIds: ['a'], kind: 'application', explanation: 'New.' } } } };
    expect(project({ unit: changed, sessions: [failed] }).unresolvedQuestionIds).toEqual(['q2']);
    expect(project({ sessions: [{ ...failed, missedItemIds: [], gradedPercent: 100 }] }).stage).toBe('completed');
    expect(project({ sessions: [{ ...failed, evidenceInvalidated: true }] }).resolvedQuestionIds).toEqual([]);
  });
});

it('retains voided targets as unresolved even when the markable subset is 100%', () => {
  const result = project({ sessions: [{ ...failed, gradedPercent: 100, missedItemIds: [], voidedItemIds: ['q2'] }] });
  expect(result).toMatchObject({ stage: 'review', resolvedQuestionIds: ['q1'], unresolvedQuestionIds: ['q2'], pendingReviewCardIds: ['b'] });
});
