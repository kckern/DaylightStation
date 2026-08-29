// backend/src/5_composition/modules/financeApi.mjs
// Composition wiring for Finance API router(s). Extracted from bootstrap.mjs (Task P2.7-E).

import { createFinanceRouter } from '#api/v1/routers/finance.mjs';
import { FinanceApiService } from '#apps/finance/FinanceApiService.mjs';
import { createFinanceServices } from '../bootstrap.mjs';
import { nowMonth, nowTs24 } from '#system/utils/index.mjs';

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

  const financeService = new FinanceApiService({
    provider: financeServices.buxferAdapter,
    // These are retained public API compatibility values. Concrete provider
    // naming belongs in composition, not finance application orchestration.
    providerDescriptor: {
      source: 'buxfer',
      adapter: 'buxfer',
      unavailableMessage: 'Buxfer adapter not initialized',
    },
    store: financeServices.financeStore,
    harvestService: financeServices.harvestService,
    compilationService: financeServices.compilationService,
    categorizationService: financeServices.categorizationService,
    payrollService: financeServices.payrollService,
    defaultHouseholdId: () => configService?.getDefaultHouseholdId(),
    currentMonth: nowMonth,
    timestamp: nowTs24,
    logger,
  });

  return createFinanceRouter({ financeService, logger });
}
