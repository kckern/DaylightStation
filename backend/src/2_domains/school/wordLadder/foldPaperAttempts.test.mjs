import { describe, expect, it } from 'vitest';
import { applyCheck, applyMark, applyStudy, emptyStatus, emptyWord, foldPaperAttempts } from './index.mjs';

const QUIZ = 'language/korean/week-01-classroom-quiz';
const dayOf = (iso) => iso.slice(0, 10);
const attempt = (over = {}) => ({
  id: 'att_1', at: '2026-09-26T21:00:00.000Z', bankId: `${QUIZ}@abcdef123`, itemId: 'gawi', correct: false, transport: 'paper', ...over,
});
const knownStatus = () => {
  const status = emptyStatus();
  let word = applyMark(applyStudy(emptyWord(), { at: '2026-09-22T16:00:00-07:00', day: '2026-09-22', recording: 'taken' }), { at: '2026-09-22T16:01:00-07:00', day: '2026-09-22', mark: 'know' });
  word = applyCheck(word, { at: '2026-09-23T16:00:00-07:00', day: '2026-09-23', correct: true, phase: 'check' });
  status.words.gawi = word;
  return status;
};

describe('foldPaperAttempts', () => {
  it('a scanned miss demotes the word and records the attempt id', () => {
    const { status, folded } = foldPaperAttempts({ status: knownStatus(), attempts: [attempt()], quizDocumentIds: [QUIZ], dayOf });
    expect(status.words.gawi).toMatchObject({ state: 'learning', step: 0, nextCheckDay: null });
    expect(status.words.gawi.history.at(-1)).toMatchObject({ event: 'quiz-miss', attemptId: 'att_1', day: '2026-09-26' });
    expect(status.paperAttemptsFolded).toEqual(['att_1']);
    expect(folded).toEqual([{ attemptId: 'att_1', wordId: 'gawi', correct: false }]);
  });
  it('a scanned pass never promotes', () => {
    const { status } = foldPaperAttempts({ status: knownStatus(), attempts: [attempt({ correct: true })], quizDocumentIds: [QUIZ], dayOf });
    expect(status.words.gawi).toMatchObject({ state: 'known', step: 0 });
    expect(status.words.gawi.history.at(-1).event).toBe('quiz-pass');
  });
  it('is idempotent: the same attempt folded twice yields one event', () => {
    const once = foldPaperAttempts({ status: knownStatus(), attempts: [attempt()], quizDocumentIds: [QUIZ], dayOf });
    const twice = foldPaperAttempts({ status: once.status, attempts: [attempt()], quizDocumentIds: [QUIZ], dayOf });
    expect(twice.folded).toEqual([]);
    expect(twice.status.words.gawi.history.filter((e) => e.attemptId === 'att_1')).toHaveLength(1);
  });
  it('ignores screen attempts, other documents, and ungraded rows', () => {
    const attempts = [
      attempt({ id: 'a1', transport: 'screen' }),
      attempt({ id: 'a2', bankId: 'arts/quiz-1@abcdef123' }),
      attempt({ id: 'a3', bankId: `${QUIZ}-extra@abcdef123` }),
      attempt({ id: 'a4', correct: null }),
    ];
    const { folded, status } = foldPaperAttempts({ status: knownStatus(), attempts, quizDocumentIds: [QUIZ], dayOf });
    expect(folded).toEqual([]);
    expect(status.paperAttemptsFolded).toEqual([]);
  });
  it('does not mutate its input', () => {
    const input = knownStatus();
    const snapshot = structuredClone(input);
    foldPaperAttempts({ status: input, attempts: [attempt()], quizDocumentIds: [QUIZ], dayOf });
    expect(input).toEqual(snapshot);
  });
});
