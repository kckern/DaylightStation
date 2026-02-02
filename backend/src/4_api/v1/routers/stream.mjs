// backend/src/4_api/v1/routers/stream.mjs
import express from 'express';
import fs from 'fs';
import path from 'path';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { findMediaFileByPrefix, fileExists } from '#system/utils/FileIO.mjs';

/**
 * MIME types for common media formats
 */
const MIME_TYPES = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska'
};

/**
 * Stream a media file with range request support
 * @param {string} fullPath - Full path to the media file
 * @param {express.Request} req - Express request
 * @param {express.Response} res - Express response
 * @param {Object} [logger] - Logger instance
 */
function streamFile(fullPath, req, res, logger) {
  const stat = fs.statSync(fullPath);
  const ext = path.extname(fullPath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

  const commonHeaders = {
    'Cache-Control': 'public, max-age=31536000',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*'
  };

  // Handle range requests for seeking
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      ...commonHeaders,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': mimeType
    });

    fs.createReadStream(fullPath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      ...commonHeaders,
      'Accept-Ranges': 'bytes',
      'Content-Length': stat.size,
      'Content-Type': mimeType
    });
    fs.createReadStream(fullPath).pipe(res);
  }

  logger?.debug?.('stream.served', { path: fullPath, mimeType });
}

/**
 * Create stream router for local content (singing, narrated)
 *
 * Endpoints:
 * - GET /stream/singing/:collection/:id - Stream singing content (hymns, primary)
 * - GET /stream/narrated/:collection/* - Stream narrated content (scripture, talks, poetry)
 *
 * @param {Object} config
 * @param {string} config.singingMediaPath - Base path for singing media files
 * @param {string} config.narratedMediaPath - Base path for narrated media files
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createStreamRouter(config) {
  const { singingMediaPath, narratedMediaPath, logger = console } = config;
  const router = express.Router();

  /**
   * GET /stream/singing/:collection/:id
   * Stream singing content (hymns, primary songs)
   *
   * Examples:
   * - /stream/singing/hymn/2 → finds 0002-*.mp3
   * - /stream/singing/primary/123 → finds 0123-*.mp3
   */
  router.get('/singing/:collection/:id', asyncHandler(async (req, res) => {
    const { collection, id } = req.params;
    const searchDir = path.join(singingMediaPath, collection);

    // Find media file by prefix (handles 0002-the-spirit-of-god.mp3 format)
    // findMediaFileByPrefix returns full path or null
    const fullPath = findMediaFileByPrefix(searchDir, id);

    if (!fullPath || !fileExists(fullPath)) {
      logger?.warn?.('stream.singing.not_found', { collection, id, searchDir });
      return res.status(404).json({ error: 'Media file not found', collection, id });
    }

    streamFile(fullPath, req, res, logger);
  }));

  /**
   * GET /stream/narrated/:collection/*
   * Stream narrated content (scripture, talks, poetry)
   *
   * Examples:
   * - /stream/narrated/scripture/nt/nirv/26046 → nt/nirv/26046.mp3
   * - /stream/narrated/talks/ldsgc202410/smith → talks/ldsgc202410/smith.mp3
   */
  router.get('/narrated/:collection/*', asyncHandler(async (req, res) => {
    const { collection } = req.params;
    const itemPath = req.params[0] || '';

    if (!itemPath) {
      return res.status(400).json({ error: 'No item path specified' });
    }

    const searchDir = path.join(narratedMediaPath, collection);
    const pathParts = itemPath.split('/');
    const fileName = pathParts.pop();
    const subDir = pathParts.join('/');

    // Build full search path
    const fullSearchDir = subDir ? path.join(searchDir, subDir) : searchDir;

    // Find media file by prefix
    // findMediaFileByPrefix returns full path or null
    const fullPath = findMediaFileByPrefix(fullSearchDir, fileName);

    if (!fullPath || !fileExists(fullPath)) {
      logger?.warn?.('stream.narrated.not_found', { collection, itemPath, fullSearchDir });
      return res.status(404).json({ error: 'Media file not found', collection, itemPath });
    }

    streamFile(fullPath, req, res, logger);
  }));

  /**
   * GET /stream/ambient/:id
   * Stream ambient audio tracks
   */
  router.get('/ambient/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Ambient tracks are in a dedicated ambient directory
    // Adjust path as needed based on actual location
    const ambientDir = path.join(narratedMediaPath, '..', 'ambient');
    // findMediaFileByPrefix returns full path or null
    const fullPath = findMediaFileByPrefix(ambientDir, id);

    if (!fullPath || !fileExists(fullPath)) {
      logger?.warn?.('stream.ambient.not_found', { id, ambientDir });
      return res.status(404).json({ error: 'Ambient track not found', id });
    }

    streamFile(fullPath, req, res, logger);
  }));

  return router;
}

export default createStreamRouter;
