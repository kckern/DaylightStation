import { describe, expect, it } from 'vitest';
import { headToHeadLine, standingLines } from './chessStandingLines.js';

const ladder = (over = {}) => ({
  persisted: true, promoted: false, counted: true, not_counted: null,
  up_next: { level: 2, name: 'Kakuna' }, status: { wins: 3, needed: 5, at_top: false },
  head_to_head: { opponent: { name: 'Weedle' }, win: 6, loss: 1, draw: 0 },
  ...over,
});

describe('headToHeadLine', () => {
  it('counts wins and losses, and draws only when there were any', () => {
    expect(headToHeadLine({ opponent: { name: 'Weedle' }, win: 1, loss: 0, draw: 0 })).toBe('You vs Weedle: 1 win, 0 losses');
    expect(headToHeadLine({ opponent: { name: 'Weedle' }, win: 2, loss: 1, draw: 2 })).toBe('You vs Weedle: 2 wins, 1 loss, 2 draws');
  });

  it('says nothing without a named opponent', () => {
    expect(headToHeadLine(null)).toBe(null);
    expect(headToHeadLine({ opponent: {}, win: 1, loss: 0, draw: 0 })).toBe(null);
  });
});

describe('standingLines', () => {
  it('says nothing for a guest or a game that did not save', () => {
    expect(standingLines({ result: 'win', ladder: null })).toEqual([]);
    expect(standingLines({ result: 'win', ladder: ladder({ persisted: false }) })).toEqual([]);
  });

  it('gives the record and the progress after a counted game', () => {
    expect(standingLines({ result: 'win', ladder: ladder() })).toEqual([
      'You vs Weedle: 6 wins, 1 loss',
      '3 of 5 wins toward Kakuna',
    ]);
  });

  it('names the rule a help-heavy win broke', () => {
    const cases = [
      ['best_moves', 14, 0, '14 best-move requests, 0 allowed'],
      ['best_moves', 1, 0, '1 best-move request, 0 allowed'],
      ['hints', 3, 1, '3 hints, 1 allowed'],
      ['takebacks', 2, 1, '2 takebacks, 1 allowed'],
    ];
    for (const [reason, used, allowed, words] of cases) {
      const lines = standingLines({ result: 'win', ladder: ladder({ counted: false, not_counted: { reason, used, allowed } }) });
      expect(lines[1]).toBe(`This win didn't count toward Kakuna: ${words}.`);
    }
  });

  it('calls a win against an already-beaten opponent practice', () => {
    const lines = standingLines({ result: 'win', ladder: ladder({ counted: false, not_counted: { reason: 'other_level', level: 0 } }) });
    expect(lines[1]).toBe("Practice game. It doesn't count toward Kakuna.");
  });

  it('does not explain why a loss did not count', () => {
    const lines = standingLines({ result: 'loss', ladder: ladder({ counted: false, not_counted: { reason: 'hints', used: 3, allowed: 1 } }) });
    expect(lines).toEqual(['You vs Weedle: 6 wins, 1 loss', '3 of 5 wins toward Kakuna']);
  });

  it('leaves progress to the promotion banner when this game promoted', () => {
    expect(standingLines({ result: 'win', ladder: ladder({ promoted: true }) })).toEqual(['You vs Weedle: 6 wins, 1 loss']);
  });

  it('has no progress line at the top of the ladder', () => {
    const top = ladder({ up_next: null, status: { wins: 5, needed: 5, at_top: true }, counted: false, not_counted: { reason: 'hints', used: 3, allowed: 1 } });
    expect(standingLines({ result: 'win', ladder: top })).toEqual([
      'You vs Weedle: 6 wins, 1 loss',
      "This win didn't count: 3 hints, 1 allowed.",
    ]);
  });
});
