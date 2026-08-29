/**
 * FreshVideoJobHandler - Scheduler-compatible handler for fresh video downloads
 *
 * Wraps FreshVideoService for scheduler integration.
 *
 * @module applications/media/FreshVideoJobHandler
 */

import { FreshVideoService } from './services/FreshVideoService.mjs';
import { ValidationError } from '#apps/common/errors/SemanticErrors.mjs';

/**
 * Create a scheduler-compatible handler for fresh video downloads
 *
 * @param {Object} config
 * @param {Object} config.videoSourceGateway - Gateway implementing IVideoSourceGateway
 * @param {Object} config.sourceCatalog - Semantic configured-source catalog
 * @param {Object} config.mediaStore - Fresh-video persistence capability
 * @param {Object} [config.logger] - Logger instance
 * @returns {Function} Async handler (logger, executionId) => Promise<void>
 */
export function createFreshVideoJobHandler({ videoSourceGateway, sourceCatalog, mediaStore, lockOwnerId, logger }) {
  if (!mediaStore) {
    throw new ValidationError('mediaStore is required for FreshVideoJobHandler', {
      field: 'mediaStore',
      received: mediaStore,
    });
  }

  const service = new FreshVideoService({
    videoSourceGateway,
    configLoader: () => sourceCatalog?.list?.(),
    mediaStore,
    lockOwnerId,
    logger,
  });

  return async (scopedLogger, executionId) => {
    const log = scopedLogger || logger || console;

    log.info?.('freshvideo.job.start', { executionId });

    try {
      const semanticResult = await service.run();
      const result = mediaStore.presentRunResult(semanticResult);

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
