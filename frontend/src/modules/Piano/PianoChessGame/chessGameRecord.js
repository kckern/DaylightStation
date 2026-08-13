/**
 * What a finished game leaves behind.
 *
 * Facts, not a score: moves and help are reported side by side rather than
 * compressed into one number, because a single number has to decide what a win
 * with three hints is worth — and whatever it decides, someone optimises the
 * number instead of the chess.
 */
export function buildGameRecord({ game, rungId, hints, bestMoves, startedAt, endedAt }) {
  if (!game?.status?.game_over) return null;
  const outcome = game.status.outcome;
  const result = outcome === 'checkmate'
    ? (game.status.winner === game.playerColor ? 'win' : 'loss')
    : 'draw';
  return {
    result,
    outcome,
    moves: Math.ceil((game.history?.length || 0) / 2),
    hints: Math.max(0, hints || 0),
    best_moves: Math.max(0, bestMoves || 0),
    rung: rungId || null,
    duration_ms: Math.max(0, (endedAt || 0) - (startedAt || 0)),
  };
}

export default { buildGameRecord };
