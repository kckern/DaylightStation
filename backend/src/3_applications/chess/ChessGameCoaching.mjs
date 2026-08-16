import { Chess } from 'chess.js';

/**
 * Turning a reviewed game into something a child can be taught from.
 *
 * `ChessGameReview` produces numbers — this produces sentences. The split is
 * deliberate: the numbers are a measurement and should not change, while the
 * coaching read on them is opinionated and will be tuned as the kids get
 * better. Keeping the opinion out of the measurement means tuning one never
 * silently rewrites the other.
 *
 * Everything here works from the review plus the position, and never asks the
 * engine anything new: a coaching pass that re-searched would double the cost
 * of a review to restate what the review already knows.
 */

const PIECE_VALUES = Object.freeze({ p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 });
const PIECE_NAMES = Object.freeze({ p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' });

/**
 * Which phase a ply belongs to.
 *
 * Phase is read off the board rather than the move number, because a game that
 * trades everything by move 12 is in an endgame whatever the clock says, and
 * calling that "the middlegame" would file a child's endgame technique under
 * the wrong heading for the rest of the report.
 */
export function phaseOf(fen, ply) {
  const board = new Chess(fen);
  let material = 0;
  let queens = 0;
  for (const row of board.board()) {
    for (const square of row) {
      if (!square || square.type === 'p' || square.type === 'k') continue;
      material += PIECE_VALUES[square.type];
      if (square.type === 'q') queens += 1;
    }
  }
  if (material <= 20 || (queens === 0 && material <= 32)) return 'endgame';
  if (ply <= 20) return 'opening';
  return 'middlegame';
}

/** What sits on a square, as `{ type, color }`, or null. */
function pieceAt(fen, square) {
  return new Chess(fen).get(square) || null;
}

/** Is `square` defended by `color` in this position? */
function isDefended(fen, square, color) {
  // chess.js reports attackers of a square for a given colour; a defender is
  // just an attacker of your own piece, so the same query answers both.
  return new Chess(fen).attackers(square, color).length > 0;
}

/**
 * What the player missed, in words, for one move.
 *
 * These are the motifs a beginner can actually act on. Deliberately
 * conservative: a wrong lesson confidently stated is worse than no lesson,
 * so anything not clearly recognisable returns nothing and the move is left
 * to speak for itself through its evaluation.
 */
export function motifFor(move, fenBefore) {
  if (!move.bestSan || move.matchedBest) return null;
  const board = new Chess(fenBefore);
  const mover = board.turn();
  const enemy = mover === 'w' ? 'b' : 'w';

  let best;
  try {
    best = board.move(move.bestSan);
  } catch {
    return null;
  }

  // Missed mate: the engine's move mates outright.
  if (board.isCheckmate()) return { motif: 'missed-mate', lesson: `${move.bestSan} was checkmate.` };

  if (best.captured) {
    const value = PIECE_VALUES[best.captured];
    const name = PIECE_NAMES[best.captured];
    const defended = isDefended(fenBefore, best.to, enemy);
    // Only call it free if nothing recaptures. A "free queen" that is defended
    // is a trade, and teaching a child to grab defended pieces is teaching them
    // to lose material.
    if (!defended && value >= 3) {
      return { motif: 'missed-free-piece', lesson: `${move.bestSan} won an undefended ${name} on ${best.to}.` };
    }
    if (best.captured === 'q') {
      return { motif: 'missed-queen', lesson: `${move.bestSan} took the queen on ${best.to}.` };
    }
  }

  // Hung material: after the move actually played, something valuable of the
  // mover's is attacked by the enemy and has nothing defending it.
  const afterPlayed = new Chess(fenBefore);
  try { afterPlayed.move(move.san); } catch { return null; }
  const hanging = [];
  for (const row of afterPlayed.board()) {
    for (const square of row) {
      if (!square || square.color !== mover || square.type === 'k') continue;
      if (PIECE_VALUES[square.type] < 3) continue;
      const attacked = afterPlayed.attackers(square.square, enemy).length > 0;
      const defended = afterPlayed.attackers(square.square, mover).length > 0;
      if (attacked && !defended) hanging.push(square);
    }
  }
  if (hanging.length) {
    const worst = hanging.sort((a, b) => PIECE_VALUES[b.type] - PIECE_VALUES[a.type])[0];
    return {
      motif: 'hung-piece',
      lesson: `it left the ${PIECE_NAMES[worst.type]} on ${worst.square} undefended and attacked.`,
    };
  }

  if (move.bestSan === 'O-O' || move.bestSan === 'O-O-O') {
    return { motif: 'missed-castling', lesson: 'castling would have got the king to safety.' };
  }
  return null;
}

/** ACPL and error counts split by phase, so a weakness has an address. */
export function phaseBreakdown(moves, plyFens) {
  const buckets = { opening: [], middlegame: [], endgame: [] };
  for (const move of moves) {
    buckets[phaseOf(plyFens[move.ply - 1], move.ply)].push(move);
  }
  return Object.entries(buckets)
    .filter(([, list]) => list.length)
    .map(([phase, list]) => ({
      phase,
      moveCount: list.length,
      acpl: Math.round(list.reduce((sum, m) => sum + m.lossCp, 0) / list.length),
      blunders: list.filter((m) => m.verdict === 'blunder').length,
    }));
}

/**
 * The one move most worth showing them.
 *
 * Not simply the largest centipawn loss: a blunder made while already lost
 * changed nothing, and pointing at it teaches a child that the game was
 * decided by a move that came after it was over. The moment that matters is
 * the biggest loss that actually surrendered a position worth having.
 */
export function criticalMoment(moves, side) {
  const own = moves.filter((move) => move.color === side && move.lossCp >= 150);
  const decisive = own.filter((move) => {
    const before = parseEval(move.evalBefore);
    const after = parseEval(move.evalAfter);
    if (before == null || after == null) return false;
    const held = side === 'w' ? before : -before;
    const kept = side === 'w' ? after : -after;
    // Held a playable-or-better position, and gave it away.
    return held > -100 && kept < held - 100;
  });
  const pool = decisive.length ? decisive : own;
  return pool.sort((a, b) => b.lossCp - a.lossCp)[0] || null;
}

/** '+2.46' / 'M-3' / 'game over' back to centipawns, white-positive. */
export function parseEval(text) {
  if (!text || text === 'game over' || text === '?') return null;
  if (text.startsWith('M')) return Number(text.slice(1)) > 0 ? 1000 : -1000;
  const value = Number(text);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

/**
 * The whole coaching read for one side of one game.
 *
 * `plyFens` is the position before each ply, which the review already walked —
 * passing it in keeps this module from replaying the game a second time.
 */
export function coach(review, { side = 'w', plyFens = [] } = {}) {
  const own = review.moves.filter((move) => move.color === side);
  const summary = side === 'w' ? review.white : review.black;
  const moment = criticalMoment(review.moves, side);
  const motifs = new Map();
  for (const move of own) {
    if (move.verdict === 'ok') continue;
    const found = motifFor(move, plyFens[move.ply - 1]);
    if (!found) continue;
    const entry = motifs.get(found.motif) || { motif: found.motif, count: 0, examples: [] };
    entry.count += 1;
    if (entry.examples.length < 3) entry.examples.push({ move, lesson: found.lesson });
    motifs.set(found.motif, entry);
  }

  // Was the game ever theirs? A child who was winning and lost needs a
  // different conversation from one who was never in it.
  const held = own
    .map((move) => parseEval(move.evalBefore))
    .filter((value) => value != null)
    .map((value) => (side === 'w' ? value : -value));
  const bestHeld = held.length ? Math.max(...held) : null;

  return {
    summary,
    criticalMoment: moment,
    criticalMotif: moment ? motifFor(moment, plyFens[moment.ply - 1]) : null,
    phases: phaseBreakdown(own, plyFens),
    motifs: [...motifs.values()].sort((a, b) => b.count - a.count),
    bestHeld,
    wasWinning: bestHeld != null && bestHeld >= 200,
  };
}

export default { coach, criticalMoment, motifFor, phaseBreakdown, phaseOf, parseEval };
