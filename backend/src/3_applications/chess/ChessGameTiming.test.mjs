import { describe, expect, it } from 'vitest';
import { analyzeTiming, haste, median, rushedErrors } from './ChessGameTiming.mjs';

/** A reviewed move, as ChessGameReview emits them. */
const reviewMove = (ply, over = {}) => ({
  ply, moveNumber: Math.floor((ply - 1) / 2) + 1, color: ply % 2 ? 'w' : 'b',
  san: 'e4', lossCp: 0, verdict: 'ok', ...over,
});

/** Pair a review and a record that agree about which plies exist. */
function fixture(specs, { mode = 'up' } = {}) {
  const review = { moves: specs.map((spec) => reviewMove(spec.ply, { lossCp: spec.lossCp, verdict: spec.verdict, san: spec.san })) };
  const record = {
    timing: { mode, spent_ms: { w: 1000, b: 2000 } },
    moves: specs.map((spec) => ({ ply: spec.ply, think_ms: spec.thinkMs, undone: false })),
  };
  return { review, record };
}

describe('median', () => {
  it('averages the middle pair for an even count', () => {
    expect(median([1, 2, 3, 4])).toBe(3);
    expect(median([10, 20, 30])).toBe(20);
    expect(median([])).toBe(0);
  });
});

describe('analyzeTiming', () => {
  it('reports untimed when no move carries a think time', () => {
    const review = { moves: [reviewMove(1)] };
    const record = { moves: [{ ply: 1, undone: false }] };
    expect(analyzeTiming(review, record, { side: 'w' }).timed).toBe(false);
  });

  it('summarises only the asked-for side', () => {
    const { review, record } = fixture([
      { ply: 1, thinkMs: 4000, lossCp: 0 },
      { ply: 2, thinkMs: 90000, lossCp: 0 },
      { ply: 3, thinkMs: 6000, lossCp: 0 },
    ]);
    const timing = analyzeTiming(review, record, { side: 'w' });
    // Ply 2 is Black's 90-second think and must not appear in White's numbers.
    expect(timing.moveCount).toBe(2);
    expect(timing.totalMs).toBe(10000);
    expect(timing.meanMs).toBe(5000);
  });

  it('names the longest think', () => {
    const { review, record } = fixture([
      { ply: 1, thinkMs: 1000, san: 'e4' },
      { ply: 3, thinkMs: 30000, san: 'Nf3' },
    ]);
    expect(analyzeTiming(review, record, { side: 'w' }).slowest.san).toBe('Nf3');
  });

  it('ignores a taken-back move, which has no comparable think time', () => {
    const review = { moves: [reviewMove(1)] };
    const record = { moves: [{ ply: 1, think_ms: 5000, undone: true }] };
    expect(analyzeTiming(review, record, { side: 'w' }).timed).toBe(false);
  });

  it('carries the opponent\'s total through for context', () => {
    const { review, record } = fixture([{ ply: 1, thinkMs: 1000 }]);
    expect(analyzeTiming(review, record, { side: 'w' }).opponentMs).toBe(2000);
  });
});

describe('haste', () => {
  /** n moves alternating think time, with a loss attached to each. */
  const moves = (specs) => specs.map(([thinkMs, lossCp], index) => ({
    ply: index * 2 + 1, moveNumber: index + 1, color: 'w', san: 'e4',
    thinkMs, lossCp, verdict: lossCp >= 300 ? 'blunder' : 'ok',
  }));

  it('says nothing from too small a sample', () => {
    // Two fast moves that happened to include a blunder would otherwise read as
    // a damning pattern.
    expect(haste(moves([[1000, 400], [9000, 0]]))).toBeNull();
  });

  it('finds the habit when the quick moves are the bad ones', () => {
    const result = haste(moves([
      [1000, 400], [1000, 350], [1000, 300], [1000, 500],
      [20000, 10], [20000, 0], [20000, 20], [20000, 5],
    ]));
    expect(result.rushing).toBe(true);
    expect(result.costOfHasteCp).toBeGreaterThan(300);
    expect(result.fast.count).toBe(4);
    expect(result.slow.count).toBe(4);
  });

  it('does not invent a habit when speed and accuracy are unrelated', () => {
    const result = haste(moves([
      [1000, 100], [1000, 90], [1000, 110], [1000, 95],
      [20000, 100], [20000, 105], [20000, 92], [20000, 98],
    ]));
    expect(result.rushing).toBe(false);
    expect(Math.abs(result.costOfHasteCp)).toBeLessThan(30);
  });

  it('splits at the player\'s own median, not a fixed number of seconds', () => {
    // A deliberate player whose "fast" is 30s must still get a split, rather
    // than every move being filed as slow.
    const result = haste(moves([
      [30000, 400], [31000, 350], [30500, 300], [30200, 500],
      [90000, 10], [95000, 0], [92000, 20], [91000, 5],
    ]));
    expect(result).not.toBeNull();
    expect(result.fast.count).toBe(4);
    expect(result.rushing).toBe(true);
  });

  it('returns null when every move took the same time, leaving no split', () => {
    expect(haste(moves([
      [5000, 0], [5000, 0], [5000, 0], [5000, 0],
      [5000, 0], [5000, 0], [5000, 0], [5000, 0],
    ]))).toBeNull();
  });
});

describe('rushedErrors', () => {
  const moves = [
    { san: 'Qd1', thinkMs: 2000, lossCp: 610, moveNumber: 16, color: 'w' },
    { san: 'g4', thinkMs: 1000, lossCp: 220, moveNumber: 10, color: 'w' },
    { san: 'Kf1', thinkMs: 30000, lossCp: 400, moveNumber: 18, color: 'w' },
    { san: 'e4', thinkMs: 500, lossCp: 10, moveNumber: 1, color: 'w' },
  ];

  it('keeps only moves that were both fast and costly', () => {
    const found = rushedErrors(moves);
    expect(found.map((move) => move.san)).toEqual(['Qd1', 'g4']);
  });

  it('orders by damage, since the speed is the explanation not the lesson', () => {
    expect(rushedErrors(moves)[0].san).toBe('Qd1');
  });

  it('excludes a costly move that was thought about', () => {
    expect(rushedErrors(moves).some((move) => move.san === 'Kf1')).toBe(false);
  });
});
