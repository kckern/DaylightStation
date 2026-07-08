// backend/src/5_composition/modules/healthApi.mjs
// Composition wiring for Health API router(s). Extracted from bootstrap.mjs (Task P2.7-E).

import { createHealthRouter } from '#api/v1/routers/health.mjs';
import { EntropyService } from '#apps/entropy/services/EntropyService.mjs';
import { SessionService } from '#apps/fitness/services/SessionService.mjs';
import { HealthDashboardUseCase } from '#apps/health/HealthDashboardUseCase.mjs';
import { LongitudinalAggregationService } from '#apps/health/LongitudinalAggregationService.mjs';
import { PersonalContextLoader } from '#apps/health/PersonalContextLoader.mjs';
import { SetDailyCoachingUseCase } from '#apps/health/SetDailyCoachingUseCase.mjs';
import { dataService } from '#system/config/index.mjs';
import fs from 'fs/promises';
import yaml from 'js-yaml';
import path from 'path';
import { createHealthServices } from '../bootstrap.mjs';
import { createHealthDashboardRouter } from '#api/v1/routers/health-dashboard.mjs';

/**
 * Create health API router
 * @param {Object} config
 * @param {Object} config.healthServices - Services from createHealthServices
 * @param {Object} config.configService - ConfigService for user lookup
 * @param {Object} [config.sessionService] - SessionService for fitness session history
 * @param {Object} [config.entropyService] - EntropyService for data freshness
 * @param {Object} [config.lifePlanRepository] - ILifePlanRepository for goal data
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createHealthApiRouter(config) {
  const {
    healthServices,
    configService,
    sessionService = null,
    sessionDatastore = null,
    entropyService = null,
    lifePlanRepository = null,
    catalogService = null,
    webNutribotAdapter = null,
    logger = console
  } = config;

  const dashboardService = new HealthDashboardUseCase({
    healthService: healthServices.healthService,
    healthStore: healthServices.healthStore,
    sessionService,
    entropyService,
    lifePlanRepository,
    logger,
  });

  const longitudinalService = new LongitudinalAggregationService({
    sessionDatastore,
    healthStore: healthServices.healthStore,
  });

  // PersonalContextLoader for the health router. Used by:
  //  - SetDailyCoachingUseCase to resolve the per-user `coaching_dimensions`
  //    schema for DailyCoachingEntry validation (F2-A)
  //  - GET /coaching/schema endpoint (F2-D), so the frontend's
  //    CoachingComplianceCard can render the right rows
  const dataDirForCoaching = configService?.getDataDir?.() || './data';
  const archiveRootForCoaching = path.resolve(dataDirForCoaching, 'users');
  const yamlReaderForCoaching = {
    readYaml: async (absPath) => {
      try {
        const content = await fs.readFile(absPath, 'utf8');
        return yaml.load(content) || null;
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        logger.warn?.('health_router.personal_context.read_failed', {
          path: absPath,
          error: err?.message || String(err),
        });
        return null;
      }
    },
  };
  const personalContextLoader = new PersonalContextLoader({
    dataService: yamlReaderForCoaching,
    archiveRoot: archiveRootForCoaching,
    logger,
  });

  const setDailyCoachingUseCase = new SetDailyCoachingUseCase({
    healthStore: healthServices.healthStore,
    personalContextLoader,
    logger,
  });

  return createHealthRouter({
    healthService: healthServices.healthService,
    healthStore: healthServices.healthStore,
    nutriListStore: healthServices.nutriListStore,
    dashboardService,
    longitudinalService,
    setDailyCoachingUseCase,
    personalContextLoader,
    configService,
    catalogService,
    webNutribotAdapter,
    logger
  });
}

/**
 * Create health dashboard API router
 * @param {Object} config
 * @param {Object} config.dataService - DataService for YAML persistence
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createHealthDashboardApiRouter(config) {
  const {
    dataService,
    logger = console
  } = config;

  return createHealthDashboardRouter({
    dataService,
    logger
  });
}
