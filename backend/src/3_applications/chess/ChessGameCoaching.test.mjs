import { describe, expect, it } from 'vitest';
import { INITIAL_FEN } from '../../../../shared/gaming/chess/engine.mjs';
import {
  coach, criticalMoment, motifFor, parseEval, phaseOf,
} from './ChessGameCoaching.mjs';

const move = (over) => ({
  ply: 1, moveNumber: 1, color: 'w', san: 'e4', evalBefore: '+0.20', evalAfter: '+0.20',
  lossCp: 0, verdict: 'ok', bestSan: 'e4', matchedBest: true, ...over,
});

describe('parseEval', () => {
  it('reads pawns, mates and non-scores', () => {
    expect(parseEval('+2.46')).toBe(246);
    expect(parseEval('-3.64')).toBe(-364);
    expect(parseEval('M-3')).toBe(-1000);
    expect(parseEval('M5')).toBe(1000);
    expect(parseEval('game over')).toBeNull();
  });
});

describe('phaseOf', () => {
  it('calls the opening the opening', () => {
    expect(phaseOf(INITIAL_FEN, 1)).toBe('opening');
  });

  it('reads the endgame off the board, not the move number', () => {
    // King and pawn each: an endgame on ply 9 whatever the clock says.
    expect(phaseOf('4k3/4p3/8/8/8/8/4P3/4K3 w - - 0 5', 9)).toBe('endgame');
  });

  it('separates the middlegame once past the opening plies', () => {
    expect(phaseOf(INITIAL_FEN, 30)).toBe('middlegame');
  });
});

describe('motifFor', () => {
  it('says nothing when the player found the engine move', () => {
    expect(motifFor(move({ matchedBest: true }), INITIAL_FEN)).toBeNull();
  });

  it('names a missed capture of the queen', () => {
    // White bishop on f6 attacks the black queen on e7; White played Qd1.
    const fen = 'r1b1k2r/2p1q3/5Bpb/p1p5/3QP3/2P5/PP5P/RN2K1NR w KQkq - 0 16';
    const found = motifFor(move({ san: 'Qd1', bestSan: 'Bxe7', matchedBest: false, lossCp: 610 }), fen);
    expect(found.motif).toBe('missed-queen');
    expect(found.lesson).toContain('e7');
  });

  it('names a missed checkmate', () => {
    // Fool's mate, one move short: after 1.f3 e5 2.g4, Black to move has Qh4#.
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2';
    const found = motifFor(move({ color: 'b', san: 'Nc6', bestSan: 'Qh4#', matchedBest: false, lossCp: 900 }), fen);
    expect(found.motif).toBe('missed-mate');
  });

  it('does not call a DEFENDED piece free material', () => {
    // Nxe5 wins a pawn but d6xe5 recaptures — teaching a child to grab this is
    // teaching them to lose material.
    const fen = 'rnbqkbnr/ppp2ppp/3p4/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3';
    const found = motifFor(move({ san: 'd4', bestSan: 'Nxe5', matchedBest: false, lossCp: 200 }), fen);
    expect(found?.motif).not.toBe('missed-free-piece');
  });

  it('survives a best move that is illegal in the position', () => {
    expect(motifFor(move({ san: 'e4', bestSan: 'Qh8', matchedBest: false }), INITIAL_FEN)).toBeNull();
  });
});

describe('criticalMoment', () => {
  it('prefers the move that surrendered a playable position', () => {
    const moves = [
      // Threw away a winning position.
      move({ ply: 1, san: 'Qd1', lossCp: 400, verdict: 'blunder', evalBefore: '+2.50', evalAfter: '-1.50' }),
      // A bigger number, but the game was already gone.
      move({ ply: 3, san: 'Kg2', lossCp: 600, verdict: 'blunder', evalBefore: '-5.00', evalAfter: '-11.00' }),
    ];
    expect(criticalMoment(moves, 'w').san).toBe('Qd1');
  });

  it('falls back to the largest error when nothing was ever held', () => {
    const moves = [
      move({ ply: 1, san: 'a3', lossCp: 200, verdict: 'mistake', evalBefore: '-4.00', evalAfter: '-6.00' }),
      move({ ply: 3, san: 'h3', lossCp: 500, verdict: 'blunder', evalBefore: '-6.00', evalAfter: '-11.00' }),
    ];
    expect(criticalMoment(moves, 'w').san).toBe('h3');
  });

  it('ignores the other side\'s errors', () => {
    const moves = [move({ ply: 2, color: 'b', san: 'Nc6', lossCp: 900, verdict: 'blunder' })];
    expect(criticalMoment(moves, 'w')).toBeNull();
  });

  it('returns nothing for a clean game', () => {
    expect(criticalMoment([move({ lossCp: 10 })], 'w')).toBeNull();
  });
});

describe('coach', () => {
  it('reports whether the game was ever winnable', () => {
    const review = {
      moves: [move({ evalBefore: '+2.50', lossCp: 400, verdict: 'blunder', evalAfter: '-1.50', matchedBest: false, bestSan: 'Qd1' })],
      plyFens: [INITIAL_FEN],
      white: { acpl: 400 },
      black: { acpl: 20 },
    };
    const readout = coach(review, { side: 'w', plyFens: review.plyFens });
    expect(readout.wasWinning).toBe(true);
    expect(readout.bestHeld).toBe(250);
  });

  it('reads held advantage from the black player\'s point of view', () => {
    const review = {
      moves: [move({ color: 'b', evalBefore: '-2.50', lossCp: 400, verdict: 'blunder' })],
      plyFens: [INITIAL_FEN],
      white: { acpl: 20 },
      black: { acpl: 400 },
    };
    const readout = coach(review, { side: 'b', plyFens: review.plyFens });
    expect(readout.bestHeld).toBe(250);
    expect(readout.wasWinning).toBe(true);
  });
});
