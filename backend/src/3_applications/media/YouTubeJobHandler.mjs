/**
 * YouTubeJobHandler - Scheduler-compatible handler for YouTube downloads
 *
 * Wraps YouTubeDownloadService for scheduler integration.
 *
 * @module applications/media/YouTubeJobHandler
 */

import { YouTubeDownloadService } from './services/YouTubeDownloadService.mjs';

/**
 * Create a scheduler-compatible handler for YouTube downloads
 *
 * @param {Object} config
 * @param {Function} config.loadFile - Function to load YAML config files
 * @param {string} config.mediaPath - Path to media/video/news directory
 * @param {Object} [config.logger] - Logger instance
 * @returns {Function} Async handler (logger, executionId) => Promise<void>
 */
export function createYouTubeJobHandler({ loadFile, mediaPath, logger }) {
  const service = new YouTubeDownloadService({
    configLoader: () => loadFile('state/youtube'),
    mediaPath,
    logger,
  });

  return async (scopedLogger, executionId) => {
    const log = scopedLogger || logger || console;

    log.info?.('youtube.job.start', { executionId });

    try {
      const result = await service.run();

      if (result.skipped) {
        log.info?.('youtube.job.skipped', { executionId, reason: result.reason });
      } else {
        log.info?.('youtube.job.complete', {
          executionId,
          deleted: result.deleted.length,
          channels: result.shortcodes.length,
          files: result.files.length,
        });
      }

      return result;
    } catch (error) {
      log.error?.('youtube.job.error', { executionId, error: error.message });
      throw error;
    }
  };
}

export default createYouTubeJobHandler;
