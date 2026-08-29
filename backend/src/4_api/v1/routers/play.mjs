// backend/src/4_api/routers/play.mjs
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { parseActionRouteId } from '../utils/actionRouteParser.mjs';
import { splatPath } from '#api/utils/wildcard.mjs';
import { presentPublicResources } from '../presenters/publicResourceRefs.mjs';

/**
 * Read the opaque client session off the query string.
 *
 * Opaque on purpose: the frontend's scheme for this value has changed before
 * (it is currently `${singlePlayerKey}#${playerInstanceId}`) and nothing here
 * parses or validates its shape. An empty or non-string value reads as null,
 * which means "the caller minted no session" — a distinct fact from "the
 * caller sent one", and the reason Plex sees a random client per request.
 *
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function readSessionParam(req) {
  const raw = req.query?.session;
  return typeof raw === 'string' && raw !== '' ? raw : null;
}

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
 * @param {Object} config.recordPlaybackProgress - RecordPlaybackProgress use case
 * @param {Object} config.playbackReadService - Semantic playback read facade
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createPlayRouter(config) {
  const { recordPlaybackProgress, playbackReadService, logger = console } = config;
  const router = express.Router();

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

    const { type, assetId, percent, seconds } = req.body;

      // Validate required fields
      if (!type || !assetId || percent === undefined) {
        const missing = !type ? 'type' : !assetId ? 'assetId' : 'percent';
        return res.status(400).json({ error: `Missing required field: ${missing}` });
      }

      if (seconds < 10) {
        return res.status(400).json({ error: 'Invalid request: seconds < 10' });
      }

      res.json(await recordPlaybackProgress.execute(req.body));
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

      const opts = Number.isFinite(maxVideoBitrate) ? { maxVideoBitrate } : {};
      const result = await playbackReadService.getPlexManifest(id, opts);
      if (result.kind === 'unconfigured') {
        return res.status(503).json({ error: 'Plex adapter not configured' });
      }
      if (result.kind === 'unsupported') {
        return res.status(501).json({ error: 'Plex adapter does not support media URL retrieval' });
      }
      if (result.kind === 'not_found') {
        return res.status(404).json({
          error: 'Media URL not found',
          id,
          ...(result.reason ? { reason: result.reason } : {}),
        });
      }
      // Redirect through proxy (replace plex host with proxy path)
      const proxyUrl = result.url.replace(/https?:\/\/[^\/]+/, '/api/v1/proxy/plex');
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
  router.get('/:source/*splat', asyncHandler(async (req, res) => {
    const { source } = req.params;
      const rawPath = splatPath(req);
      const { compoundId, modifiers } = parseActionRouteId({ source, path: rawPath });

      const result = await playbackReadService.resolve({
        compoundId,
        shuffle: modifiers.shuffle,
        resume: req.query.resume === 'false' ? false : undefined,
        session: readSessionParam(req),
        bookmark: req.query.bookmark === 'true',
      });
      if (result.kind === 'unknown_source') {
        logger.warn?.('play.source.unknown', { compoundId, source, rawPath, ip: req.ip });
        return res.status(404).json({ error: `Unknown source: ${source}` });
      }
      if (result.kind === 'item_not_found') {
        logger.warn?.('play.item.not_found', {
          compoundId,
          resolvedSource: result.source,
          resolvedLocalId: result.localId,
          adapterSource: result.adapterSource,
          ip: req.ip
        });
        return res.status(404).json({ error: 'Item not found', source: result.source, localId: result.localId });
      }
      if (result.kind === 'no_playables') return res.status(404).json({ error: 'No playable items found' });
      if (result.kind === 'empty_container') return res.status(404).json({ error: 'No playable items in container' });
      res.json(presentPublicResources(result.body));
  }));

  // GET /:source - handles compound IDs like /play/plex:12345 and heuristics like /play/12345
  // Must come after /:source/* so that slashed paths match first
  router.get('/:source', asyncHandler(async (req, res) => {
    const { source } = req.params;
    const { compoundId, modifiers } = parseActionRouteId({ source, path: '' });

    const result = await playbackReadService.resolve({
      compoundId,
      shuffle: modifiers.shuffle,
      resume: req.query.resume === 'false' ? false : undefined,
      session: readSessionParam(req),
      bookmark: req.query.bookmark === 'true',
    });
    if (result.kind === 'unknown_source') {
      return res.status(404).json({ error: `Unknown source: ${source}` });
    }
    if (result.kind === 'item_not_found') {
      return res.status(404).json({ error: 'Item not found', source: result.source, localId: result.localId });
    }
    if (result.kind === 'no_playables') return res.status(404).json({ error: 'No playable items found' });
    if (result.kind === 'empty_container') return res.status(404).json({ error: 'No playable items in container' });
    res.json(presentPublicResources(result.body));
  }));

  return router;
}

export default createPlayRouter;
