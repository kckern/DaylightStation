import { applyMove, legalMoves } from './engine.mjs';

// These are mechanics-only difficulty profiles. Environments may merge them
// with names, artwork, and themes loaded from mounted configuration.
export const CHECKERS_OPPONENTS = Object.freeze([
  ...Array.from({ length: 7 }, (_, index) => Object.freeze({
    id: `level-${index + 1}`,
    name: `Level ${index + 1}`,
    art: null,
    depth: index + 1,
  })),
]);

function evaluate(game, player) {
  if (game.status.gameOver) {
    if (game.status.draw) return 0;
    return game.status.winner === player ? 100000 : -100000;
  }
  return game.board.reduce((score, piece, index) => {
    if (!piece) return score;
    const owner = piece.toLowerCase() === 'r' ? 1 : 2;
    const value = piece === piece.toUpperCase() ? 175 : 100;
    const advance = piece === 'r' ? Math.floor(index / 4) * -2 : Math.floor(index / 4) * 2;
    return score + (owner === player ? value + advance : -(value + advance));
  }, 0);
}

function search(game, depth, rootPlayer, alpha, beta) {
  if (depth <= 0 || game.status.gameOver) return evaluate(game, rootPlayer);
  const maximizing = game.turn === rootPlayer;
  let best = maximizing ? -Infinity : Infinity;
  for (const move of legalMoves(game.board, game.turn, game.forcedFrom)) {
    const next = applyMove(game, move);
    const score = search(next, depth - 1, rootPlayer, alpha, beta);
    if (maximizing) {
      best = Math.max(best, score);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, score);
      beta = Math.min(beta, best);
    }
    if (beta <= alpha) break;
  }
  return best;
}

/** Deterministic minimax opponent; ties prefer captures, then stable square order. */
export function chooseMove(game, { level = 1 } = {}) {
  const moves = legalMoves(game.board, game.turn, game.forcedFrom);
  if (!moves.length) return null;
  const player = game.turn;
  const depth = Math.min(6, Math.max(1, Number(level) || 1));
  return moves.map((move) => ({
    move,
    score: search(applyMove(game, move), depth - 1, player, -Infinity, Infinity),
  })).sort((a, b) => b.score - a.score
    || Number(b.move.capture !== null) - Number(a.move.capture !== null)
    || a.move.from - b.move.from
    || a.move.to - b.move.to)[0].move;
}

export default { CHECKERS_OPPONENTS, chooseMove };
