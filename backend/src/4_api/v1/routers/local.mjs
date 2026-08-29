/**
 * Local Media API Router
 *
 * Provides REST API for browsing and streaming local media files.
 *
 * Endpoints:
 * - GET /local/roots - Get configured media roots
 * - GET /local/browse/* - Browse folder contents
 * - GET /local/stream/* - Stream media file
 * - GET /local/thumbnail/* - Get thumbnail (on-demand generation)
 * - POST /local/reindex - Force metadata index rebuild
 *
 * @module api/routers/local
 */

import express from 'express';
import { asyncHandler, errorHandlerMiddleware } from '#system/http/middleware/index.mjs';
import { streamMediaResourceWithRanges } from '#system/http/index.mjs';
import { splatPath } from '#api/utils/wildcard.mjs';

const MEDIA_HEADERS = {
  'Cache-Control': 'public, max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'Access-Control-Allow-Origin': '*',
};

/**
 * Create Local Media API router
 *
 * @param {Object} config
 * @param {Object} config.localMediaCatalog - Semantic local-media catalog service
 * @param {Object} config.getLocalMediaResource - Application operation
 * @param {Object} config.getLocalMediaThumbnail - Application operation
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createLocalRouter(config) {
  const {
    localMediaCatalog,
    getLocalMediaResource,
    getLocalMediaThumbnail,
    logger = console,
  } = config;
  const router = express.Router();

  /**
   * GET /local/roots
   * Get configured media roots
   */
  router.get('/roots', asyncHandler(async (req, res) => {
    const outcome = await localMediaCatalog.roots();
    if (outcome.kind === 'unavailable') {
      return res.status(503).json({ error: 'Local media adapter not configured' });
    }

    res.json({ roots: outcome.value });
  }));

  /**
   * GET /local/browse/*
   * Browse folder contents
   */
  router.get('/browse{/*splat}', asyncHandler(async (req, res) => {
    const relativePath = splatPath(req);
    const outcome = await localMediaCatalog.browse(relativePath);
    if (outcome.kind === 'unavailable') {
      return res.status(503).json({ error: 'Local media adapter not configured' });
    }

    // Params arrive pre-decoded (Express 4 did too — the old decodeURIComponent
    // here was double-decoding). See splatPath docstring.
    const items = outcome.value;

    res.json({
      path: relativePath,
      items: Array.isArray(items) ? items : (items?.children || [])
    });
  }));

  /**
   * GET /local/stream/*
   * Stream media file with range request support
   */
  router.get('/stream{/*splat}', asyncHandler(async (req, res) => {
    // Params arrive pre-decoded (the old decodeURIComponent was double-decoding);
    // see splatPath docstring.
    const relativePath = splatPath(req);
    if (!relativePath) {
      return res.status(400).json({ error: 'No path specified' });
    }

    const result = await getLocalMediaResource.execute(relativePath);
    if (result.kind === 'forbidden') {
      return res.status(403).json({ error: 'Path traversal not allowed' });
    }
    if (result.kind === 'not_found') {
      return res.status(404).json({ error: 'File not found' });
    }
    if (result.kind === 'not_file') {
      return res.status(400).json({ error: 'Path is not a file' });
    }

    streamMediaResourceWithRanges(req, res, result.resource, MEDIA_HEADERS);
    logger.debug?.('local.stream.served', {
      path: relativePath,
      mimeType: result.resource.mimeType,
    });
  }));

  /**
   * GET /local/thumbnail/*
   * Get thumbnail for media file (on-demand generation)
   */
  router.get('/thumbnail{/*splat}', asyncHandler(async (req, res) => {
    // Params arrive pre-decoded (the old decodeURIComponent was double-decoding);
    // see splatPath docstring.
    const relativePath = splatPath(req);
    if (!relativePath) {
      return res.status(400).json({ error: 'No path specified' });
    }

    const result = await getLocalMediaThumbnail.execute(relativePath);
    if (result.kind === 'forbidden') {
      return res.status(403).json({ error: 'Path traversal not allowed' });
    }
    if (result.kind === 'not_found') {
      return res.status(404).json({ error: 'File not found' });
    }
    if (result.kind === 'generation_failed') {
      return res.status(404).json({ error: 'Thumbnail generation failed' });
    }
    if (result.kind === 'unsupported') {
      return res.status(400).json({ error: 'Unsupported media type for thumbnail' });
    }

    res.setHeader('Content-Type', result.resource.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    return result.resource.open().pipe(res);
  }));

  /**
   * POST /local/reindex
   * Force metadata index rebuild
   */
  router.post('/reindex', asyncHandler(async (req, res) => {
    const outcome = await localMediaCatalog.reindex();
    if (outcome.kind === 'unavailable') {
      return res.status(503).json({ error: 'Local media adapter not configured' });
    }

    const totalFiles = outcome.files;

    logger.info?.('local.reindex.complete', { roots: outcome.roots, files: totalFiles });

    res.json({
      message: 'Reindex complete',
      roots: outcome.roots,
      files: totalFiles
    });
  }));

  /**
   * GET /local/search
   * Search local media files
   */
  router.get('/search', asyncHandler(async (req, res) => {
    if (!localMediaCatalog || localMediaCatalog.available === false) {
      return res.status(503).json({ error: 'Local media adapter not configured' });
    }

    const { q, text } = req.query;
    const searchText = q || text || '';

    if (!searchText || searchText.length < 2) {
      return res.status(400).json({ error: 'Search text must be at least 2 characters' });
    }

    const outcome = await localMediaCatalog.search(searchText);
    if (outcome.kind === 'unavailable') return res.status(503).json({ error: 'Local media adapter not configured' });
    const results = outcome.value;

    res.json({
      query: searchText,
      results,
      count: results.length
    });
  }));

  // Error handler: maps by name/status, hides internals on 5xx, logs real error.
  router.use(errorHandlerMiddleware({ shape: 'string' }));

  return router;
}

export default createLocalRouter;
