// backend/src/4_api/routers/play.mjs
import express from 'express';
import { nowTs24 } from '#system/utils/index.mjs';

/**
 * Create play API router for retrieving playable media info
 *
 * Endpoints:
 * - GET /api/play/:source/(path) - Get playable item info
 * - GET /api/play/:source/(path)/shuffle - Get random item from container
 * - POST /api/play/log - Log media playback progress
 * - GET /api/play/plex/mpd/:id - Get MPD manifest URL for Plex item
 *
 * @param {Object} config
 * @param {Object} config.registry - ContentSourceRegistry
 * @param {Object} config.mediaProgressMemory - MediaProgressMemory
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createPlayRouter(config) {
  const { registry, mediaProgressMemory, logger = console } = config;
  const router = express.Router();

  /**
   * Check if watch state is in progress (started but not finished)
   * @param {Object} state - Plain watch state object
   * @returns {boolean}
   */
  function isInProgress(state) {
    if (!state || !state.playhead || !state.duration) return false;
    const percent = Math.round((state.playhead / state.duration) * 100);
    return state.playhead > 0 && percent < 90;
  }

  /**
   * Create media progress object with toJSON method for datastore compatibility
   * @param {Object} props - Media progress properties
   * @returns {Object}
   */
  function createMediaProgressDTO(props) {
    const { itemId, playhead = 0, duration = 0, percent, playCount = 0, lastPlayed = null, watchTime = 0 } = props;
    return {
      itemId,
      playhead,
      duration,
      percent,
      playCount,
      lastPlayed,
      watchTime,
      toJSON() {
        return {
          itemId: this.itemId,
          playhead: this.playhead,
          duration: this.duration,
          percent: this.percent,
          playCount: this.playCount,
          lastPlayed: this.lastPlayed,
          watchTime: this.watchTime
        };
      }
    };
  }

  /**
   * Parse path modifiers (shuffle, etc.)
   */
  function parseModifiers(pathParts) {
    const modifiers = { shuffle: false };
    const cleanParts = [];

    for (const part of pathParts) {
      if (part === 'shuffle') {
        modifiers.shuffle = true;
      } else if (part.includes(',')) {
        const mods = part.split(',');
        for (const mod of mods) {
          if (mod === 'shuffle') modifiers.shuffle = true;
        }
      } else {
        cleanParts.push(part);
      }
    }

    return { modifiers, localId: cleanParts.join('/') };
  }

  /**
   * Transform internal item to legacy-compatible response
   */
  function toPlayResponse(item, watchState = null) {
    const response = {
      id: item.id,
      media_key: item.id,
      media_url: item.mediaUrl,
      media_type: item.mediaType,
      title: item.title,
      duration: item.duration,
      resumable: item.resumable ?? false,
      thumbnail: item.thumbnail,
      metadata: item.metadata
    };

    // Add resume position if in progress
    if (isInProgress(watchState)) {
      response.resume_position = watchState.playhead;
      response.resume_percent = watchState.percent;
    }

    // Legacy field mapping for Plex items
    if (item.metadata) {
      if (item.metadata.grandparentTitle) response.show = item.metadata.grandparentTitle;
      if (item.metadata.parentTitle) response.season = item.metadata.parentTitle;
      if (item.metadata.type === 'episode') response.episode = item.title;
    }

    // Legacy field for source identification
    if (item.id.startsWith('plex:')) {
      response.plex = item.id.replace('plex:', '');
    }

    return response;
  }

  // ==========================================================================
  // Specific Routes (must come before wildcard route)
  // ==========================================================================

  /**
   * POST /api/play/log - Log media playback progress
   *
   * Updates watch state for an item. Replaces legacy /media/log endpoint.
   *
   * Body:
   * - type: string (e.g., 'plex', 'filesystem')
   * - media_key: string - Item ID
   * - percent: number - Playback percentage (0-100)
   * - seconds: number - Current playhead position
   * - title: string (optional) - Item title
   * - watched_duration: number (optional) - Duration watched this session
   */
  router.post('/log', async (req, res) => {
    logger.info?.('play.log.request_received', {
      body: req.body,
      headers: { 'content-type': req.headers['content-type'] }
    });

    try {
      const { type, media_key, percent, seconds, title, watched_duration } = req.body;

      // Validate required fields
      if (!type || !media_key || percent === undefined) {
        const missing = !type ? 'type' : !media_key ? 'media_key' : 'percent';
        return res.status(400).json({ error: `Missing required field: ${missing}` });
      }

      if (seconds < 10) {
        return res.status(400).json({ error: 'Invalid request: seconds < 10' });
      }

      // Determine storage path based on type
      let storagePath = type;
      let itemMetadata = null;

      // For plex items, get metadata to determine library
      if (type === 'plex') {
        const plexAdapter = registry.get('plex');
        if (plexAdapter && typeof plexAdapter.getItem === 'function') {
          try {
            const item = await plexAdapter.getItem(`plex:${media_key}`);
            if (item?.metadata?.librarySectionID) {
              const libraryId = item.metadata.librarySectionID;
              const libraryName = (item.metadata.librarySectionTitle || 'media')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '');
              storagePath = `plex/${libraryId}_${libraryName}`;
              itemMetadata = item.metadata;
            }
          } catch (e) {
            logger.warn?.('play.log.metadata_fetch_failed', { media_key, error: e.message });
          }
        }
      }

      // Get existing watch state
      const compoundId = type === 'plex' ? `plex:${media_key}` : media_key;
      const existingState = mediaProgressMemory ? await mediaProgressMemory.get(compoundId, storagePath) : null;

      // Calculate duration from percent if not in metadata
      const normalizedSeconds = parseInt(seconds, 10);
      const normalizedPercent = parseFloat(percent);
      const estimatedDuration = normalizedPercent > 0
        ? Math.round(normalizedSeconds / (normalizedPercent / 100))
        : (itemMetadata?.duration ? Math.round(itemMetadata.duration / 1000) : 0);

      // Calculate watch time accumulation
      const sessionWatchTime = Number.isFinite(watched_duration) ? parseFloat(watched_duration) : 0;
      const existingWatchTime = existingState?.watchTime ?? 0;
      const newWatchTime = existingWatchTime + sessionWatchTime;

      // Calculate final percent for state object
      const statePercent = estimatedDuration > 0
        ? Math.round((normalizedSeconds / estimatedDuration) * 100)
        : 0;

      // Create updated media progress DTO
      const newState = createMediaProgressDTO({
        itemId: compoundId,
        playhead: normalizedSeconds,
        duration: estimatedDuration,
        percent: statePercent,
        playCount: (existingState?.playCount ?? 0) + 1,
        lastPlayed: nowTs24(),
        watchTime: newWatchTime > 0 ? Number(newWatchTime.toFixed(3)) : 0
      });

      // Persist state
      if (mediaProgressMemory) {
        await mediaProgressMemory.set(newState, storagePath);
      }

      logger.info?.('play.log.updated', {
        media_key,
        type,
        percent: normalizedPercent,
        playhead: normalizedSeconds,
        storagePath
      });

      res.json({
        response: {
          type,
          library: storagePath,
          title: itemMetadata?.title || title,
          ...newState
        }
      });
    } catch (error) {
      logger.error?.('play.log.error', { error: error.message });
      res.status(500).json({ error: 'Failed to process log' });
    }
  });

  /**
   * GET /api/play/plex/mpd/:id - Get MPD manifest URL for Plex item
   *
   * Returns redirect to DASH MPD manifest through proxy.
   * Query params:
   * - maxVideoBitrate: number (optional) - Maximum video bitrate
   */
  router.get('/plex/mpd/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const maxVideoBitrate = parseInt(req.query.maxVideoBitrate, 10);

      const plexAdapter = registry.get('plex');
      if (!plexAdapter) {
        return res.status(503).json({ error: 'Plex adapter not configured' });
      }

      // Get media URL from adapter
      const opts = Number.isFinite(maxVideoBitrate) ? { maxVideoBitrate } : {};
      let mediaUrl;

      if (typeof plexAdapter.getMediaUrl === 'function') {
        mediaUrl = await plexAdapter.getMediaUrl(id, 0, opts);
      } else if (typeof plexAdapter.loadMediaUrl === 'function') {
        mediaUrl = await plexAdapter.loadMediaUrl(id, 0, opts);
      } else {
        return res.status(501).json({ error: 'Plex adapter does not support media URL retrieval' });
      }

      if (!mediaUrl) {
        return res.status(404).json({ error: 'Media URL not found', id });
      }

      // Redirect through proxy (replace plex host with proxy path)
      const proxyUrl = mediaUrl.replace(/https?:\/\/[^\/]+/, '/api/v1/proxy/plex');
      res.redirect(proxyUrl);
    } catch (error) {
      logger.error?.('play.plex.mpd.error', { id: req.params.id, error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // ==========================================================================
  // Wildcard Routes
  // ==========================================================================

  /**
   * GET /api/play/:source/*
   */
  router.get('/:source/*', async (req, res) => {
    try {
      const { source } = req.params;
      const rawPath = req.params[0] || '';
      const { modifiers, localId } = parseModifiers(rawPath.split('/'));

      const adapter = registry.get(source);
      if (!adapter) {
        return res.status(404).json({ error: `Unknown source: ${source}` });
      }

      // If shuffle modifier, resolve to playables and return random one
      if (modifiers.shuffle && adapter.resolvePlayables) {
        const playables = await adapter.resolvePlayables(localId);
        if (!playables.length) {
          return res.status(404).json({ error: 'No playable items found' });
        }

        const randomItem = playables[Math.floor(Math.random() * playables.length)];
        const storagePath = typeof adapter.getStoragePath === 'function'
          ? await adapter.getStoragePath(randomItem.id)
          : source;
        const watchState = mediaProgressMemory ? await mediaProgressMemory.get(randomItem.id, storagePath) : null;

        return res.json(toPlayResponse(randomItem, watchState));
      }

      // Get single item
      const compoundId = `${source}:${localId}`;
      const item = await adapter.getItem(compoundId);
      if (!item) {
        return res.status(404).json({ error: 'Item not found', source, localId });
      }

      // Check if it's a container (needs resolution to playable)
      if (item.isContainer?.() || item.itemType === 'container') {
        const playables = await adapter.resolvePlayables(compoundId);
        if (!playables.length) {
          return res.status(404).json({ error: 'No playable items in container' });
        }

        const firstPlayable = playables[0];
        const storagePath = typeof adapter.getStoragePath === 'function'
          ? await adapter.getStoragePath(firstPlayable.id)
          : source;
        const watchState = mediaProgressMemory ? await mediaProgressMemory.get(firstPlayable.id, storagePath) : null;

        return res.json(toPlayResponse(firstPlayable, watchState));
      }

      // Return playable item
      const storagePath = typeof adapter.getStoragePath === 'function'
        ? await adapter.getStoragePath(item.id)
        : source;
      const watchState = mediaProgressMemory ? await mediaProgressMemory.get(item.id, storagePath) : null;

      res.json(toPlayResponse(item, watchState));
    } catch (err) {
      console.error('[play] Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

export default createPlayRouter;
