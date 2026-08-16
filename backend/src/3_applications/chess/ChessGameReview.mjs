import { Chess } from 'chess.js';

/**
 * Post-hoc review of an archived chess game.
 *
 * The archive format was written with this in mind — it keeps `from`/`to` per
 * ply and marks takebacks `undone` rather than deleting them — so a review can
 * reconstruct both what was played and what was retracted.
 *
 * What this answers, and the play adapter cannot: how well did the HUMAN play?
 * The ladder knows which rung a child faced, but a rung is the opponent's
 * strength, not the child's. A loss to Level 0 and a near-miss against Level 0
 * are the same row in the history file and very different facts about a player.
 */

/**
 * Evaluations are clamped before any subtraction.
 *
 * Without this, one already-decided position dominates the average: going from
 * +900 to +300 while still completely winning would score as a 600cp "blunder"
 * and outweigh a dozen real errors. Ten pawns is far past the point where more
 * advantage means anything, so that is where the scale stops.
 */
const EVAL_CAP_CP = 1000;

/** Centipawns lost, at or above which a move earns each label. */
export const THRESHOLDS = Object.freeze({ inaccuracy: 75, mistake: 150, blunder: 300 });

/**
 * Rough ACPL-to-strength bands.
 *
 * Deliberately bands and not a formula: average centipawn loss depends on how
 * sharp the positions happened to be, so a single Elo number would be false
 * precision. Good enough to answer "is this rung the right rung", which is the
 * only question being asked of it.
 */
const ACPL_BANDS = Object.freeze([
  { maxAcpl: 20, label: 'strong club player', elo: '2000+' },
  { maxAcpl: 35, label: 'club player', elo: '1600-2000' },
  { maxAcpl: 55, label: 'intermediate', elo: '1300-1600' },
  { maxAcpl: 80, label: 'improving beginner', elo: '1000-1300' },
  { maxAcpl: 120, label: 'beginner', elo: '700-1000' },
  { maxAcpl: Infinity, label: 'learning the pieces', elo: 'under 700' },
]);

export function bandForAcpl(acpl) {
  return ACPL_BANDS.find((band) => acpl <= band.maxAcpl);
}

/**
 * One evaluation as a single number, white-positive, for subtraction.
 *
 * Mate scores collapse to the cap rather than to a mate distance: "mate in 3"
 * and "mate in 9" are equally won, and letting the distance vary would score
 * slow-but-forced wins as though the player were losing ground each move.
 */
function toNumber(score) {
  if (!score || score.terminal) return null;
  if (score.mate != null) return score.mate > 0 ? EVAL_CAP_CP : -EVAL_CAP_CP;
  if (score.cp == null) return null;
  return Math.max(-EVAL_CAP_CP, Math.min(EVAL_CAP_CP, score.cp));
}

