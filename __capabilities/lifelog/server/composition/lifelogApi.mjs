// __backend/src/5_composition/modules/lifelogApi.mjs
// Composition wiring for Lifelog API router(s). Extracted from bootstrap.mjs (Task P2.7-E).

import { createLifelogRouter } from "../api/lifelog.mjs";

/**
 * Create lifelog API router
 * @param {Object} config
 * @param {Object} config.lifelogServices - Services from createLifelogServices
 * @param {Object} config.dataService - Hierarchical persistence capability
 * @param {Object} config.configService - ConfigService for user lookup
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createLifelogApiRouter(config) {
  const {
    lifelogServices,
    weightService,
    logger = console
  } = config;

  return createLifelogRouter({
    aggregator: lifelogServices.lifelogAggregator,
    weightService: weightService,
    logger
  });
}
