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

/**
 * Create Admin Media Router
 *
 * @param {Object} config
 * @param {Object} config.mediaDownloadService - MediaDownloadService instance
 * @param {Function} config.loadFile - Function to load config files
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createAdminMediaRouter(config) {
  const { mediaDownloadService, loadFile, logger = console } = config;
  const router = express.Router();

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

      // Transform to service format
      const serviceSource = {
        provider: source.shortcode,
        src: 'youtube',
        type: source.type?.toLowerCase() === 'channel' ? 'channel' : 'playlist',
        id: source.playlist
      };

      const result = await mediaDownloadService.fetchAndSaveMetadata(serviceSource);

      if (!result.ok) {
        return res.status(500).json({ error: result.error });
      }

      res.json({
        ok: true,
        provider,
        title: result.title,
        thumbnailDownloaded: result.thumbnailDownloaded,
        metadataPath: result.metadataRelPath,
        thumbnailPath: result.thumbnailRelPath
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

      // Transform all sources to service format
      const serviceSources = sources.map(source => ({
        provider: source.shortcode,
        src: 'youtube',
        type: source.type?.toLowerCase() === 'channel' ? 'channel' : 'playlist',
        id: source.playlist
      }));

      const { results, total, success } = await mediaDownloadService.fetchAndSaveMetadataAll(serviceSources);

      res.json({ results, total, success });

    } catch (error) {
      logger.error?.('admin.media.metadata.all.error', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}

export default createAdminMediaRouter;
