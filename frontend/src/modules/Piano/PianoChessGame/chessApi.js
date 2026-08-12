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

/** Resolves null on any failure: the caller falls back to the local engine. */
export async function requestOpponentMove({ fen, rung, gameId, userId = null }) {
  try {
    const body = await DaylightAPI(withUser('api/v1/chess/move', userId), { fen, rung, gameId }, 'POST');
    return body && body.from ? body : null;
  } catch (error) {
    logger().warn('chess.move.request-error', { error: error.message });
    return null;
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
