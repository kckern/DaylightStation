import { describe, expect, it } from 'vitest';
import { INITIAL_FEN } from '../../../../shared/gaming/rulesets/chess/engine.mjs';
import {
  computeBaseline, distinctRungs, measureCandidate, samplePositions, saturationWarning,
} from './ChessLadderCalibration.mjs';

const LONG_GAME = {
  initial_fen: INITIAL_FEN,
  moves: [
    { ply: 1, from: 'e2', to: 'e4', san: 'e4' },
    { ply: 2, from: 'e7', to: 'e5', san: 'e5' },
    { ply: 3, from: 'g1', to: 'f3', san: 'Nf3' },
    { ply: 4, from: 'b8', to: 'c6', san: 'Nc6' },
    { ply: 5, from: 'f1', to: 'c4', san: 'Bc4' },
    { ply: 6, from: 'g8', to: 'f6', san: 'Nf6' },
    { ply: 7, from: 'd2', to: 'd3', san: 'd3' },
    { ply: 8, from: 'f8', to: 'c5', san: 'Bc5' },
    { ply: 9, from: 'e1', to: 'g1', san: 'O-O' },
    { ply: 10, from: 'e8', to: 'g8', san: 'O-O' },
    { ply: 11, from: 'c1', to: 'g5', san: 'Bg5' },
    { ply: 12, from: 'd7', to: 'd6', san: 'd6' },
  ],
};

describe('samplePositions', () => {
  it('skips the opening, where book moves say nothing about strength', () => {
    const positions = samplePositions([LONG_GAME], { skipOpeningPlies: 8, every: 1 });
    // Plies 9-12 survive, so four positions.
    expect(positions).toHaveLength(4);
    expect(positions[0]).not.toBe(INITIAL_FEN);
  });

  it('spreads the sample across a game rather than taking the head', () => {
    const positions = samplePositions([LONG_GAME], { skipOpeningPlies: 0, every: 1, limit: 4 });
    expect(positions).toHaveLength(4);
    expect(new Set(positions).size).toBe(4);
  });

  it('stops contributing from a corrupt record without aborting the run', () => {
    const corrupt = { initial_fen: INITIAL_FEN, moves: [{ ply: 1, from: 'a7', to: 'h1', san: '??' }] };
    expect(() => samplePositions([corrupt, LONG_GAME], { skipOpeningPlies: 0, every: 1 })).not.toThrow();
  });

  it('excludes taken-back moves from the walk', () => {
    const withTakeback = {
      initial_fen: INITIAL_FEN,
      moves: [
        { ply: 1, from: 'e2', to: 'e4', san: 'e4', undone: true },
        { ply: 1, from: 'd2', to: 'd4', san: 'd4' },
      ],
    };
    expect(() => samplePositions([withTakeback], { skipOpeningPlies: 0, every: 1 })).not.toThrow();
  });
});

describe('computeBaseline', () => {
  it('reports each position from the point of view of the side to move', async () => {
    const blackToMove = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    // White-positive +50 means -50 for Black, who is the one choosing.
    const analyst = { evaluate: async () => ({ cp: 50 }) };
    const baseline = await computeBaseline([INITIAL_FEN, blackToMove], analyst);
    expect(baseline).toEqual([50, -50]);
  });
});

describe('measureCandidate', () => {
  const analystAt = (cp) => ({ evaluate: async () => ({ cp }) });

  it('charges the mover for ground given away', async () => {
    // The mover held +100. After their move White stands at +20, so from the
    // opponent's turn that is -20 — the mover ended on +20 and lost 80.
    const result = await measureCandidate({
      positions: [INITIAL_FEN],
      baseline: [100],
      analyst: analystAt(-20),
      chooseMove: async () => ({ from: 'e2', to: 'e4' }),
    });
    expect(result.acpl).toBe(80);
  });

  it('never charges a negative loss for improving the position', async () => {
    const result = await measureCandidate({
      positions: [INITIAL_FEN],
      baseline: [0],
      analyst: analystAt(-300),
      chooseMove: async () => ({ from: 'e2', to: 'e4' }),
    });
    expect(result.acpl).toBe(0);
  });

  it('skips a position the candidate will not answer', async () => {
    const result = await measureCandidate({
      positions: [INITIAL_FEN],
      baseline: [100],
      analyst: analystAt(0),
      chooseMove: async () => null,
    });
    expect(result.counted).toBe(0);
    expect(result.acpl).toBe(0);
  });

  it('skips an illegal answer rather than aborting the measurement', async () => {
    const result = await measureCandidate({
      positions: [INITIAL_FEN, INITIAL_FEN],
      baseline: [100, 100],
      analyst: analystAt(-100),
      chooseMove: async () => ({ from: 'a7', to: 'h1' }),
    });
    expect(result.counted).toBe(0);
  });

  it('counts a blunder rate alongside the average', async () => {
    const result = await measureCandidate({
      positions: [INITIAL_FEN],
      baseline: [500],
      analyst: analystAt(-100), // mover ends on +100, having held +500
      chooseMove: async () => ({ from: 'e2', to: 'e4' }),
    });
    expect(result.acpl).toBe(400);
    expect(result.blunderRate).toBe(100);
  });
});

