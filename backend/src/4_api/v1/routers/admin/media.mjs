/**
 * Admin Media Router
 *
 * Admin endpoints for media management operations.
 *
 * Endpoints:
 * - POST /freshvideo/:provider/metadata - Fetch and save channel metadata
 * - GET  /freshvideo/sources - List configured freshvideo sources
 */
import express from 'express';
import path from 'path';
import fs from 'fs';
import { YtDlpAdapter } from '#adapters/media/YtDlpAdapter.mjs';
import { loadYamlSafe, saveYaml, ensureDir } from '#system/utils/FileIO.mjs';

/**
 * Create Admin Media Router
 *
 * @param {Object} config
 * @param {string} config.mediaPath - Base path for media storage
 * @param {Function} config.loadFile - Function to load config files
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createAdminMediaRouter(config) {
  const { mediaPath, loadFile, logger = console } = config;
  const router = express.Router();

  // Create YtDlpAdapter for metadata fetching
  const ytDlpAdapter = new YtDlpAdapter({ logger });

  /**
   * GET /freshvideo/sources - List configured freshvideo sources
   */
  router.get('/freshvideo/sources', async (req, res) => {
    try {
      const sources = await loadFile('state/youtube');
      if (!sources || !Array.isArray(sources)) {
        return res.json({ sources: [], count: 0 });
      }

      // Transform to API format
      const formattedSources = sources.map(source => ({
        provider: source.shortcode,
        description: source.description,
        type: source.type?.toLowerCase() === 'channel' ? 'channel' : 'playlist',
        id: source.playlist,
        folder: source.folder
      }));

      res.json({
        sources: formattedSources,
        count: formattedSources.length
      });
    } catch (error) {
      logger.error?.('admin.media.sources.error', { error: error.message });
      res.status(500).json({ error: 'Failed to load sources' });
    }
  });

  /**
   * POST /freshvideo/:provider/metadata - Fetch and save channel metadata
   */
  router.post('/freshvideo/:provider/metadata', async (req, res) => {
    const { provider } = req.params;

    try {
      // Load source config
      const sources = await loadFile('state/youtube');
      if (!sources || !Array.isArray(sources)) {
        return res.status(404).json({ error: 'No freshvideo sources configured' });
      }

      // Find the source by shortcode
      const source = sources.find(s => s.shortcode === provider);
      if (!source) {
        return res.status(404).json({ error: `Source not found: ${provider}` });
      }

      // Transform to adapter format
      const adapterSource = {
        provider: source.shortcode,
        src: 'youtube',
        type: source.type?.toLowerCase() === 'channel' ? 'channel' : 'playlist',
        id: source.playlist
      };

      // Determine provider directory
      const providerDir = path.join(mediaPath, 'video', 'news', provider);
      ensureDir(providerDir);

      const metadataPath = path.join(providerDir, 'metadata');
      const thumbnailPath = path.join(providerDir, 'show.jpg');

      // Check if metadata already exists
      const existingMetadata = loadYamlSafe(metadataPath);
      const hasThumbnail = fs.existsSync(thumbnailPath);

      // Fetch channel metadata
      logger.info?.('admin.media.metadata.fetching', { provider });
      const metadata = await ytDlpAdapter.fetchChannelMetadata(adapterSource);

      if (!metadata) {
        return res.status(500).json({ error: 'Failed to fetch channel metadata' });
      }

      // Save metadata.yml
      saveYaml(metadataPath, {
        title: metadata.title,
        description: metadata.description,
        uploader: metadata.uploader,
        thumbnailUrl: metadata.thumbnailUrl
      });

      logger.info?.('admin.media.metadata.saved', { provider, title: metadata.title });

      // Download thumbnail if available and not already present
      let thumbnailDownloaded = false;
      if (metadata.thumbnailUrl && !hasThumbnail) {
        thumbnailDownloaded = await ytDlpAdapter.downloadThumbnail(
          metadata.thumbnailUrl,
          thumbnailPath
        );
        if (thumbnailDownloaded) {
          logger.info?.('admin.media.thumbnail.saved', { provider, path: thumbnailPath });
        }
      }

      res.json({
        ok: true,
        provider,
        title: metadata.title,
        thumbnailDownloaded,
        metadataPath: `media/video/news/${provider}/metadata.yml`,
        thumbnailPath: thumbnailDownloaded ? `media/video/news/${provider}/show.jpg` : null
      });

    } catch (error) {
      logger.error?.('admin.media.metadata.error', { provider, error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /freshvideo/metadata/all - Fetch metadata for all sources
   */
  router.post('/freshvideo/metadata/all', async (req, res) => {
    try {
      const sources = await loadFile('state/youtube');
      if (!sources || !Array.isArray(sources)) {
        return res.json({ results: [], count: 0 });
      }

      const results = [];

      for (const source of sources) {
        const provider = source.shortcode;
        try {
          const adapterSource = {
            provider,
            src: 'youtube',
            type: source.type?.toLowerCase() === 'channel' ? 'channel' : 'playlist',
            id: source.playlist
          };

          const providerDir = path.join(mediaPath, 'video', 'news', provider);
          ensureDir(providerDir);

          const metadataPath = path.join(providerDir, 'metadata');
          const thumbnailPath = path.join(providerDir, 'show.jpg');
          const hasThumbnail = fs.existsSync(thumbnailPath);

          const metadata = await ytDlpAdapter.fetchChannelMetadata(adapterSource);

          if (metadata) {
            saveYaml(metadataPath, {
              title: metadata.title,
              description: metadata.description,
              uploader: metadata.uploader,
              thumbnailUrl: metadata.thumbnailUrl
            });

            let thumbnailDownloaded = false;
            if (metadata.thumbnailUrl && !hasThumbnail) {
              thumbnailDownloaded = await ytDlpAdapter.downloadThumbnail(
                metadata.thumbnailUrl,
                thumbnailPath
              );
            }

            results.push({
              provider,
              success: true,
              title: metadata.title,
              thumbnailDownloaded
            });
          } else {
            results.push({
              provider,
              success: false,
              error: 'Failed to fetch metadata'
            });
          }
        } catch (err) {
          results.push({
            provider,
            success: false,
            error: err.message
          });
        }
      }

      const successCount = results.filter(r => r.success).length;
      logger.info?.('admin.media.metadata.all.complete', {
        total: results.length,
        success: successCount
      });

      res.json({
        results,
        total: results.length,
        success: successCount
      });

    } catch (error) {
      logger.error?.('admin.media.metadata.all.error', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}

export default createAdminMediaRouter;
