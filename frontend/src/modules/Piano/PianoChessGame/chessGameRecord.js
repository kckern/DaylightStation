/**
 * What a finished game leaves behind.
 *
 * Facts, not a score: moves and help are reported side by side rather than
 * compressed into one number, because a single number has to decide what a win
 * with three hints is worth — and whatever it decides, someone optimises the
 * number instead of the chess.
 *
 * The shape is not free. `completed`, `level` and the `help` block are exactly
 * what `countsTowardPromotion` in the shared ladder reads, and a record missing
 * any of them is silently uncounted — every game reads as help-heavy and nobody
 * is ever promoted. Help is nested here (rather than flat, as it once was) so
 * that this record and the archive's `help` block are the same shape, and a
 * reader of one can read the other.
 */
export function buildGameRecord({
  game, rungId, level = null, opponent = null, hints, bestMoves, takebacks = 0, startedAt, endedAt,
}) {
  if (!game?.status?.game_over) return null;
  const outcome = game.status.outcome;
  const result = outcome === 'checkmate'
    ? (game.status.winner === game.playerColor ? 'win' : 'loss')
    : 'draw';
  return {
    result,
    outcome,
    // Always true for a record that exists at all — the guard above refuses an
    // unfinished game. Written out because the ladder tests for it, and an
    // absent field there means "did not finish".
    completed: true,
    // Which rung this was played against. The ladder refuses to promote on a
    // game played against anyone other than the opponent being climbed, and
    // without this it cannot tell the difference.
    level: Number.isFinite(Number(level)) ? Number(level) : null,
    moves: Math.ceil((game.history?.length || 0) / 2),
    help: {
      hints: Math.max(0, hints || 0),
      best_moves: Math.max(0, bestMoves || 0),
      takebacks: Math.max(0, takebacks || 0),
    },
    rung: rungId || null,
    opponent,
    duration_ms: Math.max(0, (endedAt || 0) - (startedAt || 0)),
  };
}

export default { buildGameRecord };
