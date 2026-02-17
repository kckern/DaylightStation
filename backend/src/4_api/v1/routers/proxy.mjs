// backend/src/4_api/routers/proxy.mjs
import express from 'express';
import fs from 'fs';
import nodePath from 'path';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { compositeHeroImage } from '#system/canvas/compositeHero.mjs';

/**
 * Create proxy router for streaming and thumbnails
 * @param {Object} config
 * @param {import('../../domains/content/services/ContentSourceRegistry.mjs').ContentSourceRegistry} config.registry
 * @param {import('../../0_system/proxy/ProxyService.mjs').ProxyService} [config.proxyService] - Optional proxy service for external services
 * @param {string} [config.mediaBasePath] - Base path for media files
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createProxyRouter(config) {
  const router = express.Router();
  const { registry, proxyService, mediaBasePath, dataPath, logger = console } = config;

  /**
   * GET /proxy/media/stream/*
   * Stream a file from media adapter
   */
  router.get('/media/stream/*', asyncHandler(async (req, res) => {
      const filePath = decodeURIComponent(req.params[0] || '');
      const adapter = registry.get('files') || registry.get('media');
      if (!adapter) {
        return res.status(404).json({ error: 'Media adapter not configured' });
      }

      const item = await adapter.getItem(filePath);
      if (!item || !item.metadata?.filePath) {
        return res.status(404).json({ error: 'File not found' });
      }

      const fullPath = item.metadata.filePath;
      const stat = fs.statSync(fullPath);
      const mimeType = item.metadata.mimeType || 'application/octet-stream';

      // Common headers for caching and security
      const commonHeaders = {
        'Cache-Control': 'public, max-age=31536000',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Access-Control-Allow-Origin': '*'
      };

      // Handle range requests for video seeking
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
          'Content-Length': stat.size,
          'Content-Type': mimeType
        });
        fs.createReadStream(fullPath).pipe(res);
      }
  }));

  /**
   * GET /proxy/plex/stream/:ratingKey
   * Redirect to Plex stream (simplified - full transcode support would need more)
   */
  router.get('/plex/stream/:ratingKey', asyncHandler(async (req, res) => {
    const { ratingKey } = req.params;
    const adapter = registry.get('plex');
    if (!adapter) {
      return res.status(404).json({ error: 'Plex adapter not configured' });
    }

    // Use adapter.loadMediaUrl for proper streaming URL with authentication
    const mediaUrl = await adapter.loadMediaUrl(ratingKey, 0, {});
    if (!mediaUrl) {
      return res.status(404).json({ error: 'Could not generate stream URL', ratingKey });
    }
    res.redirect(mediaUrl);
  }));

  /**
   * GET /proxy/local-content/stream/:type/*
   * Stream audio for LocalContent types (talk, scripture, hymn, primary, poem)
   */
  router.get('/local-content/stream/:type/*', asyncHandler(async (req, res) => {
      const { type } = req.params;
      const path = req.params[0] || '';
      const adapter = registry.get('local-content');

      if (!adapter) {
        return res.status(500).json({ error: 'LocalContent adapter not configured' });
      }

      // Map type to prefix
      const prefixMap = {
        'talk': 'talk',
        'scripture': 'scripture',
        'hymn': 'hymn',
        'primary': 'primary',
        'poem': 'poem'
      };

      const prefix = prefixMap[type];
      if (!prefix) {
        return res.status(400).json({ error: `Unknown content type: ${type}` });
      }

      // Get item to find media file path
      const item = await adapter.getItem(`${prefix}:${path}`);
      if (!item || !item.metadata?.mediaFile) {
        return res.status(404).json({ error: 'Media file not found', type, path });
      }

      // Construct full file path
      const mediaPath = item.metadata.mediaFile;
      const fullPath = nodePath.join(adapter.mediaPath, mediaPath);

      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ error: 'Media file not found on disk', path: fullPath });
      }

      const stat = fs.statSync(fullPath);
      const ext = nodePath.extname(fullPath).toLowerCase();
      const mimeTypes = {
        '.mp3': 'audio/mpeg',
        '.m4a': 'audio/mp4',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mkv': 'video/x-matroska'
      };
      const mimeType = mimeTypes[ext] || 'application/octet-stream';

      // Common headers for caching and security
      const commonHeaders = {
        'Cache-Control': 'public, max-age=31536000',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Access-Control-Allow-Origin': '*'
      };

      // Handle range requests for audio seeking
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
          'Content-Length': stat.size,
          'Content-Type': mimeType
        });
        fs.createReadStream(fullPath).pipe(res);
      }
  }));

  /**
   * GET /proxy/plex/*
   * Passthrough proxy for Plex API requests (thumbnails, transcodes, etc.)
   * Requires ProxyService to be configured for Plex.
   */
  router.use('/plex', async (req, res) => {
    try {
      // Use ProxyService - required for Plex proxying
      if (proxyService?.isConfigured?.('plex')) {
        await proxyService.proxy('plex', req, res);
        return;
      }

      // No fallback - ProxyService is required
      return res.status(503).json({ error: 'Plex proxy not configured (ProxyService required)' });
    } catch (err) {
      console.error('[proxy] plex error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    }
  });

  /**
   * GET /proxy/immich/*
   * Passthrough proxy for Immich API requests (thumbnails, videos, etc.)
   * Uses ProxyService if available, otherwise falls back to direct proxy
   */
  router.use('/immich', async (req, res) => {
    try {
      // Use ProxyService if available
      if (proxyService?.isConfigured?.('immich')) {
        await proxyService.proxy('immich', req, res);
        return;
      }

      // Fallback: direct proxy using adapter credentials
      const adapter = registry.get('immich');
      if (!adapter) {
        return res.status(503).json({ error: 'Immich adapter not configured' });
      }

      const host = adapter.host;
      const apiKey = adapter.apiKey;
      if (!host || !apiKey) {
        return res.status(503).json({ error: 'Immich not configured' });
      }

      // Build target URL - map /assets/{id}/video/playback to Immich API
      let targetPath = req.url;
      // Immich video playback endpoint is /api/assets/{id}/video/playback
      if (!targetPath.startsWith('/api/')) {
        targetPath = '/api' + targetPath;
      }
      const targetUrl = new URL(targetPath, host);

      // Forward headers (except host) and add API key
      const headers = { ...req.headers, 'x-api-key': apiKey };
      delete headers.host;

      const protocol = targetUrl.protocol === 'https:' ? https : http;
      const options = {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
        path: targetUrl.pathname + targetUrl.search,
        method: req.method,
        headers,
        timeout: 60000
      };

      const proxyReq = protocol.request(options, (proxyRes) => {
        if (!res.headersSent) {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
        }
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
        console.error('[proxy] immich error:', err.message);
        if (!res.headersSent) {
          res.status(502).json({ error: 'Immich proxy error', details: err.message });
        }
      });

      proxyReq.on('timeout', () => {
        proxyReq.destroy();
        if (!res.headersSent) {
          res.status(504).json({ error: 'Immich proxy timeout' });
        }
      });

      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        req.pipe(proxyReq);
      } else {
        proxyReq.end();
      }
    } catch (err) {
      console.error('[proxy] immich error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    }
  });

  /**
   * GET /proxy/komga/composite/:bookId/:page
   * Generate a composite 16:9 hero image from Komga book cover + article pages.
   * On-demand generation with disk cache.
   */
  router.get('/komga/composite/:bookId/:page', asyncHandler(async (req, res) => {
    const { bookId, page } = req.params;
    const pageNum = parseInt(page, 10);
    if (!bookId || isNaN(pageNum) || pageNum < 1 || !/^[\w-]+$/.test(bookId)) {
      return res.status(400).json({ error: 'Invalid bookId or page' });
    }

    // Check disk cache
    const cacheDir = dataPath
      ? nodePath.join(dataPath, 'household', 'shared', 'komga', 'hero')
      : null;
    const cacheFile = cacheDir
      ? nodePath.join(cacheDir, `${bookId}-${pageNum}.jpg`)
      : null;

    if (cacheFile && fs.existsSync(cacheFile)) {
      res.set({
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000',
        'X-Cache': 'HIT',
      });
      return fs.createReadStream(cacheFile).pipe(res);
    }

    // Get Komga credentials from ProxyService
    const komgaAdapter = proxyService?.getAdapter?.('komga');
    if (!komgaAdapter?.isConfigured?.()) {
      return res.status(503).json({ error: 'Komga proxy not configured' });
    }

    const baseUrl = komgaAdapter.getBaseUrl();
    const authHeaders = komgaAdapter.getAuthHeaders();

    // Fetch source images in parallel
    const imageUrls = [
      `${baseUrl}/api/v1/books/${bookId}/thumbnail`,    // cover
      `${baseUrl}/api/v1/books/${bookId}/pages/${pageNum}`,  // article page
      `${baseUrl}/api/v1/books/${bookId}/pages/${pageNum + 1}`, // next page
    ];

    const fetchResults = await Promise.allSettled(
      imageUrls.map(async (url) => {
        const resp = await fetch(url, {
          headers: authHeaders,
          signal: AbortSignal.timeout(30000),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return Buffer.from(await resp.arrayBuffer());
      })
    );

    // Collect successful fetches (skip failures gracefully)
    const buffers = fetchResults
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);

    if (buffers.length === 0) {
      return res.status(502).json({ error: 'Failed to fetch any images from Komga' });
    }

    // Composite
    const jpegBuffer = await compositeHeroImage(buffers);

    // Cache to disk
    if (cacheDir) {
      await fs.promises.mkdir(cacheDir, { recursive: true });
      await fs.promises.writeFile(cacheFile, jpegBuffer);
    }

    // Serve
    res.set({
      'Content-Type': 'image/jpeg',
      'Content-Length': jpegBuffer.length,
      'Cache-Control': 'public, max-age=31536000',
      'X-Cache': 'MISS',
    });
    res.send(jpegBuffer);
  }));

  /**
   * GET /proxy/komga/*
   * Passthrough proxy for Komga API requests (page images, thumbnails, etc.)
   * Uses ProxyService with X-API-Key header auth
   */
  router.use('/komga', async (req, res) => {
    try {
      if (proxyService?.isConfigured?.('komga')) {
        await proxyService.proxy('komga', req, res);
        return;
      }
      return res.status(503).json({ error: 'Komga proxy not configured' });
    } catch (err) {
      console.error('[proxy] komga error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    }
  });

  /**
   * GET /proxy/abs/*
   * Passthrough proxy for Audiobookshelf API requests (audio, covers, etc.)
   * Uses ProxyService for streaming with Bearer token auth
   */
  router.use('/abs', async (req, res) => {
    try {
      // Use ProxyService if available
      if (proxyService?.isConfigured?.('audiobookshelf')) {
        await proxyService.proxy('audiobookshelf', req, res);
        return;
      }

      // No fallback for now - ABS requires ProxyService
      return res.status(503).json({ error: 'Audiobookshelf proxy not configured' });
    } catch (err) {
      console.error('[proxy] audiobookshelf error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    }
  });

  /**
   * GET /proxy/media/*
   * Stream audio/video files from the media mount
   * Replaces legacy /media/* endpoint for ambient music, poetry, etc.
   */
  router.get('/media/*', asyncHandler(async (req, res) => {
      if (!mediaBasePath) {
        return res.status(503).json({ error: 'Media path not configured' });
      }

      const relativePath = decodeURIComponent(req.params[0] || '');
      if (!relativePath) {
        return res.status(400).json({ error: 'No path specified' });
      }

      // Security: prevent path traversal
      const safePath = nodePath.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
      const fullPath = nodePath.join(mediaBasePath, safePath);

      // Ensure we're still within mediaBasePath
      if (!fullPath.startsWith(nodePath.resolve(mediaBasePath))) {
        return res.status(403).json({ error: 'Path traversal not allowed' });
      }

      // Try with common audio extensions if no extension provided
      let resolvedPath = fullPath;
      if (!fs.existsSync(resolvedPath)) {
        const extensions = ['mp3', 'm4a', 'mp4', 'wav', 'ogg', 'flac'];
        for (const ext of extensions) {
          const withExt = `${fullPath}.${ext}`;
          if (fs.existsSync(withExt)) {
            resolvedPath = withExt;
            break;
          }
        }
      }

      if (!fs.existsSync(resolvedPath)) {
        return res.status(404).json({ error: 'Media file not found', path: relativePath });
      }

      const stat = fs.statSync(resolvedPath);
      if (!stat.isFile()) {
        return res.status(400).json({ error: 'Path is not a file' });
      }

      const ext = nodePath.extname(resolvedPath).toLowerCase().slice(1);
      const mimeTypes = {
        'mp3': 'audio/mpeg',
        'm4a': 'audio/mp4',
        'mp4': 'video/mp4',
        'wav': 'audio/wav',
        'ogg': 'audio/ogg',
        'flac': 'audio/flac',
        'webm': 'video/webm'
      };
      const mimeType = mimeTypes[ext] || 'application/octet-stream';

      const commonHeaders = {
        'Cache-Control': 'public, max-age=31536000',
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': '*'
      };

      // Handle range requests for audio seeking
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

        fs.createReadStream(resolvedPath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          ...commonHeaders,
          'Accept-Ranges': 'bytes',
          'Content-Length': stat.size,
          'Content-Type': mimeType
        });
        fs.createReadStream(resolvedPath).pipe(res);
      }

      logger.debug?.('proxy.media.served', { path: relativePath, mimeType });
  }));

  return router;
}

export default createProxyRouter;