export function formatScore(score) {
  if (!score || score.terminal) return 'game over';
  if (score.mate != null) return `M${score.mate}`;
  if (score.cp == null) return '?';
  const pawns = score.cp / 100;
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(2)}`;
}

export function classify(lossCp) {
  if (lossCp >= THRESHOLDS.blunder) return 'blunder';
  if (lossCp >= THRESHOLDS.mistake) return 'mistake';
  if (lossCp >= THRESHOLDS.inaccuracy) return 'inaccuracy';
  return 'ok';
}

/** UCI to SAN in a given position, for printing the engine's recommendation. */
function uciToSan(fen, uci) {
  if (!uci) return null;
  try {
    const board = new Chess(fen);
    const move = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
    return move?.san || uci;
  } catch {
    return uci;
  }
}

/**
 * Replay an archived game's move list into the position before each ply.
 *
 * Takebacks are excluded from the played line but returned alongside it: a move
 * a child retracted is not part of the game, but it IS part of how the game
 * went, and a review that hides it would credit them for finding a move the
 * engine handed back to them.
 */
export function replay(gameRecord) {
  const all = Array.isArray(gameRecord?.moves) ? gameRecord.moves : [];
  const played = all.filter((move) => !move.undone);
  const retracted = all.filter((move) => move.undone);
  const board = new Chess(gameRecord?.initial_fen || undefined);
  const plies = [];
  for (const move of played) {
    const fenBefore = board.fen();
    let applied;
    try {
      applied = board.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
    } catch (cause) {
      // chess.js THROWS on a rejected move rather than returning null, so a
      // plain falsy check here would never fire and the caller would see
      // `Invalid move: {"from":...}` with no hint which archived game, which
      // ply, or which position produced it.
      throw new Error(`archived move ${move.ply} (${move.san}) is illegal in ${fenBefore}`, { cause });
    }
    plies.push({ ply: plies.length + 1, san: applied.san, color: applied.color, fenBefore });
  }
  return { plies, retracted, finalFen: board.fen() };
}

/**
 * Analyse every position once and attribute the loss to the player who moved.
 *
 * One probe per position, not two: the evaluation AFTER ply N is by definition
 * the evaluation BEFORE ply N+1, and probing both would double the cost of a
 * review for identical numbers.
 */
export async function reviewGame(gameRecord, analyst, { onProgress = null } = {}) {
  const { plies, retracted, finalFen } = replay(gameRecord);
  const fens = [...plies.map((ply) => ply.fenBefore), finalFen];

  const scores = [];
  for (let index = 0; index < fens.length; index += 1) {
    scores.push(await analyst.evaluate(fens[index]));
    onProgress?.(index + 1, fens.length);
  }

  const moves = plies.map((ply, index) => {
    const before = scores[index];
    const after = scores[index + 1];
    const beforeNum = toNumber(before);
    const afterNum = toNumber(after);
    // A terminal position after the move means the game ended here — there was
    // no ground left to lose, so the move is scored as no loss rather than as a
    // swing from a number to nothing.
    const rawLoss = beforeNum == null || afterNum == null
      ? 0
      : (ply.color === 'w' ? beforeNum - afterNum : afterNum - beforeNum);
    const lossCp = Math.max(0, Math.round(rawLoss));
    const bestSan = uciToSan(ply.fenBefore, before?.bestUci);
    return {
      ply: ply.ply,
      moveNumber: Math.floor((ply.ply - 1) / 2) + 1,
      color: ply.color,
      san: ply.san,
      evalBefore: formatScore(before),
      evalAfter: formatScore(after),
      lossCp,
      verdict: classify(lossCp),
      bestSan,
      // Matching the engine's first choice is worth separating from "lost
      // little": in a quiet position almost everything loses little.
      matchedBest: Boolean(bestSan) && bestSan === ply.san,
    };
  });

  return {
    moves,
    retracted,
    // The position before each ply, so a coaching pass can inspect the board
    // without replaying the game a second time.
    plyFens: plies.map((ply) => ply.fenBefore),
    finalFen,
    white: summarize(moves.filter((move) => move.color === 'w')),
    black: summarize(moves.filter((move) => move.color === 'b')),
  };
}

/**
 * Per-side aggregates.
 *
 * The opening is excluded from ACPL. Book moves are free accuracy — a player
 * who knows three moves of theory posts a great average for reasons that say
 * nothing about their play — and including them flatters both sides equally
 * but flatters the weaker player more, since it is a larger share of their few
 * good moves.
 */
export function summarize(moves, { skipOpeningPlies = 4 } = {}) {
  const counted = moves.filter((move) => move.ply > skipOpeningPlies);
  const scored = counted.length ? counted : moves;
  const totalLoss = scored.reduce((sum, move) => sum + move.lossCp, 0);
  const acpl = scored.length ? Math.round(totalLoss / scored.length) : 0;
  const band = bandForAcpl(acpl);
  return {
    moveCount: moves.length,
    scoredMoveCount: scored.length,
    acpl,
    band: band.label,
    eloBand: band.elo,
    blunders: moves.filter((move) => move.verdict === 'blunder'),
    mistakes: moves.filter((move) => move.verdict === 'mistake'),
    inaccuracies: moves.filter((move) => move.verdict === 'inaccuracy'),
    bestMoveRate: moves.length
      ? Math.round((moves.filter((move) => move.matchedBest).length / moves.length) * 100)
      : 0,
  };
}

export default { reviewGame, replay, summarize, classify, formatScore, bandForAcpl, THRESHOLDS };
