// backend/src/5_composition/modules/costApi.mjs
// Composition wiring for Cost API router(s). Extracted from bootstrap.mjs (Task P2.7-E).

import createCostRouter from '#api/v1/routers/cost.mjs';
import { createCostServices } from '../bootstrap.mjs';

/**
 * Create cost API router
 *
 * @param {Object} config
 * @param {Object} config.costServices - Services from createCostServices
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createCostApiRouter(config) {
  const {
    costServices,
    logger = console
  } = config;

  return createCostRouter({
    reportingService: costServices.reportingService,
    budgetService: costServices.budgetService,
    logger
  });
}
