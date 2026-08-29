// backend/src/5_composition/modules/staticApi.mjs
// Composition wiring for Static API router(s). Extracted from bootstrap.mjs (Task P2.7-E).

import { createStaticRouter } from '#api/v1/routers/static.mjs';
import { StaticAssetService } from '#apps/static-assets/StaticAssetService.mjs';
import { FilesystemStaticImageRepository } from '#adapters/persistence/files/FilesystemStaticImageRepository.mjs';
import { resizeStaticImage } from '#rendering/static-assets/resizeStaticImage.mjs';

/**
 * Create static assets API router
 * @param {Object} config
 * @param {string} config.imgBasePath - Base path for images
 * @param {string} config.dataBasePath - Base path for data files
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createStaticApiRouter(config) {
  const { imgBasePath, logger = console } = config;
  const staticAssetService = new StaticAssetService({
    repository: new FilesystemStaticImageRepository({ imgBasePath }),
    resizeImage: resizeStaticImage,
    logger,
  });
  return createStaticRouter({ staticAssetService, logger });
}
