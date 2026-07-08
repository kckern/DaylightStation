// backend/src/5_composition/modules/entropyApi.mjs
// Composition wiring for Entropy API router(s). Extracted from bootstrap.mjs (Task P2.7-E).

import { createEntropyRouter } from '#api/v1/routers/entropy.mjs';
import { createEntropyServices } from '../bootstrap.mjs';

/**
 * Create entropy API router
 * @param {Object} config
 * @param {Object} config.entropyServices - Services from createEntropyServices
 * @param {Object} config.configService - ConfigService for user lookup
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createEntropyApiRouter(config) {
  const {
    entropyServices,
    configService,
    logger = console
  } = config;

  return createEntropyRouter({
    entropyService: entropyServices.entropyService,
    configService,
    logger
  });
}
