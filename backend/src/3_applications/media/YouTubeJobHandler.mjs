/**
 * FreshVideoJobHandler - Scheduler-compatible handler for fresh video downloads
 *
 * Wraps FreshVideoService for scheduler integration.
 *
 * @module applications/media/YouTubeJobHandler
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
    configLoader: () => loadFile('state/youtube'),
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
          sources: result.sources.length,
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

// Keep old export name for backward compatibility during transition
export const createYouTubeJobHandler = createFreshVideoJobHandler;

export default createFreshVideoJobHandler;
