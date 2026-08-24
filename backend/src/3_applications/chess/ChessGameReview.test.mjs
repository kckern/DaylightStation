import { describe, expect, it } from 'vitest';
import { INITIAL_FEN } from '../../../../shared/gaming/rulesets/chess/engine.mjs';
import {
  bandForAcpl, classify, formatScore, replay, reviewGame, summarize, THRESHOLDS,
} from './ChessGameReview.mjs';

/** A game record shaped like the archive writes them. */
function record(moves, extra = {}) {
  return { initial_fen: INITIAL_FEN, player_color: 'w', moves, ...extra };
}

const SCHOLARS = [
  { ply: 1, san: 'e4', from: 'e2', to: 'e4', color: 'w' },
  { ply: 2, san: 'e5', from: 'e7', to: 'e5', color: 'b' },
  { ply: 3, san: 'Bc4', from: 'f1', to: 'c4', color: 'w' },
  { ply: 4, san: 'Nc6', from: 'b8', to: 'c6', color: 'b' },
  { ply: 5, san: 'Qh5', from: 'd1', to: 'h5', color: 'w' },
  { ply: 6, san: 'Nf6', from: 'g8', to: 'f6', color: 'b' },
  { ply: 7, san: 'Qxf7#', from: 'h5', to: 'f7', color: 'w' },
];

describe('replay', () => {
  it('walks the archived move list to the final position', () => {
    const { plies, finalFen } = replay(record(SCHOLARS));
    expect(plies).toHaveLength(7);
    expect(plies[0].fenBefore).toBe(INITIAL_FEN);
    // Scholar's mate: the white queen sits on f7 with Black to move.
    expect(finalFen).toBe('r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4');
  });

  it('excludes taken-back moves from the played line but still reports them', () => {
    const withTakeback = [
      { ply: 1, san: 'e4', from: 'e2', to: 'e4', color: 'w', undone: true },
      { ply: 1, san: 'd4', from: 'd2', to: 'd4', color: 'w' },
    ];
    const { plies, retracted } = replay(record(withTakeback));
    expect(plies.map((p) => p.san)).toEqual(['d4']);
    expect(retracted.map((m) => m.san)).toEqual(['e4']);
  });

  it('throws rather than silently truncating when a record is corrupt', () => {
    const bogus = [{ ply: 1, san: 'e4', from: 'e2', to: 'e4', color: 'w' },
      { ply: 2, san: '??', from: 'a7', to: 'h1', color: 'b' }];
    expect(() => replay(record(bogus))).toThrow(/illegal/);
  });
});

describe('classify', () => {
  it('labels by centipawn loss', () => {
    expect(classify(0)).toBe('ok');
    expect(classify(THRESHOLDS.inaccuracy)).toBe('inaccuracy');
    expect(classify(THRESHOLDS.mistake)).toBe('mistake');
    expect(classify(THRESHOLDS.blunder)).toBe('blunder');
    expect(classify(5000)).toBe('blunder');
  });
});

describe('formatScore', () => {
  it('renders pawns, mates and terminal positions distinctly', () => {
    expect(formatScore({ cp: 246 })).toBe('+2.46');
    expect(formatScore({ cp: -364 })).toBe('-3.64');
    expect(formatScore({ cp: null, mate: -3 })).toBe('M-3');
    expect(formatScore({ terminal: true })).toBe('game over');
  });
});

describe('bandForAcpl', () => {
  it('always resolves a band, including for very poor play', () => {
    expect(bandForAcpl(10).elo).toBe('2000+');
    expect(bandForAcpl(500)).toBeTruthy();
  });
});

describe('summarize', () => {
  const moves = (losses) => losses.map((lossCp, index) => ({
    ply: index + 1, color: 'w', lossCp, verdict: classify(lossCp), matchedBest: lossCp === 0,
  }));

  it('skips the opening plies, where book moves are free accuracy', () => {
    // Four perfect opening moves then one 400cp blunder: counting the opening
    // would report 80 ACPL, which flatters the player for knowing theory.
    const summary = summarize(moves([0, 0, 0, 0, 400]), { skipOpeningPlies: 4 });
    expect(summary.scoredMoveCount).toBe(1);
    expect(summary.acpl).toBe(400);
  });

  it('falls back to every move when a game ends inside the opening', () => {
    const summary = summarize(moves([0, 200]), { skipOpeningPlies: 4 });
    expect(summary.scoredMoveCount).toBe(2);
    expect(summary.acpl).toBe(100);
  });

  it('counts each verdict and the engine-match rate', () => {
    const summary = summarize(moves([0, 0, 0, 0, 0, 90, 200, 400]), { skipOpeningPlies: 4 });
    expect(summary.blunders).toHaveLength(1);
    expect(summary.mistakes).toHaveLength(1);
    expect(summary.inaccuracies).toHaveLength(1);
    expect(summary.bestMoveRate).toBe(63);
  });
});

describe('reviewGame', () => {
  /** Scripted analyst: a queue of evaluations, one per position probed. */
  function analystOf(scores) {
    let index = 0;
    return { evaluate: async () => scores[index++] };
  }

  it('attributes a swing to whoever moved, in that side\'s favour', async () => {
    // White is +1.00, plays a move leaving +0.20 -> white lost 80cp.
    // Black then moves and the eval goes to -0.50 (better for black) -> no loss.
    const review = await reviewGame(
      record([
        { ply: 1, san: 'e4', from: 'e2', to: 'e4', color: 'w' },
        { ply: 2, san: 'e5', from: 'e7', to: 'e5', color: 'b' },
      ]),
      analystOf([{ cp: 100 }, { cp: 20 }, { cp: -50 }]),
    );
    expect(review.moves[0].lossCp).toBe(80);
    expect(review.moves[1].lossCp).toBe(0);
  });

  it('never reports a negative loss when a player improves their position', async () => {
    const review = await reviewGame(
      record([{ ply: 1, san: 'e4', from: 'e2', to: 'e4', color: 'w' }]),
      analystOf([{ cp: 0 }, { cp: 300 }]),
    );
    expect(review.moves[0].lossCp).toBe(0);
  });

  it('caps decided positions so a won game does not swamp the average', async () => {
    // +40.00 down to +12.00 is still completely winning; uncapped it would
    // score as a 2800cp catastrophe.
    const review = await reviewGame(
      record([{ ply: 1, san: 'e4', from: 'e2', to: 'e4', color: 'w' }]),
      analystOf([{ cp: 4000 }, { cp: 1200 }]),
    );
    expect(review.moves[0].lossCp).toBe(0);
  });

  it('treats the mating move as no loss rather than a swing into nothing', async () => {
    const review = await reviewGame(
      record([{ ply: 1, san: 'e4', from: 'e2', to: 'e4', color: 'w' }]),
      analystOf([{ cp: 100 }, { terminal: true }]),
    );
    expect(review.moves[0].lossCp).toBe(0);
    expect(review.moves[0].evalAfter).toBe('game over');
  });

  it('probes each position once — N moves means N+1 evaluations', async () => {
    let calls = 0;
    const analyst = { evaluate: async () => { calls += 1; return { cp: 0 }; } };
    await reviewGame(record(SCHOLARS), analyst);
    expect(calls).toBe(SCHOLARS.length + 1);
  });

  it('separates the two sides so a rung can be compared with its player', async () => {
    const review = await reviewGame(record(SCHOLARS), analystOf(Array(8).fill({ cp: 0 })));
    expect(review.white.moveCount).toBe(4);
    expect(review.black.moveCount).toBe(3);
  });
});