describe('distinctRungs', () => {
  it('collapses candidates too close together to be different rungs', () => {
    const bands = distinctRungs([
      { id: 'a', acpl: 200 }, { id: 'b', acpl: 195 }, { id: 'c', acpl: 120 }, { id: 'd', acpl: 60 },
    ], { minGapCp: 25 });
    expect(bands).toHaveLength(3);
    expect(bands[0].members).toEqual(['a', 'b']);
  });

  it('orders bands weakest first', () => {
    const bands = distinctRungs([{ id: 'strong', acpl: 20 }, { id: 'weak', acpl: 300 }]);
    expect(bands[0].members).toEqual(['weak']);
  });

  it('reports a flat ladder as a single band', () => {
    const bands = distinctRungs([
      { id: 'skill0', acpl: 63 }, { id: 'skill1', acpl: 63 }, { id: 'skill3', acpl: 57 },
    ]);
    expect(bands).toHaveLength(1);
    expect(bands[0].members).toHaveLength(3);
  });
});

describe('saturationWarning', () => {
  it('warns when everything collapses into one strong band', () => {
    // What actually happened: skill 0 and skill 20 both measured ~34 against a
    // depth-12 reference. That is the yardstick running out, not a flat ladder.
    const results = [{ id: 'skill 0', acpl: 34 }, { id: 'skill 20', acpl: 34 }];
    const warning = saturationWarning(distinctRungs(results), results);
    expect(warning).toMatch(/too shallow/);
  });

  it('stays quiet when one band is genuinely weak, not saturated', () => {
    // Three weak candidates clustered at 200 ACPL are really the same rung —
    // no reference depth would separate them, because they are not strong.
    const results = [{ id: 'a', acpl: 200 }, { id: 'b', acpl: 205 }];
    expect(saturationWarning(distinctRungs(results), results)).toBeNull();
  });

  it('stays quiet when the candidates did separate', () => {
    const results = [{ id: 'a', acpl: 30 }, { id: 'b', acpl: 200 }];
    expect(saturationWarning(distinctRungs(results), results)).toBeNull();
  });

  it('says nothing about a single candidate, which cannot be compared', () => {
    const results = [{ id: 'only', acpl: 20 }];
    expect(saturationWarning(distinctRungs(results), results)).toBeNull();
  });
});

describe('distinctRungs single linkage', () => {
  it('collapses an evenly-spaced run rather than splitting it arbitrarily', () => {
    // Real depth-20 output. Anchoring each band on its first member put 132 and
    // 108 together while giving 106 a band of its own — a nonsense reading.
    const results = [
      { id: 'skill 0', acpl: 132 }, { id: 'skill 4', acpl: 106 }, { id: 'skill 8', acpl: 113 },
      { id: 'skill 12', acpl: 108 }, { id: 'skill 16', acpl: 105 }, { id: 'skill 20', acpl: 108 },
    ];
    const bands = distinctRungs(results);
    expect(bands).toHaveLength(1);
    expect(bands[0].members).toHaveLength(6);
  });

  it('still separates candidates that are genuinely apart', () => {
    const bands = distinctRungs([
      { id: 'weak', acpl: 200 }, { id: 'mid', acpl: 120 }, { id: 'strong', acpl: 30 },
    ]);
    expect(bands).toHaveLength(3);
  });
});
