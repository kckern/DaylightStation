import { describe, it, expect } from 'vitest';
import { chooseMove } from '../../../../../shared/gaming/checkers/opponent.mjs';
import { legalMoves, applyMove, describeGame } from '../../../../../shared/gaming/checkers/engine.mjs';

// Reported 2026-08-18: "suggested move was a suicide". The hint was searched at
// the OPPONENT's level, and the game defaults to Level 1 of 7. In
// chooseMove, `depth = min(6, max(1, level))` and the search runs at
// `depth - 1` — so level 1 is a ZERO-ply search that never looks at the reply,
// and happily walks a piece onto a square that is immediately jumped.
//
// This position was found by search: at level 1 the engine gives a piece away,
// at level 5 it does not, and a safe move exists in both cases.
const BOARD = [
  'r', 'b', null, null, null, null, null, null,
  null, 'r', null, null, null, null, 'r', 'b',
  'r', null, null, 'b', null, null, null, null,
  null, 'r', 'b', null, null, null, null, 'b',
];

const game = () => {
  const g = { board: [...BOARD], turn: 1, forcedFrom: null, quietPly: 0, moves: [], valid: true, error: null };
  g.status = describeGame(g);
  return g;
};

/** Does this move leave a capture on the table for the opponent? */
const handsOverAPiece = (g, move) => {
  const next = applyMove(g, move);
  if (next.error) return false;
  return legalMoves(next.board, 2, next.forcedFrom).some((m) => m.capture !== null);
};

describe('checkers hint depth', () => {
  it('a level-1 search hands a piece over — which is why a hint must not use it', () => {
    const shallow = chooseMove(game(), { level: 1 });
    expect(shallow).toBeTruthy();
    expect(handsOverAPiece(game(), shallow)).toBe(true);
  });

  it('the depth a hint actually uses does not', () => {
    const deep = chooseMove(game(), { level: 5 });
    expect(deep).toBeTruthy();
    expect(handsOverAPiece(game(), deep)).toBe(false);
  });

  it('a safe move existed all along, so this was help making it worse', () => {
    const g = game();
    const safe = legalMoves(g.board, 1, null).filter((m) => !handsOverAPiece(g, m));
    expect(safe.length).toBeGreaterThan(0);
  });
});
