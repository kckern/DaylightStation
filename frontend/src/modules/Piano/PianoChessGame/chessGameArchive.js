import { INITIAL_FEN } from '@shared-gaming/chess/engine.mjs';
import { elapsedBySide, moveDurations } from './chessClock.js';

/**
 * The full account of a game, for the household history.
 *
 * The per-user record next to this one is a scorecard — result, moves, help —
 * and it only exists for games that finished. This is the other thing: every
 * game, finished or walked away from, written down completely enough that the
 * engine can replay it later and say where it went wrong.
 *
 * Two audiences, and the shape serves both:
 *
 *   - **The engine.** `initial_fen` plus the SAN and from/to of every move is a
 *     replayable game. Blunder analysis, accuracy, where the child lost the
 *     thread — all of that is downstream of having the moves at all, and none of
 *     it can be recovered later if they were not written down.
 *   - **The music.** Every move records the two addresses that performed it, in
 *     the vocabulary that was in use. Progress at this instrument is not only
 *     chess progress: which chords a child can spell under time pressure, or
 *     which notes they can read, is the thing the piano is actually teaching,
 *     and it is invisible in a PGN.
 *
 * An abandoned game is kept deliberately. Walking away is data — a position that
 * a child gave up on says more about where they are than one they finished.
 */

/** ISO date in local time, which is the day the child would say they played. */
export function localDateStamp(at) {
  const date = new Date(at);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** One move, in both notations. Shared by the played line and the rewound one. */
function serializeMove(entry, ply, undone, thinkMs = null) {
  return {
    ply,
    san: entry.san,
    from: entry.from,
    to: entry.to,
    color: entry.color,
    captured: entry.captured || null,
    // The two addresses the player performed it with, origin then destination.
    played: Array.isArray(entry.chords) ? entry.chords.filter(Boolean) : [],
    // How long this move took. The single most useful thing about it is not the
    // number but its correlation with the move's quality — a child's blunders
    // and their fastest moves tend to be the same moves, and that is only
    // visible if the time was written down while it happened. Omitted entirely
    // rather than zeroed when untimed, so an analyzer can tell "instant" from
    // "not recorded".
    ...(thinkMs == null ? {} : { think_ms: thinkMs }),
    undone,
    ...(undone ? { undone_at_ply: entry.undone_at_ply ?? ply, undone_seq: entry.undone_seq ?? null } : {}),
  };
}

/**
 * @param {object} args
 * @param {object} args.game        live game state
 * @param {string} args.gameId      the id the opponent requests were made under
 * @param {string} args.userId      whose game this is (null for a guest)
 * @param {string} args.rungId      opponent strength played against
 * @param {string} args.addressing  'chords' | 'staff' — the vocabulary in use
 * @param {number} args.hints
 * @param {number} args.bestMoves
 * @param {number} args.takebacks
 * @param {number} args.startedAt
 * @param {number} args.endedAt
 * @param {string} args.endedBy     'game_over' | 'left'
 */
export function buildGameArchive({
  game, gameId, userId, rungId, opponent = null, addressing = 'chords',
  hints = 0, bestMoves = 0, takebacks = 0, startedAt, endedAt, endedBy = 'left',
  timing = null,
}) {
  const history = Array.isArray(game?.history) ? game.history : [];
  const rewound = Array.isArray(game?.undoneHistory) ? game.undoneHistory : [];
  // A game with no moves is not a game. Recording it would bury the real ones
  // under a file per accidental visit to the screen. A game whose every move
  // was taken back IS one, though — a child who played and unplayed a move sat
  // down and tried something, and that is the thing worth knowing.
  if (!history.length && !rewound.length) return null;

  const durations = moveDurations(history, startedAt);
  const spent = elapsedBySide(history, startedAt);

  const completed = !!game?.status?.game_over;
  const outcome = completed ? game.status.outcome : null;
  const playerColor = game?.playerColor || 'w';
  const result = completed
    ? (outcome === 'checkmate' ? (game.status.winner === playerColor ? 'win' : 'loss') : 'draw')
    : null;

  return {
    game_id: gameId || null,
    user_id: userId || null,
    played_on: localDateStamp(startedAt || endedAt || Date.now()),
    started_at: new Date(startedAt || Date.now()).toISOString(),
    ended_at: new Date(endedAt || Date.now()).toISOString(),
    duration_ms: Math.max(0, (endedAt || 0) - (startedAt || 0)),

    // Was it played to a conclusion, and if so which one. `completed: false` is
    // the interesting case, so it is a field rather than an absence.
    completed,
    ended_by: endedBy,
    result,
    outcome,

    player_color: playerColor,
    rung: rungId || null,
    opponent,

    // How the squares were addressed. Without this the chords below cannot be
    // interpreted — 'C/B' is two staff notes, 'Cm' is a chord.
    addressing,
    scheme: game?.scheme?.id || null,

    // Enough to replay: the start position and every move in both notations.
    initial_fen: game?.initialFen || INITIAL_FEN,
    final_fen: game?.game?.fen || null,
    move_count: history.length,
    // The played line and the abandoned ones, in the order they happened. A
    // replayer filters `undone` out and reaches `final_fen`; an analyzer reads
    // them and finds the moment the game actually turned. Sorted by the ply
    // each was played at, with the rewound move first when both share one —
    // because it was played first, and then unplayed.
    moves: [
      // A rewound move has no think time attached. Its duration would be
      // measured against a played line it is not part of, and the number would
      // be meaningless — the total time it consumed is still visible in
      // `duration_ms`, which is wall clock and counts everything.
      ...rewound.map((entry) => serializeMove(entry, entry.ply, true)),
      ...history.map((entry, index) => serializeMove(entry, index + 1, false, durations[index])),
    ].sort((a, b) => (a.ply - b.ply) || (a.undone === b.undone ? 0 : (a.undone ? -1 : 1))),

    // How the clock was set and where the time went. `mode: 'off'` is recorded
    // rather than omitted: a game played without a clock is a fact about the
    // game, and an analyzer must be able to tell it from one whose timing was
    // lost.
    timing: {
      mode: timing?.mode || 'off',
      initial_ms: timing?.initial_ms ?? null,
      increment_ms: timing?.increment_ms ?? null,
      // Summed from the moves rather than from the clock display, so the
      // archive agrees with the move list it ships alongside.
      spent_ms: spent,
      timed_moves: durations.filter((value) => value != null).length,
    },

    help: {
      hints: Math.max(0, hints || 0),
      best_moves: Math.max(0, bestMoves || 0),
      takebacks: Math.max(0, takebacks || 0),
    },
  };
}

export default { buildGameArchive, localDateStamp };
