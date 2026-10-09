import { applyMove, describePosition, INITIAL_FEN } from '@shared-gaming/rulesets/chess/engine.mjs';
import { playedMoves } from '@shared-gaming/rulesets/chess/resumeSlot.mjs';

/**
 * Turn an archived/server game record back into the moves that rebuild it.
 *
 * The record keeps SAN and from/to for every move but not the promotion piece,
 * so it is read back out of the SAN (`e8=Q`). Taken-back moves are not
 * replayed: the board is the played line. The replay is checked against the
 * engine move by move and against `final_fen`; a record that does not replay
 * is refused rather than half-restored.
 *
 * @returns {{ ok: true, moves: Array, finalFen: string, fenMatches: boolean|null, gameOver: boolean }
 *          | { ok: false, reason: string, ply?: number }}
 */
export function replayArchivedGame(record) {
  const initialFen = record?.initial_fen || INITIAL_FEN;
  const line = playedMoves(record);
  if (!line.length) return { ok: false, reason: 'no-moves' };
  let fen = initialFen;
  const moves = [];
  for (const entry of line) {
    const promotion = /=([QRBNqrbn])/.exec(entry.san || '')?.[1]?.toLowerCase();
    const applied = applyMove(fen, { from: entry.from, to: entry.to, ...(promotion ? { promotion } : {}) });
    if (applied.error) return { ok: false, reason: 'illegal-move', ply: entry.ply };
    fen = applied.fen;
    moves.push({ from: entry.from, to: entry.to, promotion: promotion || 'q' });
  }
  return {
    ok: true,
    moves,
    finalFen: fen,
    fenMatches: record?.final_fen ? record.final_fen === fen : null,
    gameOver: !!describePosition(fen)?.game_over,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Where a launch picks its game up from.
 *
 * `local`  — the tablet's own checkpoint: `{ present, unreadable, finished, idleMs, maxIdleMs }`.
 * `server` — what the server said: `null` when it could not be asked (or its
 *            copy would not replay), `{ game: null, window_days }` when it
 *            CONFIRMED there is none, `{ game, window_days }` when there is one.
 *
 * THE RULE THAT CAUSED THE 2026-10-09 LOSS, INVERTED: the idle limit used to
 * discard the only copy of a game. Now it may only set the LOCAL copy aside,
 * and only for a server copy that is confirmed to exist. Otherwise the local
 * checkpoint is kept — unless the server has confirmed the game is older than
 * its whole resume window, which is the 2026-09-27 month-old-board case.
 *
 * @returns {{ source: 'local'|'server'|'new', discardLocal: string|null, keptStale?: string }}
 */
export function chooseResumeSource({ local, server }) {
  const hasServerGame = Boolean(server?.game);
  const localPresent = Boolean(local?.present);
  if (hasServerGame && server.game.pinned) {
    return { source: 'server', discardLocal: localPresent ? 'pinned-server-game' : null };
  }
  if (localPresent && local.unreadable) {
    return hasServerGame
      ? { source: 'server', discardLocal: 'unreadable' }
      : { source: 'new', discardLocal: 'unreadable' };
  }
  if (localPresent && local.finished) {
    return hasServerGame
      ? { source: 'server', discardLocal: 'finished' }
      : { source: 'new', discardLocal: 'finished' };
  }
  const stale = localPresent && Number.isFinite(local.idleMs) && local.idleMs > local.maxIdleMs;
  // A LOCAL CHECKPOINT BEATS AN OPEN SERVER GAME ONLY IF IT CONTINUES IT (the
  // server game's moves are a prefix of the local ones). 2026-10-09: a tablet's
  // fresh-but-unrelated checkpoint outranked the game the owner had restored.
  // The local game is not deleted; it stays on the server as its own entry.
  if (localPresent && !stale && hasServerGame && local.continuesServer === false) {
    return { source: 'server', discardLocal: 'diverges-from-server-game' };
  }
  if (localPresent && !stale) return { source: 'local', discardLocal: null };
  if (hasServerGame) return { source: 'server', discardLocal: stale ? 'stale-server-copy-exists' : null };
  if (stale) {
    const windowDays = Number(server?.window_days);
    if (server && Number.isFinite(windowDays) && local.idleMs > windowDays * DAY_MS) {
      return { source: 'new', discardLocal: 'beyond-resume-window' };
    }
    return {
      source: 'local',
      discardLocal: null,
      keptStale: server ? 'no-server-copy' : 'server-unreachable',
    };
  }
  return { source: 'new', discardLocal: null };
}

export default { replayArchivedGame, chooseResumeSource };
