// backend/src/5_composition/modules/lifelogApi.mjs
// Composition wiring for Lifelog API router(s). Extracted from bootstrap.mjs (Task P2.7-E).

import { createLifelogRouter } from '#api/v1/routers/lifelog.mjs';
import { createLifelogServices } from '../bootstrap.mjs';

/**
 * Create lifelog API router
 * @param {Object} config
 * @param {Object} config.lifelogServices - Services from createLifelogServices
 * @param {Object} config.userDataService - UserDataService for reading user files
 * @param {Object} config.configService - ConfigService for user lookup
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createLifelogApiRouter(config) {
  const {
    lifelogServices,
    userDataService,
    configService,
    logger = console
  } = config;

  return createLifelogRouter({
    aggregator: lifelogServices.lifelogAggregator,
    userDataService,
    configService,
    logger
  });
}
