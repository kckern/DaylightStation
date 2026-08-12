import { DaylightAPI } from '../../../lib/api.mjs';
import getLogger from '../../../lib/logging/Logger.js';

/**
 * Thin client for the server-side chess engine.
 *
 * Every call resolves rather than throws: the caller (the opponent effect in
 * PianoChessGame) falls back to the bundled engine on any failure, so the game
 * must never block on the network. Errors are logged, then swallowed.
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

/** Resolves null on any failure: the caller falls back to the local engine. */
export async function requestOpponentMove({ fen, rung, gameId, userId = null }) {
  const request = DaylightAPI(withUser('api/v1/chess/move', userId), { fen, rung, gameId }, 'POST')
    .then((body) => (body && body.from ? body : null))
    .catch((error) => {
      // Attached up front so a rejection arriving after the timeout has already
      // won is still handled rather than surfacing as an unhandled rejection.
      logger().warn('chess.move.request-error', { error: error.message });
      return null;
    });
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      logger().warn('chess.move.timeout', { gameId, timeoutMs: MOVE_TIMEOUT_MS });
      resolve(null);
    }, MOVE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchChessConfig(userId = null) {
  try {
    // No data object: DaylightAPI promotes a GET with a body to POST.
    return await DaylightAPI(withUser('api/v1/chess/config', userId));
  } catch (error) {
    logger().warn('chess.config.fetch-error', { error: error.message });
    return null;
  }
}

export async function saveChessConfig(userId, patch) {
  try {
    return await DaylightAPI(withUser('api/v1/chess/config', userId), patch, 'PUT');
  } catch (error) {
    logger().warn('chess.config.save-error', { error: error.message });
    return null;
  }
}

export default { requestOpponentMove, fetchChessConfig, saveChessConfig };
