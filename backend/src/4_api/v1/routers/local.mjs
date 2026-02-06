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
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { dirExists, fileExists } from '#system/utils/FileIO.mjs';

const MIME_TYPES = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
};

const VIDEO_EXTS = ['.mp4', '.webm', '.mkv', '.avi', '.mov'];
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

/**
 * Create Local Media API router
 *
 * @param {Object} config
 * @param {Object} config.localMediaAdapter - FileAdapter instance (handles local media browsing)
 * @param {string} config.mediaBasePath - Base path for media files
 * @param {string} config.cacheBasePath - Base path for cache (thumbnails)
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createLocalRouter(config) {
  const { localMediaAdapter, mediaBasePath, cacheBasePath, logger = console } = config;
  const router = express.Router();

  const thumbnailCacheDir = path.join(cacheBasePath, 'thumbnails');

  // Ensure thumbnail cache directory exists
  if (!dirExists(thumbnailCacheDir)) {
    fs.mkdirSync(thumbnailCacheDir, { recursive: true });
  }

  /**
   * GET /local/roots
   * Get configured media roots
   */
  router.get('/roots', asyncHandler(async (req, res) => {
    if (!localMediaAdapter) {
      return res.status(503).json({ error: 'Local media adapter not configured' });
    }

    const roots = await localMediaAdapter.getRoots();
    res.json({ roots });
  }));

  /**
   * GET /local/browse/*
   * Browse folder contents
   */
  router.get('/browse/*', asyncHandler(async (req, res) => {
    if (!localMediaAdapter) {
      return res.status(503).json({ error: 'Local media adapter not configured' });
    }

    const relativePath = decodeURIComponent(req.params[0] || '');
    const items = await localMediaAdapter.getList(relativePath);

    res.json({
      path: relativePath,
      items: Array.isArray(items) ? items : (items?.children || [])
    });
  }));

  /**
   * GET /local/stream/*
   * Stream media file with range request support
   */
  router.get('/stream/*', asyncHandler(async (req, res) => {
    const relativePath = decodeURIComponent(req.params[0] || '');
    if (!relativePath) {
      return res.status(400).json({ error: 'No path specified' });
    }

    // Security: validate path stays within mediaBasePath
    const safePath = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
    const fullPath = path.join(mediaBasePath, safePath);
    const resolvedBase = path.resolve(mediaBasePath);
    const resolvedFull = path.resolve(fullPath);

    if (!resolvedFull.startsWith(resolvedBase)) {
      return res.status(403).json({ error: 'Path traversal not allowed' });
    }

    if (!fileExists(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) {
      return res.status(400).json({ error: 'Path is not a file' });
    }

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

    logger.debug?.('local.stream.served', { path: relativePath, mimeType });
  }));

  /**
   * GET /local/thumbnail/*
   * Get thumbnail for media file (on-demand generation)
   */
  router.get('/thumbnail/*', asyncHandler(async (req, res) => {
    const relativePath = decodeURIComponent(req.params[0] || '');
    if (!relativePath) {
      return res.status(400).json({ error: 'No path specified' });
    }

    // Security: validate path
    const safePath = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
    const fullPath = path.join(mediaBasePath, safePath);
    const resolvedBase = path.resolve(mediaBasePath);
    const resolvedFull = path.resolve(fullPath);

    if (!resolvedFull.startsWith(resolvedBase)) {
      return res.status(403).json({ error: 'Path traversal not allowed' });
    }

    if (!fileExists(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const stat = fs.statSync(fullPath);
    const ext = path.extname(fullPath).toLowerCase();

    // Generate cache key based on path + mtime
    const cacheKey = crypto.createHash('md5').update(`${fullPath}:${stat.mtimeMs}`).digest('hex');
    const thumbnailPath = path.join(thumbnailCacheDir, `${cacheKey}.jpg`);

    // Check if thumbnail exists in cache
    if (fileExists(thumbnailPath)) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      return fs.createReadStream(thumbnailPath).pipe(res);
    }

    // For images, serve original or generate smaller version
    if (IMAGE_EXTS.includes(ext)) {
      // For now, serve original image as thumbnail
      // TODO: Use sharp to resize if available
      const mimeType = MIME_TYPES[ext] || 'image/jpeg';
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      return fs.createReadStream(fullPath).pipe(res);
    }

    // For videos, try to generate thumbnail with ffmpeg
    if (VIDEO_EXTS.includes(ext)) {
      try {
        await generateVideoThumbnail(fullPath, thumbnailPath);
        if (fileExists(thumbnailPath)) {
          res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Cache-Control', 'public, max-age=31536000');
          return fs.createReadStream(thumbnailPath).pipe(res);
        }
      } catch (err) {
        logger.warn?.('local.thumbnail.ffmpeg.failed', { path: relativePath, error: err.message });
      }

      // Fallback: return placeholder
      return res.status(404).json({ error: 'Thumbnail generation failed' });
    }

    return res.status(400).json({ error: 'Unsupported media type for thumbnail' });
  }));

  /**
   * POST /local/reindex
   * Force metadata index rebuild
   */
  router.post('/reindex', asyncHandler(async (req, res) => {
    if (!localMediaAdapter) {
      return res.status(503).json({ error: 'Local media adapter not configured' });
    }

    localMediaAdapter.clearCache();

    // Trigger a scan by calling getRoots and getList for each root
    const roots = await localMediaAdapter.getRoots();
    let totalFiles = 0;

    for (const root of roots) {
      const items = await localMediaAdapter.getList(root.path);
      totalFiles += Array.isArray(items) ? items.length : (items?.children?.length || 0);
    }

    logger.info?.('local.reindex.complete', { roots: roots.length, files: totalFiles });

    res.json({
      message: 'Reindex complete',
      roots: roots.length,
      files: totalFiles
    });
  }));

  /**
   * GET /local/search
   * Search local media files
   */
  router.get('/search', asyncHandler(async (req, res) => {
    if (!localMediaAdapter) {
      return res.status(503).json({ error: 'Local media adapter not configured' });
    }

    const { q, text } = req.query;
    const searchText = q || text || '';

    if (!searchText || searchText.length < 2) {
      return res.status(400).json({ error: 'Search text must be at least 2 characters' });
    }

    const results = await localMediaAdapter.search({ text: searchText });

    res.json({
      query: searchText,
      results,
      count: results.length
    });
  }));

  // Error handler
  router.use((err, req, res, next) => {
    logger.error?.('local.router.error', {
      error: err.message,
      stack: err.stack,
      url: req.url,
      method: req.method
    });
    res.status(500).json({ error: err.message });
  });

  return router;
}

/**
 * Generate video thumbnail using ffmpeg
 * Extracts a frame at 10% of duration
 *
 * @param {string} videoPath - Full path to video file
 * @param {string} outputPath - Full path for output thumbnail
 * @returns {Promise<void>}
 */
function generateVideoThumbnail(videoPath, outputPath) {
  return new Promise((resolve, reject) => {
    // Seek 3 seconds in to skip black intros, then use thumbnail filter
    // to pick the most representative frame from the next 100 frames
    const ffmpeg = spawn('ffmpeg', [
      '-ss', '3',
      '-i', videoPath,
      '-vf', 'thumbnail=100,scale=300:-1',
      '-frames:v', '1',
      '-update', '1',
      '-y',
      outputPath
    ], {
      stdio: ['ignore', 'ignore', 'pipe']
    });

    let stderr = '';
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-200)}`));
      }
    });

    ffmpeg.on('error', (err) => {
      reject(err);
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      ffmpeg.kill();
      reject(new Error('ffmpeg timeout'));
    }, 30000);
  });
}

export default createLocalRouter;
