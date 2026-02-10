/**
 * FreshVideoJobHandler - Scheduler-compatible handler for fresh video downloads
 *
 * Wraps FreshVideoService for scheduler integration.
 *
 * @module applications/media/FreshVideoJobHandler
 */

import { FreshVideoService } from './services/FreshVideoService.mjs';
import { ValidationError } from '#system/utils/errors/index.mjs';

/**
 * Create a scheduler-compatible handler for fresh video downloads
 *
 * @param {Object} config
 * @param {Object} config.videoSourceGateway - Gateway implementing IVideoSourceGateway
 * @param {Function} config.loadFile - Function to load YAML config files
 * @param {string} config.mediaPath - Path to media/video/news directory
 * @param {Object} [config.logger] - Logger instance
 * @returns {Function} Async handler (logger, executionId) => Promise<void>
 */
export function createFreshVideoJobHandler({ videoSourceGateway, loadFile, mediaPath, logger }) {
  // Validate required mediaPath to fail fast instead of at runtime
  if (!mediaPath) {
    throw new ValidationError('mediaPath is required for FreshVideoJobHandler', {
      field: 'mediaPath',
      received: mediaPath
    });
  }

  const service = new FreshVideoService({
    videoSourceGateway,
    configLoader: async () => {
      const raw = await loadFile('state/youtube');
      if (!Array.isArray(raw)) return [];
      return raw.map(s => ({
        provider: s.shortcode,
        src: s.src || 'youtube',
        type: (s.type || 'playlist').toLowerCase(),
        id: s.playlist,
        volume: s.volume,
        rate: s.rate,
        sort: s.sort,
        folder: s.folder,
      }));
    },
    mediaPath,
    logger,
  });

  return async (scopedLogger, executionId) => {
    const log = scopedLogger || logger || console;

    log.info?.('freshvideo.job.start', { executionId });

    try {
      const result = await service.run();

      if (result.skipped) {
        log.info?.('freshvideo.job.skipped', { executionId, reason: result.reason });
      } else {
        log.info?.('freshvideo.job.complete', {
          executionId,
          deleted: result.deleted.length,
          providers: result.providers.length,
          files: result.files.length,
        });
      }

      return result;
    } catch (error) {
      log.error?.('freshvideo.job.error', { executionId, error: error.message });
      throw error;
    }
  };
}

export default createFreshVideoJobHandler;
