import { DaylightAPI } from '../../../lib/api.mjs';
import getLogger from '../../../lib/logging/Logger.js';

/**
 * Thin client for the server-side chess engine.
 *
 * Every call resolves rather than throws: the caller (the opponent effect in
 * PianoChessGame) falls back to the bundled engine on any failure, so the game
 * must never block on the network. Errors are logged, then swallowed.
 *
 * Points at the sole canonical Piano-owned namespace:
 * `/api/v1/piano-games/chess/*`.
 */

let cachedLogger;
function logger() {
  if (!cachedLogger) cachedLogger = getLogger().child({ component: 'chess-api' });
  return cachedLogger;
}

const withUser = (path, userId) => (userId ? `${path}?user=${encodeURIComponent(userId)}` : path);

/**
 * The move request's deadline. The server bounds its own thinking
 * (movetime + margin); this bounds the transport, which on the kiosk tablet is
 * known to stall silently when WiFi drops. Past the deadline we resolve null so
 * the caller's bundled-engine fallback engages instead of "thinking" forever.
 * A plain setTimeout race rather than AbortSignal.timeout: WebView support for
 * the latter on the 2018 tablet is uncertain.
 */
const MOVE_TIMEOUT_MS = 8000;
const QUIP_TIMEOUT_MS = 2400;

/** Resolves null on any failure: the caller falls back to the local engine. */
export async function requestOpponentMove({ fen, rung, level = null, gameId, userId = null }) {
  const request = DaylightAPI(withUser('api/v1/piano-games/chess/move', userId), { fen, rung, level, gameId }, 'POST')
    .then((body) => (body && body.from && body.to ? body : null))
    .catch((error) => {
      // Attached up front so a rejection arriving after the timeout has already
      // won is still handled rather than surfacing as an unhandled rejection.
      logger().warn('chess.move.request-error', { error: error.message, gameId, rung, level });
      return null;
    });
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      logger().warn('chess.move.timeout', { gameId, rung, level, timeoutMs: MOVE_TIMEOUT_MS });
      resolve(null);
    }, MOVE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The engine's real opinion about a position, for hints.
 *
 * A separate endpoint from the move request, not the move endpoint with a
 * strong rung. The ladder's lower rungs are no longer Stockfish at all, so
 * asking the opponent engine for "the best move" would hand a child whatever a
 * deliberately-weak teaching opponent happened to like. Analysis has its own
 * door and is never handicapped.
 *
 * Resolves null on any failure or timeout, exactly like a move request: the
 * caller must not charge the player for help that never arrived.
 */
export async function requestBestMove({ fen, userId = null }) {
  const request = DaylightAPI(withUser('api/v1/piano-games/chess/analyze', userId), { fen }, 'POST')
    .then((body) => (body && body.move && body.move.from ? body.move : null))
    .catch((error) => {
      logger().warn('chess.analyze.request-error', { error: error.message });
      return null;
    });
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      logger().warn('chess.analyze.timeout', { timeoutMs: MOVE_TIMEOUT_MS });
      resolve(null);
    }, MOVE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask for cosmetic dialogue after a committed move. This is deliberately a
 * separate, shorter request: speech may arrive late or not at all, but chess
 * input and opponent turns never wait for it.
 */
export async function requestOpponentQuip({ gameId, ply, level, playerColor, game, dialogue = [], userId = null }) {
  const request = DaylightAPI(withUser('api/v1/piano-games/chess/dialogue', userId), {
    sessionId: gameId, ply, level, playerSide: playerColor, transcript: game, dialogue,
  }, 'POST').then((body) => (body?.quip ? body : { fallbackReason: 'invalid_output' })).catch((error) => {
    logger().warn('chess.quip.request-error', { error: error.message, gameId, ply });
    return { fallbackReason: 'client_error' };
  });
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      logger().warn('chess.quip.timeout', { gameId, ply, timeoutMs: QUIP_TIMEOUT_MS });
      resolve({ fallbackReason: 'client_timeout' });
    }, QUIP_TIMEOUT_MS);
  });
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Shared contract name; requestOpponentQuip remains a source compatibility alias. */
export const requestDialogue = requestOpponentQuip;

export async function fetchChessConfig(userId = null) {
  try {
    // No data object: DaylightAPI promotes a GET with a body to POST.
    return await DaylightAPI(withUser('api/v1/piano-games/chess/config', userId));
  } catch (error) {
    logger().warn('chess.config.fetch-error', { error: error.message });
    return null;
  }
}

export async function saveChessConfig(userId, patch) {
  try {
    return await DaylightAPI(withUser('api/v1/piano-games/chess/config', userId), patch, 'PUT');
  } catch (error) {
    logger().warn('chess.config.save-error', { error: error.message });
    return null;
  }
}

export async function saveGameRecord(userId, record) {
  try {
    return await DaylightAPI(withUser('api/v1/piano-games/chess/games', userId), record, 'POST');
  } catch (error) {
    logger().warn('chess.game.save-error', { error: error.message });
    return null;
  }
}

/**
 * Archive the whole game to the household history.
 *
 * Separate from `saveGameRecord`, and deliberately: that one is the player's own
 * scorecard for a finished game, this one is the replayable account of ANY game,
 * abandoned ones included. Guests are archived too — the household history is
 * about what happened on this piano, not about whose profile it belongs to, and
 * the record carries a null user rather than being dropped.
 *
 * Fire-and-forget on the way out: a failed archive must never keep a child on a
 * screen they are trying to leave.
 */
export async function archiveGame(record) {
  try {
    return await DaylightAPI('api/v1/piano-games/chess/history', record, 'POST');
  } catch (error) {
    logger().warn('chess.game.archive-error', { error: error.message });
    return null;
  }
}

/**
 * Archive on the way out of the PAGE, not just out of the component.
 *
 * A React cleanup runs when the player navigates inside the app. It does not run
 * when the tab is closed, when the kiosk reloads after a deploy, or when the
 * screen is put to sleep — which on this instrument is the ordinary way a game
 * ends. `sendBeacon` is the only request that survives that, because the browser
 * takes ownership of it as the document goes away.
 *
 * Returns whether the beacon was accepted for delivery, so the caller can fall
 * back to a normal request when it was not (queue full, or no beacon support).
 */
/** Where this player stands on the opponent ladder. */
export async function fetchLadder(userId) {
  try {
    return await DaylightAPI(withUser('api/v1/piano-games/chess/ladder', userId));
  } catch (error) {
    logger().warn('chess.ladder.fetch-error', { error: error.message });
    return null;
  }
}

export function beaconArchive(record) {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return false;
    const blob = new Blob([JSON.stringify(record)], { type: 'application/json' });
    return navigator.sendBeacon('/api/v1/piano-games/chess/history', blob);
  } catch (error) {
    logger().warn('chess.game.beacon-error', { error: error.message });
    return false;
  }
}

export default {
  requestOpponentMove, requestOpponentQuip, requestDialogue, requestBestMove, fetchChessConfig, saveChessConfig, saveGameRecord,
  archiveGame, beaconArchive, fetchLadder,
};
