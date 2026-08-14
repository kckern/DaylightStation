import { DaylightAPI } from '../../../../lib/api.mjs';

const withUser = (path, userId) => userId ? `${path}?user=${encodeURIComponent(userId)}` : path;

/** Unified transport client. Games name their records; the HTTP grammar stays shared. */
export function createPianoGameClient(gameId, { logger = null, moveTimeoutMs = 4000 } = {}) {
  const base = `api/v1/piano-games/${gameId}`;
  async function safe(label, request) {
    try { return await request; } catch (error) {
      logger?.warn?.(`${gameId}.${label}.failed`, { message: error.message });
      return null;
    }
  }
  return {
    readConfig: (userId) => safe('config-read', DaylightAPI(withUser(`${base}/config`, userId))),
    writeConfig: (userId, config) => safe('config-write', DaylightAPI(withUser(`${base}/config`, userId), config, 'PUT')),
    readLadder: (userId) => safe('ladder-read', DaylightAPI(withUser(`${base}/ladder`, userId))),
    async requestMove({ transcript, level, gameSessionId, userId }) {
      let timer;
      const request = safe('move', DaylightAPI(
        withUser(`${base}/move`, userId), { transcript, level, gameId: gameSessionId }, 'POST',
      ));
      const deadline = new Promise((resolve) => {
        timer = setTimeout(() => {
          logger?.warn?.(`${gameId}.move.timeout`, { gameSessionId, timeoutMs: moveTimeoutMs });
          resolve(null);
        }, moveTimeoutMs);
      });
      try { return await Promise.race([request, deadline]); } finally { clearTimeout(timer); }
    },
    saveGame: (userId, record) => safe('record', DaylightAPI(withUser(`${base}/games`, userId), record, 'POST')),
    archiveGame: (record) => safe('archive', DaylightAPI(`${base}/history`, record, 'POST')),
  };
}

export default createPianoGameClient;
