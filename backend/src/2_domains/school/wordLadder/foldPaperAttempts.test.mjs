import { describe, expect, it } from 'vitest';
import { emptyWordV3 } from './mastery.mjs';
import { emptyStatusV3 } from './statusV3.mjs';
import { foldPaperAttempts } from './foldPaperAttempts.mjs';

const S = { afterMisses: 2, gapScale: 1 };
const attempt = (id, itemId, correct, bankId = 'deck-quiz@3') => ({ id, itemId, correct, bankId, transport: 'paper', at: '2026-09-22T10:00:00-07:00' });

describe('foldPaperAttempts (v3)', () => {
  it('a miss demotes a claimed word; a miss on notYet is logged only; idempotent', () => {
    const status = emptyStatusV3();
    status.words.a = { ...emptyWordV3(), state: 'claimed' };
    status.words.b = { ...emptyWordV3(), state: 'notYet' };
    const run = (s) => foldPaperAttempts({
      status: s, attempts: [attempt('1', 'a', false), attempt('2', 'b', false)], quizDocumentIds: ['deck-quiz'], dayOf: () => '2026-09-22', settings: S,
    });
    const once = run(status);
    expect(once.status.words.a.state).toBe('familiar');
    expect(once.status.words.b.state).toBe('notYet');
    expect(once.folded).toHaveLength(2);
    expect(run(once.status).folded).toHaveLength(0);
  });
  it('ignores other documents', () => {
    const out = foldPaperAttempts({ status: emptyStatusV3(), attempts: [attempt('1', 'a', false, 'other-quiz@1')], quizDocumentIds: ['deck-quiz'], dayOf: () => 'd', settings: S });
    expect(out.folded).toEqual([]);
    expect(out.refused).toEqual([]);
  });
});

describe('foldPaperAttempts learns per-learner documents (plan 3, spec §8)', () => {
  const learner = { deckDir: 'language/korean', pkg: 'korean-vocab', learnerId: 'test-learner' };

  it('the legacy per-deck id still folds', () => {
    const status = emptyStatusV3();
    status.words.a = { ...emptyWordV3(), state: 'claimed' };
    const out = foldPaperAttempts({
      status, attempts: [attempt('1', 'a', false, 'deck-quiz@1')], quizDocumentIds: ['deck-quiz'], learner, dayOf: () => '2026-09-22', settings: S,
    });
    expect(out.status.words.a.state).toBe('familiar');
    expect(out.folded).toHaveLength(1);
    expect(out.refused).toEqual([]);
  });

  it('a per-learner document addressed to this learner folds', () => {
    const status = emptyStatusV3();
    status.words.a = { ...emptyWordV3(), state: 'claimed' };
    const bankId = 'language/korean/korean-vocab-quiz-test-learner-2026-w39@1';
    const out = foldPaperAttempts({
      status, attempts: [attempt('1', 'a', false, bankId)], quizDocumentIds: [], learner, dayOf: () => '2026-09-22', settings: S,
    });
    expect(out.status.words.a.state).toBe('familiar');
    expect(out.folded).toEqual([{ attemptId: '1', wordId: 'a', correct: false }]);
    expect(out.refused).toEqual([]);
  });

  it('a sibling\'s per-learner document is refused, never demotes, and is not re-evaluated', () => {
    const status = emptyStatusV3();
    status.words.a = { ...emptyWordV3(), state: 'claimed' };
    const bankId = 'language/korean/korean-vocab-quiz-someone-else-2026-w39@1';
    const run = (s) => foldPaperAttempts({
      status: s, attempts: [attempt('1', 'a', false, bankId)], quizDocumentIds: [], learner, dayOf: () => '2026-09-22', settings: S,
    });
    const once = run(status);
    expect(once.status.words.a.state).toBe('claimed'); // unchanged — never demoted
    expect(once.folded).toEqual([]);
    expect(once.refused).toEqual([{ attemptId: '1', bankId }]);
    expect(once.status.paperAttemptsFolded).toEqual(['1']);
    const twice = run(once.status);
    expect(twice.refused).toEqual([]);
    expect(twice.folded).toEqual([]);
  });

  // Regression (fix round 1): a raw `startsWith` prefix check on
  // '…-quiz-a-' also matches '…-quiz-a-b-2026-w39' — segment-bounded parsing
  // (parseLearnerQuizId) must refuse it instead, in BOTH directions.
  it('learner "a" never folds sibling "a-b"\'s document — refused, not accepted', () => {
    const learnerA = { deckDir: 'language/korean', pkg: 'korean-vocab', learnerId: 'a' };
    const status = emptyStatusV3();
    status.words.x = { ...emptyWordV3(), state: 'claimed' };
    const bankId = 'language/korean/korean-vocab-quiz-a-b-2026-w39@1'; // sibling learner 'a-b'
    const out = foldPaperAttempts({
      status, attempts: [attempt('1', 'x', false, bankId)], quizDocumentIds: [], learner: learnerA, dayOf: () => '2026-09-22', settings: S,
    });
    expect(out.status.words.x.state).toBe('claimed'); // never demoted into learner 'a's status
    expect(out.folded).toEqual([]);
    expect(out.refused).toEqual([{ attemptId: '1', bankId }]);
  });

  it('learner "a-b" never folds sibling "a"\'s document, but does fold its own', () => {
    const learnerAB = { deckDir: 'language/korean', pkg: 'korean-vocab', learnerId: 'a-b' };
    const status = emptyStatusV3();
    status.words.x = { ...emptyWordV3(), state: 'claimed' };

    const siblingBankId = 'language/korean/korean-vocab-quiz-a-2026-w39@1'; // sibling learner 'a'
    const refusedOut = foldPaperAttempts({
      status, attempts: [attempt('1', 'x', false, siblingBankId)], quizDocumentIds: [], learner: learnerAB, dayOf: () => '2026-09-22', settings: S,
    });
    expect(refusedOut.status.words.x.state).toBe('claimed');
    expect(refusedOut.folded).toEqual([]);
    expect(refusedOut.refused).toEqual([{ attemptId: '1', bankId: siblingBankId }]);

    const ownBankId = 'language/korean/korean-vocab-quiz-a-b-2026-w39@1';
    const ownOut = foldPaperAttempts({
      status, attempts: [attempt('2', 'x', false, ownBankId)], quizDocumentIds: [], learner: learnerAB, dayOf: () => '2026-09-22', settings: S,
    });
    expect(ownOut.status.words.x.state).toBe('familiar');
    expect(ownOut.folded).toEqual([{ attemptId: '2', wordId: 'x', correct: false }]);
    expect(ownOut.refused).toEqual([]);
  });
});
