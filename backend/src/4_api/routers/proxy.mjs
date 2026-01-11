// backend/src/api/routers/proxy.mjs
import express from 'express';
import fs from 'fs';

/**
 * Create proxy router for streaming and thumbnails
 * @param {Object} config
 * @param {import('../../domains/content/services/ContentSourceRegistry.mjs').ContentSourceRegistry} config.registry
 * @returns {express.Router}
 */
export function createProxyRouter(config) {
  const router = express.Router();
  const { registry } = config;

  /**
   * GET /proxy/filesystem/stream/*
   * Stream a file from filesystem
   */
  router.get('/filesystem/stream/*', async (req, res) => {
    try {
      const filePath = decodeURIComponent(req.params[0] || '');
      const adapter = registry.get('filesystem');
      if (!adapter) {
        return res.status(404).json({ error: 'Filesystem adapter not configured' });
      }

      const item = await adapter.getItem(filePath);
      if (!item || !item.metadata?.filePath) {
        return res.status(404).json({ error: 'File not found' });
      }

      const fullPath = item.metadata.filePath;
      const stat = fs.statSync(fullPath);
      const mimeType = item.metadata.mimeType || 'application/octet-stream';

      // Handle range requests for video seeking
      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        const chunkSize = end - start + 1;

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': mimeType
        });

        fs.createReadStream(fullPath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': stat.size,
          'Content-Type': mimeType
        });
        fs.createReadStream(fullPath).pipe(res);
      }
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    }
  });

  /**
   * GET /proxy/plex/stream/:ratingKey
   * Redirect to Plex stream (simplified - full transcode support would need more)
   */
  router.get('/plex/stream/:ratingKey', async (req, res) => {
    try {
      const { ratingKey } = req.params;
      const adapter = registry.get('plex');
      if (!adapter) {
        return res.status(404).json({ error: 'Plex adapter not configured' });
      }

      // For now, redirect to Plex direct URL
      // Full transcode support would require session management
      const token = adapter.client?.token || '';
      const plexUrl = `${adapter.host}/library/metadata/${ratingKey}?X-Plex-Token=${token}`;
      res.redirect(plexUrl);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
