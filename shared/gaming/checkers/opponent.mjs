import { applyMove, legalMoves } from './engine.mjs';

const pokemonArt = (file) => `/api/v1/proxy/media/stream/${encodeURIComponent(`games/pokemon/svg/${file}`)}`;

// Agile and fighting characters for the jumping/crowning game. This pack is
// intentionally different from both Chess and Connect Four.
export const CHECKERS_OPPONENTS = Object.freeze([
  { id: 'nidoran-f', name: 'Nidoran♀', art: pokemonArt('0029-nidoran-f-gen1.svg'), depth: 1 },
  { id: 'sandshrew', name: 'Sandshrew', art: pokemonArt('0027-sandshrew-gen1.svg'), depth: 2 },
  { id: 'mankey', name: 'Mankey', art: pokemonArt('0056-mankey-gen1.svg'), depth: 3 },
  { id: 'hitmonlee', name: 'Hitmonlee', art: pokemonArt('0106-hitmonlee-gen1.svg'), depth: 4 },
  { id: 'kangaskhan', name: 'Kangaskhan', art: pokemonArt('0115-kangaskhan-gen1.svg'), depth: 5 },
  { id: 'pinsir', name: 'Pinsir', art: pokemonArt('0127-pinsir-gen1.svg'), depth: 6 },
  { id: 'articuno', name: 'Articuno', art: pokemonArt('0144-articuno-gen1.svg'), depth: 7 },
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
