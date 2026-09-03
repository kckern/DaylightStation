// backend/src/5_composition/modules/healthApi.mjs
// Composition wiring for Health API router(s). Extracted from bootstrap.mjs (Task P2.7-E).

import { createHealthRouter } from '#api/v1/routers/health.mjs';
import { EntropyService } from '#apps/entropy/services/EntropyService.mjs';
import { SessionService } from '#apps/fitness/services/SessionService.mjs';
import { HealthDashboardUseCase } from '#apps/health/HealthDashboardUseCase.mjs';
import { LongitudinalAggregationService } from '#apps/health/LongitudinalAggregationService.mjs';
import { PersonalContextLoader } from '#apps/health/PersonalContextLoader.mjs';
import { YamlPersonalPlaybookStore } from '#adapters/health/YamlPersonalPlaybookStore.mjs';
import { SetDailyCoachingUseCase } from '#apps/health/SetDailyCoachingUseCase.mjs';
import { HealthOperations } from '#apps/health/HealthOperations.mjs';
import { YamlHealthGoalsDatastore } from '#adapters/persistence/yaml/YamlHealthGoalsDatastore.mjs';
import { BudgetService } from '#apps/health/BudgetService.mjs';
import { YamlSavedMealsDatastore } from '#adapters/persistence/yaml/YamlSavedMealsDatastore.mjs';
import { SavedMealsService } from '#apps/health/SavedMealsService.mjs';
import { YamlMedicalReadingsDatastore } from '#adapters/persistence/yaml/YamlMedicalReadingsDatastore.mjs';
import { MedicalReadingsService } from '#apps/health/MedicalReadingsService.mjs';
import { PhotoStore } from '#adapters/persistence/PhotoStore.mjs';
import { dataService } from '../runtimePersistence.mjs';
import { nowDate } from '#system/utils/time.mjs';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { createHealthServices } from '../bootstrap.mjs';
import { createHealthDashboardRouter } from '#api/v1/routers/health-dashboard.mjs';
import { AgentHealthDashboardService } from '#apps/health/AgentHealthDashboardService.mjs';
import { DataServiceHealthDashboardRepository } from '#adapters/persistence/files/DataServiceHealthDashboardRepository.mjs';

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
  const personalContextLoader = new PersonalContextLoader({
    playbookStore: new YamlPersonalPlaybookStore({ usersRoot: archiveRootForCoaching, logger }),
    logger,
  });

  const setDailyCoachingUseCase = new SetDailyCoachingUseCase({
    healthStore: healthServices.healthStore,
    personalContextLoader,
    logger,
  });

  const healthOperations = new HealthOperations({
    healthData: healthServices.healthStore,
    nutritionItems: healthServices.nutriListStore,
    personalContext: personalContextLoader,
    setDailyCoaching: setDailyCoachingUseCase,
    nutritionInput: webNutribotAdapter,
    resolveDefaultUsername: () => configService?.getHeadOfHousehold?.()
      || configService?.getDefaultUsername?.()
      || 'default',
    resolveCoachingUsername: () => configService?.getHeadOfHousehold?.() || null,
    today: nowDate,
    newId: uuidv4,
  });

  const goalsStore = new YamlHealthGoalsDatastore({ dataService });
  const budgetService = new BudgetService({
    goalsStore,
    healthStore: healthServices.healthStore,
    nutriListStore: healthServices.nutriListStore,
    clock: { now: () => Date.now() },
    logger,
  });

  const savedMealsService = new SavedMealsService({
    mealsStore: new YamlSavedMealsDatastore({ dataService }),
    nutriListStore: healthServices.nutriListStore,
    clock: { now: () => Date.now() },
    createId: uuidv4,
    logger,
  });

  const medicalService = new MedicalReadingsService({
    store: new YamlMedicalReadingsDatastore({ dataService }),
    createId: uuidv4,
    logger,
  });

  // A SEPARATE PhotoStore instance from the one createNutribotServices
  // builds for the image use case (bootstrap.mjs) — same pattern this file
  // already uses for goals/savedMeals/medical datastores: each composition
  // path constructs its own adapter instance off the shared `dataService`,
  // rather than threading one instance across composition boundaries. Both
  // instances resolve the identical on-disk
  // users/{userId}/lifelog/nutrition/photos directory, so this is
  // operationally equivalent to a singleton without actually being one.
  const photoStore = new PhotoStore({ dataService, logger });

  return createHealthRouter({
    healthService: healthServices.healthService,
    healthOperations,
    dashboardService,
    longitudinalService,
    catalogService,
    budgetService,
    savedMealsService,
    medicalService,
    photoStore,
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

  const repository = new DataServiceHealthDashboardRepository({ dataService });
  const dashboardService = new AgentHealthDashboardService({
    repository,
    clock: { now: () => new Date() },
    logger,
  });
  return createHealthDashboardRouter({ dashboardService });
}
