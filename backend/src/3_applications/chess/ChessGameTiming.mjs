/**
 * What the clock says about how a game was played.
 *
 * Time on its own is trivia — "you spent nine minutes" teaches nobody anything.
 * The reason to record it is that time and move quality are related, and the
 * relationship is legible to a child in a way that centipawns are not: *you
 * blunder on the moves you play instantly.* That is a habit a nine-year-old can
 * actually change, which is more than can be said for most engine output.
 *
 * Everything here works from the archive's `think_ms` plus the review's
 * per-move centipawn loss. Nothing re-searches, and a game archived before
 * timing existed simply reports as untimed rather than as zero.
 */

/** Moves that carry a usable think time, paired with their review verdict. */
function timedMoves(reviewMoves, record, side) {
  const byPly = new Map();
  for (const move of record?.moves || []) {
    if (move.undone) continue;
    if (typeof move.think_ms === 'number') byPly.set(move.ply, move.think_ms);
  }
  return reviewMoves
    .filter((move) => move.color === side && byPly.has(move.ply))
    .map((move) => ({ ...move, thinkMs: byPly.get(move.ply) }));
}

export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/**
 * Split the player's moves at their own median think time.
 *
 * The median, not a fixed threshold in seconds: "fast" means fast *for this
 * child in this game*. A fixed cutoff would call every move fast for a quick
 * player and every move slow for a deliberate one, and report that as a
 * finding.
 *
 * Below `MIN_SAMPLE` moves per half the comparison is not worth drawing — two
 * fast moves that happened to include one blunder would read as a damning
 * pattern.
 */
const MIN_SAMPLE = 4;

export function haste(moves) {
  if (moves.length < MIN_SAMPLE * 2) return null;
  const cut = median(moves.map((move) => move.thinkMs));
  const fast = moves.filter((move) => move.thinkMs <= cut);
  const slow = moves.filter((move) => move.thinkMs > cut);
  if (fast.length < MIN_SAMPLE || slow.length < MIN_SAMPLE) return null;
  const acpl = (list) => Math.round(list.reduce((sum, move) => sum + move.lossCp, 0) / list.length);
  const blunderRate = (list) => Math.round(
    (100 * list.filter((move) => move.verdict === 'blunder' || move.verdict === 'mistake').length) / list.length,
  );
  const fastAcpl = acpl(fast);
  const slowAcpl = acpl(slow);
  return {
    cutMs: cut,
    fast: { count: fast.length, acpl: fastAcpl, errorRate: blunderRate(fast) },
    slow: { count: slow.length, acpl: slowAcpl, errorRate: blunderRate(slow) },
    // Positive means the quick moves were the worse ones. A threshold rather
    // than any difference at all: ACPL over a dozen moves is noisy, and a 5cp
    // gap is not a habit.
    costOfHasteCp: fastAcpl - slowAcpl,
    rushing: fastAcpl - slowAcpl >= 30,
  };
}

/**
 * The moves worth pointing at: bad, and played without thinking.
 *
 * Ordered by centipawns lost rather than by speed — the lesson is about the
 * damage, and the speed is the explanation for it.
 */
export function rushedErrors(moves, { maxThinkMs = 5000, minLossCp = 150 } = {}) {
  return moves
    .filter((move) => move.thinkMs <= maxThinkMs && move.lossCp >= minLossCp)
    .sort((a, b) => b.lossCp - a.lossCp);
}

/**
 * The whole timing read for one side of one game.
 *
 * Returns `{ timed: false }` when there is nothing to say, so callers can skip
 * the section outright rather than printing a row of zeroes that looks like a
 * measurement.
 */
export function analyzeTiming(review, record, { side = 'w' } = {}) {
  const moves = timedMoves(review.moves, record, side);
  if (!moves.length) return { timed: false, mode: record?.timing?.mode || 'off' };

  const thinks = moves.map((move) => move.thinkMs);
  const total = thinks.reduce((sum, value) => sum + value, 0);
  const slowest = moves.reduce((worst, move) => (move.thinkMs > worst.thinkMs ? move : worst), moves[0]);

  return {
    timed: true,
    mode: record?.timing?.mode || 'off',
    moveCount: moves.length,
    totalMs: total,
    meanMs: Math.round(total / moves.length),
    medianMs: median(thinks),
    slowest: { san: slowest.san, moveNumber: slowest.moveNumber, thinkMs: slowest.thinkMs },
    haste: haste(moves),
    rushedErrors: rushedErrors(moves).slice(0, 3),
    // The opponent's share, for context: a child who spent 20 seconds a move
    // against an engine answering in 400ms is not slow, they are thinking.
    opponentMs: (record?.timing?.spent_ms?.[side === 'w' ? 'b' : 'w']) ?? null,
  };
}

/** Human-readable think time. Mirrors the kiosk's own formatting. */
export function formatThink(ms) {
  if (ms == null || !Number.isFinite(ms)) return '-';
  if (ms < 1000) return '<1s';
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return seconds ? `${minutes}m${seconds}s` : `${minutes}m`;
}

export default { analyzeTiming, haste, rushedErrors, median, formatThink };
