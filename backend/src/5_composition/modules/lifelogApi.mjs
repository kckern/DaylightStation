// backend/src/5_composition/modules/lifelogApi.mjs
// Composition wiring for Lifelog API router(s). Extracted from bootstrap.mjs (Task P2.7-E).

import { createLifelogRouter } from '#api/v1/routers/lifelog.mjs';
import { createLifelogServices } from '../bootstrap.mjs';
import { DefaultPrincipalResolver } from '#apps/common/context/DefaultPrincipalResolver.mjs';
import { LifelogWeightService } from '#apps/lifelog/LifelogWeightService.mjs';
import { DataServiceWeightHistorySource } from '#adapters/lifelog/DataServiceWeightHistorySource.mjs';

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
    dataService,
    configService,
    logger = console
  } = config;

  return createLifelogRouter({
    aggregator: lifelogServices.lifelogAggregator,
    weightService: new LifelogWeightService({
      principalResolver: new DefaultPrincipalResolver({
        headOfHousehold: () => configService?.getHeadOfHousehold?.(),
        fallback: 'user_1',
      }),
      weightHistorySource: new DataServiceWeightHistorySource({ dataService }),
    }),
    logger
  });
}
