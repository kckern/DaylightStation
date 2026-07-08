// backend/src/5_composition/modules/financeApi.mjs
// Composition wiring for Finance API router(s). Extracted from bootstrap.mjs (Task P2.7-E).

import { createFinanceRouter } from '#api/v1/routers/finance.mjs';
import { createFinanceServices } from '../bootstrap.mjs';

/**
 * Create finance API router
 * @param {Object} config
 * @param {Object} config.financeServices - Services from createFinanceServices
 * @param {Object} config.configService - ConfigService for household lookup
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createFinanceApiRouter(config) {
  const {
    financeServices,
    configService,
    logger = console
  } = config;

  return createFinanceRouter({
    buxferAdapter: financeServices.buxferAdapter,
    financeStore: financeServices.financeStore,
    harvestService: financeServices.harvestService,
    compilationService: financeServices.compilationService,
    categorizationService: financeServices.categorizationService,
    payrollService: financeServices.payrollService,
    configService,
    logger
  });
}
