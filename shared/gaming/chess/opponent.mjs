import { applyMove, describePosition, legalMoves } from './engine.mjs';

/**
 * A small, deterministic opponent.
 *
 * Not a strong engine and not trying to be — its job is to be a patient partner
 * for a learner, so it is tuned for legible play rather than strength: it takes
 * free material, avoids hanging its own, and prefers the centre. Difficulty is a
 * search depth plus a blunder rate, because a beginner needs an opponent that
 * loses in ways they can see.
 *
 * Deterministic by construction: no Math.random, ties broken by SAN. Given the
 * same position and seed it always answers the same way, so a lesson can promise
 * a specific reply and a test can assert one.
 */

const PIECE_VALUES = Object.freeze({ p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 });

// Centre control, from the pawn's point of view; mirrored for Black.
const CENTRE_BONUS = Object.freeze({
  d4: 12, e4: 12, d5: 12, e5: 12,
  c3: 6, d3: 6, e3: 6, f3: 6, c4: 6, f4: 6, c5: 6, f5: 6, c6: 6, d6: 6, e6: 6, f6: 6,
});

export const DIFFICULTIES = Object.freeze({
  beginner: { depth: 1, blunder_rate: 0.35, label: 'Beginner' },
  learner: { depth: 2, blunder_rate: 0.15, label: 'Learner' },
  steady: { depth: 3, blunder_rate: 0, label: 'Steady' },
});

/** Cheap 32-bit hash so a seed can pick moves without a stateful RNG. */
function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

/** Material plus a little centre bias, from `color`'s point of view. */
export function evaluatePosition(fen, color) {
  const placement = String(fen).split(' ')[0];
  let score = 0;
  for (const symbol of placement) {
    const value = PIECE_VALUES[symbol.toLowerCase()];
    if (value === undefined) continue;
    const owner = symbol === symbol.toUpperCase() ? 'w' : 'b';
    score += owner === color ? value : -value;
  }
  return score;
}

function scoreMove(fen, move, color) {
  let score = evaluatePosition(move.after, color);
  score += (CENTRE_BONUS[move.to] || 0) * (move.piece === 'p' || move.piece === 'n' ? 1 : 0.5);
  const status = describePosition(move.after);
  if (status?.outcome === 'checkmate') score += 100000;
  else if (status?.outcome === 'stalemate') score -= 5000;
  else if (status?.check) score += 15;
  return score;
}

/** Negamax over material. Depth stays small; this is a teaching partner. */
function search(fen, depth, color, alpha, beta) {
  const moves = legalMoves(fen);
  if (!moves.length || depth <= 0) {
    const status = describePosition(fen);
    if (status?.outcome === 'checkmate') return status.winner === color ? 100000 : -100000;
    if (status?.game_over) return 0;
    return evaluatePosition(fen, color);
  }
  let best = -Infinity;
  for (const move of moves) {
    const score = -search(move.after, depth - 1, color === 'w' ? 'b' : 'w', -beta, -alpha);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/**
 * Picks a reply. Returns null when the side to move has none, which is the
 * caller's cue that the game is already over.
 */
export function chooseMove(fen, { difficulty = 'learner', seed = 0 } = {}) {
  const settings = DIFFICULTIES[difficulty] || DIFFICULTIES.learner;
  const moves = legalMoves(fen);
  if (!moves.length) return null;

  const status = describePosition(fen);
  const color = status?.turn;
  const scored = moves
    .map((move) => ({
      move,
      score: settings.depth > 1
        ? -search(move.after, settings.depth - 1, color === 'w' ? 'b' : 'w', -Infinity, Infinity)
        : scoreMove(fen, move, color),
    }))
    .sort((a, b) => b.score - a.score || a.move.san.localeCompare(b.move.san));

  // A blunder is picking from the rest of the field rather than playing a random
  // legal move: still plausible, still explainable, just not the best try.
  const roll = hashString(`${fen}|${seed}`);
  if (settings.blunder_rate > 0 && scored.length > 1 && roll < settings.blunder_rate) {
    const alternatives = scored.slice(1);
    return alternatives[Math.floor(roll * alternatives.length / settings.blunder_rate) % alternatives.length].move;
  }
  return scored[0].move;
}

/** Convenience: apply the chosen reply and hand back the new FEN. */
export function playOpponentMove(fen, options = {}) {
  const move = chooseMove(fen, options);
  if (!move) return { fen, move: null, error: null };
  return applyMove(fen, { from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) });
}
