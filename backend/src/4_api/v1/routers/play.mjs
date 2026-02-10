// backend/src/4_api/routers/play.mjs
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { nowTs24 } from '#system/utils/index.mjs';
import { parseActionRouteId } from '../utils/actionRouteParser.mjs';
import { resolveFormat } from '../utils/resolveFormat.mjs';
import { MediaProgress } from '#domains/content/entities/MediaProgress.mjs';

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
 * @param {Object} [config.contentQueryService] - ContentQueryService for smart selection
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createPlayRouter(config) {
  const { registry, mediaProgressMemory, contentQueryService, contentIdResolver, logger = console } = config;
  const router = express.Router();

  // MediaProgress domain entity handles isInProgress() and toJSON().

  /**
   * Transform internal item to legacy-compatible response
   */
  function toPlayResponse(item, watchState = null, { adapter } = {}) {
    const response = {
      id: item.id,
      assetId: item.id,
      mediaUrl: item.mediaUrl,
      mediaType: item.mediaType,
      format: resolveFormat(item, adapter),
      title: item.title,
      duration: item.duration,
      resumable: item.resumable ?? false,
      thumbnail: item.thumbnail,
      metadata: item.metadata
    };

    // Add resume position if in progress (use domain entity)
    if (watchState?.playhead > 0 && watchState?.duration > 0) {
      const progress = new MediaProgress(watchState);
      if (progress.isInProgress()) {
        response.resume_position = progress.playhead;
        response.resume_percent = progress.percent;
      }
    }

    // Include type from item for CSS resolution (talk, scripture, etc.)
    if (item.type) response.type = item.type;

    // Set videoUrl when media is video (readalong scrollers check this field)
    if (item.mediaType === 'video' && item.mediaUrl) {
      response.videoUrl = item.mediaUrl;
    }

    // Pass through content/style/subtitle/ambientUrl for readalong/singalong scrollers
    // Content may be on item directly or nested in metadata (adapter-dependent)
    const contentData = item.content || item.metadata?.content;
    if (contentData) response.content = contentData;
    if (item.style || item.metadata?.style) response.style = item.style || item.metadata.style;
    if (item.subtitle || item.metadata?.speaker) response.subtitle = item.subtitle || item.metadata.speaker;
    if (item.ambientUrl) response.ambientUrl = item.ambientUrl;

    // Legacy field mapping for Plex items
    if (item.metadata) {
      if (item.metadata.grandparentTitle) response.grandparentTitle = item.metadata.grandparentTitle;
      if (item.metadata.parentTitle) response.parentTitle = item.metadata.parentTitle;
      if (item.metadata.type === 'episode') response.episode = item.title;
    }

    // Legacy field: expose localId under source key for backward compatibility
    const colonIdx = item.id.indexOf(':');
    if (colonIdx > 0) {
      const sourceKey = item.id.slice(0, colonIdx);
      response[sourceKey] = item.id.slice(colonIdx + 1);
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
   * - type: string (e.g., 'plex', 'media')
   * - assetId: string - Item ID
   * - percent: number - Playback percentage (0-100)
   * - seconds: number - Current playhead position
   * - title: string (optional) - Item title
   * - watched_duration: number (optional) - Duration watched this session
   */
  router.post('/log', asyncHandler(async (req, res) => {
    logger.info?.('play.log.request_received', {
      body: req.body,
      headers: { 'content-type': req.headers['content-type'] }
    });

    const { type, assetId, percent, seconds, title, watched_duration } = req.body;

      // Validate required fields
      if (!type || !assetId || percent === undefined) {
        const missing = !type ? 'type' : !assetId ? 'assetId' : 'percent';
        return res.status(400).json({ error: `Missing required field: ${missing}` });
      }

      if (seconds < 10) {
        return res.status(400).json({ error: 'Invalid request: seconds < 10' });
      }

      // Determine storage path based on type
      let storagePath = type;
      let itemMetadata = null;
      const compoundId = assetId.includes(':') ? assetId : `${type}:${assetId}`;

      // Use adapter (if available) for storage path and metadata enrichment
      const adapter = registry.get(type);
      if (adapter) {
        try {
          if (typeof adapter.getStoragePath === 'function') {
            storagePath = await adapter.getStoragePath(compoundId);
          }
          if (typeof adapter.getItem === 'function') {
            const item = await adapter.getItem(compoundId);
            itemMetadata = item?.metadata;
          }
        } catch (e) {
          logger.warn?.('play.log.metadata_fetch_failed', { assetId, error: e.message });
        }
      }

      // Get existing watch state
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

      // Create updated media progress via domain entity
      const newState = new MediaProgress({
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
        assetId,
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
  }));

  /**
   * GET /api/play/plex/mpd/:id - Get MPD manifest URL for Plex item
   *
   * Returns redirect to DASH MPD manifest through proxy.
   * Query params:
   * - maxVideoBitrate: number (optional) - Maximum video bitrate
   */
  router.get('/plex/mpd/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
      const maxVideoBitrate = parseInt(req.query.maxVideoBitrate, 10);

      const plexAdapter = registry.get('plex');
      if (!plexAdapter) {
        return res.status(503).json({ error: 'Plex adapter not configured' });
      }

      // Get media URL from adapter
      const opts = Number.isFinite(maxVideoBitrate) ? { maxVideoBitrate } : {};
      let mediaUrl;

      if (typeof plexAdapter.getMediaUrl !== 'function') {
        return res.status(501).json({ error: 'Plex adapter does not support media URL retrieval' });
      }
      mediaUrl = await plexAdapter.getMediaUrl(id, 0, opts);

      if (!mediaUrl) {
        return res.status(404).json({ error: 'Media URL not found', id });
      }

      // Redirect through proxy (replace plex host with proxy path)
      const proxyUrl = mediaUrl.replace(/https?:\/\/[^\/]+/, '/api/v1/proxy/plex');
      res.redirect(proxyUrl);
  }));

  // ==========================================================================
  // Wildcard Routes
  // ==========================================================================

  /**
   * GET /api/play/:source/*
   *
   * Supports three ID formats:
   * - Path segments: /play/plex/12345
   * - Compound ID: /play/plex:12345
   * - Heuristic: /play/12345 (bare digits -> plex)
   */
  router.get('/:source/*', asyncHandler(async (req, res) => {
    const { source } = req.params;
      const rawPath = req.params[0] || '';
      const { compoundId, modifiers } = parseActionRouteId({ source, path: rawPath });

      // Resolve content ID through unified resolver (handles all layers:
      // exact source, prefix resolution, system aliases, household aliases)
      const resolved = contentIdResolver.resolve(compoundId);

      if (!resolved?.adapter) {
        return res.status(404).json({ error: `Unknown source: ${source}` });
      }

      const adapter = resolved.adapter;
      const finalSource = resolved.source;
      const finalLocalId = resolved.localId;

      // If shuffle modifier, use resolve with random pick
      if (modifiers.shuffle) {
        let selectedItem;

        if (contentQueryService) {
          const result = await contentQueryService.resolve(finalSource, finalLocalId, { now: new Date() }, { pick: 'random' });

          if (!result.items.length) {
            return res.status(404).json({ error: 'No playable items found' });
          }

          selectedItem = result.items[0];
        } else if (adapter.resolvePlayables) {
          // Fallback: use adapter directly
          const playables = await adapter.resolvePlayables(finalLocalId);
          if (!playables.length) {
            return res.status(404).json({ error: 'No playable items found' });
          }

          selectedItem = playables[Math.floor(Math.random() * playables.length)];
        } else {
          return res.status(404).json({ error: 'No playable items found' });
        }

        const storagePath = typeof adapter.getStoragePath === 'function'
          ? await adapter.getStoragePath(selectedItem.id)
          : finalSource;
        const watchState = mediaProgressMemory ? await mediaProgressMemory.get(selectedItem.id, storagePath) : null;

        return res.json(toPlayResponse(selectedItem, watchState, { adapter }));
      }

      // Get single item using resolver's localId
      const item = await adapter.getItem(finalLocalId);
      if (!item) {
        return res.status(404).json({ error: 'Item not found', source: finalSource, localId: finalLocalId });
      }

      // Check if it's a container (needs resolution to playable)
      if (item.isContainer?.() || item.itemType === 'container') {
        let playables;

        if (contentQueryService) {
          try {
            const result = await contentQueryService.resolve(finalSource, finalLocalId, { now: new Date() });
            playables = result.items;
          } catch {
            // Fallback if contentQueryService can't resolve this source
            playables = adapter.resolvePlayables ? await adapter.resolvePlayables(finalLocalId) : [];
          }
        } else {
          // Fallback: use adapter directly
          playables = adapter.resolvePlayables ? await adapter.resolvePlayables(finalLocalId) : [];
        }

        if (!playables.length) {
          return res.status(404).json({ error: 'No playable items in container' });
        }

        const selectedItem = playables[0];
        const storagePath = typeof adapter.getStoragePath === 'function'
          ? await adapter.getStoragePath(selectedItem.id)
          : finalSource;
        const watchState = mediaProgressMemory ? await mediaProgressMemory.get(selectedItem.id, storagePath) : null;

        return res.json(toPlayResponse(selectedItem, watchState, { adapter }));
      }

      // Return playable item
      const storagePath = typeof adapter.getStoragePath === 'function'
        ? await adapter.getStoragePath(item.id)
        : finalSource;
      const watchState = mediaProgressMemory ? await mediaProgressMemory.get(item.id, storagePath) : null;

      res.json(toPlayResponse(item, watchState, { adapter }));
  }));

  // GET /:source - handles compound IDs like /play/plex:12345 and heuristics like /play/12345
  // Must come after /:source/* so that slashed paths match first
  router.get('/:source', asyncHandler(async (req, res) => {
    const { source } = req.params;
    const { compoundId, modifiers } = parseActionRouteId({ source, path: '' });

    const resolved = contentIdResolver.resolve(compoundId);
    if (!resolved?.adapter) {
      return res.status(404).json({ error: `Unknown source: ${source}` });
    }

    const adapter = resolved.adapter;
    const finalSource = resolved.source;
    const finalLocalId = resolved.localId;

    const item = await adapter.getItem(finalLocalId);
    if (!item) {
      return res.status(404).json({ error: 'Item not found', source: finalSource, localId: finalLocalId });
    }

    // Check if it's a container (needs resolution to playable)
    if (item.isContainer?.() || item.itemType === 'container') {
      let playables;
      if (contentQueryService) {
        try {
          const result = await contentQueryService.resolve(finalSource, finalLocalId, { now: new Date() });
          playables = result.items;
        } catch {
          playables = adapter.resolvePlayables ? await adapter.resolvePlayables(finalLocalId) : [];
        }
      } else {
        playables = adapter.resolvePlayables ? await adapter.resolvePlayables(finalLocalId) : [];
      }

      if (!playables.length) {
        return res.status(404).json({ error: 'No playable items in container' });
      }

      const selectedItem = playables[0];
      const storagePath = typeof adapter.getStoragePath === 'function'
        ? await adapter.getStoragePath(selectedItem.id)
        : finalSource;
      const watchState = mediaProgressMemory ? await mediaProgressMemory.get(selectedItem.id, storagePath) : null;
      return res.json(toPlayResponse(selectedItem, watchState, { adapter }));
    }

    const storagePath = typeof adapter.getStoragePath === 'function'
      ? await adapter.getStoragePath(item.id)
      : finalSource;
    const watchState = mediaProgressMemory ? await mediaProgressMemory.get(item.id, storagePath) : null;
    res.json(toPlayResponse(item, watchState, { adapter }));
  }));

  return router;
}

export default createPlayRouter;
