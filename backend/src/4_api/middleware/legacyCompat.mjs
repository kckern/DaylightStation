// backend/src/4_api/middleware/legacyCompat.mjs

/**
 * Map legacy type to new source name
 */
const TYPE_TO_SOURCE = {
  plex: 'plex',
  talk: 'local-content',
  scripture: 'local-content',
  hymn: 'local-content',
  audio: 'filesystem',
  video: 'filesystem'
};

/**
 * Map legacy type to compound ID prefix
 */
const TYPE_TO_PREFIX = {
  plex: 'plex',
  talk: 'talk',
  scripture: 'scripture',
  hymn: 'hymn',
  audio: 'filesystem',
  video: 'filesystem'
};

/**
 * Translate legacy POST /media/log body to new format
 * @param {Object} body - Legacy request body
 * @returns {Object} New format { source, itemId, playhead, duration }
 */
export function translateMediaLogRequest(body) {
  const { type, library, playhead, mediaDuration } = body;

  const source = TYPE_TO_SOURCE[type] || 'filesystem';
  const prefix = TYPE_TO_PREFIX[type] || 'filesystem';
  const itemId = `${prefix}:${library}`;

  return {
    source,
    itemId,
    playhead: playhead || 0,
    duration: mediaDuration || 0
  };
}

/**
 * Translate new response to legacy format
 * @param {Object} response - New format response
 * @param {string} legacyType - Original legacy type
 * @returns {Object} Legacy format
 */
export function translateMediaLogResponse(response, legacyType) {
  const localId = response.itemId.includes(':')
    ? response.itemId.split(':').slice(1).join(':')
    : response.itemId;

  return {
    type: legacyType,
    library: localId,
    playhead: response.playhead,
    mediaDuration: response.duration,
    watchProgress: response.percent
  };
}

/**
 * Express middleware that wraps legacy /media/log endpoint
 * @param {Object} watchStore - YamlWatchStateStore instance
 */
export function legacyMediaLogMiddleware(watchStore) {
  return async (req, res, next) => {
    try {
      const translated = translateMediaLogRequest(req.body);
      const { WatchState } = await import('../../1_domains/content/entities/WatchState.mjs');

      const state = new WatchState({
        itemId: translated.itemId,
        playhead: translated.playhead,
        duration: translated.duration,
        lastPlayed: new Date().toISOString()
      });

      const storagePath = req.body.type || 'default';
      await watchStore.set(state, storagePath);

      const legacyResponse = translateMediaLogResponse(state.toJSON(), req.body.type);
      res.json(legacyResponse);
    } catch (err) {
      next(err);
    }
  };
}
