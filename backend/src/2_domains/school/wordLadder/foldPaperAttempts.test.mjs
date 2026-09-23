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
  });
});
