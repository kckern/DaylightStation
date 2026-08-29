// backend/src/4_api/v1/routers/stream.mjs
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { streamMediaResourceWithRanges } from '#system/http/index.mjs';
import { splatPath } from '#api/utils/wildcard.mjs';

const MEDIA_HEADERS = {
  'Cache-Control': 'public, max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'Access-Control-Allow-Origin': '*',
};

function logNotFound(logger, event, payload) {
  if (logger?.error) logger.error(event, payload);
  else if (logger?.warn) logger.warn(event, payload);
  else console.error(event, payload);
}

/**
 * Create stream router for local content (singalong, readalong)
 *
 * Endpoints:
 * - GET /stream/singalong/:collection/:id - Stream singalong content (hymns, primary)
 * - GET /stream/readalong/:collection/* - Stream readalong content (scripture, talks, poetry)
 *
 * @param {Object} config
 * @param {Object} config.getContentMediaResource - Application operation
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createStreamRouter(config) {
  const { getContentMediaResource, logger = console } = config;
  const router = express.Router();

  /**
  * GET /stream/singalong/:collection/:id
  * Stream singalong content (hymns, primary songs)
   *
   * Examples:
   * - /stream/singalong/hymn/2 → finds 0002-*.mp3
   * - /stream/singalong/primary/123 → finds 0123-*.mp3
   */
  router.get('/singalong/:collection/:id', asyncHandler(async (req, res) => {
    const { collection, id } = req.params;
    const result = await getContentMediaResource.execute({ type: 'singalong', collection, id });
    if (result.kind === 'not_found') {
      logNotFound(logger, 'stream.singalong.not_found', { collection, id });
      return res.status(404).json({ error: 'Media file not found', collection, id });
    }

    streamMediaResourceWithRanges(req, res, result.resource, MEDIA_HEADERS);
    logger?.debug?.('stream.served', { collection, id, mimeType: result.resource.mimeType });
  }));

  /**
  * GET /stream/readalong/:collection/*
  * Stream readalong content (scripture, talks, poetry)
   *
   * Examples:
   * - /stream/readalong/scripture/nt/nirv/26046 → nt/nirv/26046.mp3
   * - /stream/readalong/talks/ldsgc202410/smith → talks/ldsgc202410/smith.mp4
   */
  router.get('/readalong/:collection{/*splat}', asyncHandler(async (req, res) => {
    const { collection } = req.params;
    const rawItemPath = splatPath(req);

    const result = await getContentMediaResource.execute({
      type: 'readalong',
      collection,
      itemPath: rawItemPath,
    });
    if (result.kind === 'invalid_path') {
      return res.status(400).json({ error: 'No item path specified' });
    }
    if (result.kind === 'forbidden') {
      return res.status(403).json({ error: 'Path traversal not allowed' });
    }
    if (result.kind === 'not_found') {
      logNotFound(logger, 'stream.readalong.not_found', { collection, itemPath: rawItemPath });
      return res.status(404).json({ error: 'Media file not found', collection, itemPath: rawItemPath });
    }

    streamMediaResourceWithRanges(req, res, result.resource, MEDIA_HEADERS);
    logger?.debug?.('stream.served', {
      collection,
      itemPath: rawItemPath,
      mimeType: result.resource.mimeType,
    });
  }));

  /**
   * GET /stream/ambient/:id
   * Stream ambient audio tracks
   */
  router.get('/ambient/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await getContentMediaResource.execute({ type: 'ambient', id });
    if (result.kind === 'not_found') {
      logNotFound(logger, 'stream.ambient.not_found', { id });
      return res.status(404).json({ error: 'Ambient track not found', id });
    }

    streamMediaResourceWithRanges(req, res, result.resource, MEDIA_HEADERS);
    logger?.debug?.('stream.served', { id, mimeType: result.resource.mimeType });
  }));

  return router;
}

export default createStreamRouter;
