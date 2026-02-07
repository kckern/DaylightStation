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
 * Create stream router for local content (singalong, readalong)
 *
 * Endpoints:
 * - GET /stream/singalong/:collection/:id - Stream singalong content (hymns, primary)
 * - GET /stream/readalong/:collection/* - Stream readalong content (scripture, talks, poetry)
 *
 * @param {Object} config
 * @param {string} config.singalongMediaPath - Base path for singalong media files
 * @param {string} config.readalongAudioPath - Base path for readalong audio files
 * @param {string} config.readalongVideoPath - Base path for readalong video files
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createStreamRouter(config) {
  const { singalongMediaPath, readalongAudioPath, readalongVideoPath, logger = console } = config;
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
    const searchDirs = collection === 'hymn'
      ? [path.join(singalongMediaPath, collection, '_ldsgc'), path.join(singalongMediaPath, collection)]
      : [path.join(singalongMediaPath, collection)];

    // Find media file by prefix (handles 0002-the-spirit-of-god.mp3 format)
    // findMediaFileByPrefix returns full path or null
    let fullPath = null;
    let searchDir = null;
    for (const dir of searchDirs) {
      searchDir = dir;
      fullPath = findMediaFileByPrefix(dir, id);
      if (fullPath) break;
    }

    if (!fullPath || !fileExists(fullPath)) {
      const payload = { collection, id, searchDir };
      if (logger?.error) {
        logger.error('stream.singalong.not_found', payload);
      } else if (logger?.warn) {
        logger.warn('stream.singalong.not_found', payload);
      } else {
        console.error('stream.singalong.not_found', payload);
      }
      return res.status(404).json({ error: 'Media file not found', collection, id });
    }

    streamFile(fullPath, req, res, logger);
  }));

  /**
  * GET /stream/readalong/:collection/*
  * Stream readalong content (scripture, talks, poetry)
   *
   * Examples:
   * - /stream/readalong/scripture/nt/nirv/26046 → nt/nirv/26046.mp3
   * - /stream/readalong/talks/ldsgc202410/smith → talks/ldsgc202410/smith.mp4
   */
  router.get('/readalong/:collection/*', asyncHandler(async (req, res) => {
    const { collection } = req.params;
    const itemPath = req.params[0] || '';

    if (!itemPath) {
      return res.status(400).json({ error: 'No item path specified' });
    }

    const readalongBasePath = collection === 'talks'
      ? readalongVideoPath
      : readalongAudioPath;
    const searchDir = path.join(readalongBasePath, collection);
    const pathParts = itemPath.split('/');
    const fileName = pathParts.pop();
    const subDir = pathParts.join('/');

    // Build full search path
    const fullSearchDir = subDir ? path.join(searchDir, subDir) : searchDir;

    // Find media file by prefix
    // findMediaFileByPrefix returns full path or null
    const fullPath = findMediaFileByPrefix(fullSearchDir, fileName);

    if (!fullPath || !fileExists(fullPath)) {
      const payload = { collection, itemPath, fullSearchDir };
      if (logger?.error) {
        logger.error('stream.readalong.not_found', payload);
      } else if (logger?.warn) {
        logger.warn('stream.readalong.not_found', payload);
      } else {
        console.error('stream.readalong.not_found', payload);
      }
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
    const ambientDir = path.join(readalongAudioPath, '..', 'ambient');
    // findMediaFileByPrefix returns full path or null
    const fullPath = findMediaFileByPrefix(ambientDir, id);

    if (!fullPath || !fileExists(fullPath)) {
      const payload = { id, ambientDir };
      if (logger?.error) {
        logger.error('stream.ambient.not_found', payload);
      } else if (logger?.warn) {
        logger.warn('stream.ambient.not_found', payload);
      } else {
        console.error('stream.ambient.not_found', payload);
      }
      return res.status(404).json({ error: 'Ambient track not found', id });
    }

    streamFile(fullPath, req, res, logger);
  }));

  return router;
}

export default createStreamRouter;
