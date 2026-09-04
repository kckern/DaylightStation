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
import { YamlMealTemplateDatastore } from '#adapters/persistence/yaml/YamlMealTemplateDatastore.mjs';
import { TemplateService } from '#apps/health/TemplateService.mjs';
import { TemplateCurationJob } from '#apps/health/TemplateCurationJob.mjs';
import { YamlFoodCatalogDatastore } from '#adapters/persistence/yaml/YamlFoodCatalogDatastore.mjs';
import { CatalogReconcileJob } from '#apps/health/CatalogReconcileJob.mjs';
import { CatalogAuditService } from '#apps/health/CatalogAuditService.mjs';
import { YamlMedicalReadingsDatastore } from '#adapters/persistence/yaml/YamlMedicalReadingsDatastore.mjs';
import { MedicalReadingsService } from '#apps/health/MedicalReadingsService.mjs';
import { PhotoStore } from '#adapters/persistence/PhotoStore.mjs';
import { IconManifestStore } from '#adapters/persistence/IconManifestStore.mjs';
import { YamlObservationStore } from '#adapters/persistence/yaml/YamlObservationStore.mjs';
import { createObservationPairingService } from '#apps/nutrition/ObservationPairingService.mjs';
import { normalizeScaleNutribotConfig } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';
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

  // Meal templates (PRD Theme 6). Its OWN adapter instance off the shared
  // `dataService`, exactly as goals/savedMeals/medical above. Saved meals are
  // NOT retired underneath it — they remain the copy-day-to-today transport
  // (F6.3); a template is the durable, core/variant-aware thing.
  const templateService = new TemplateService({
    templateStore: new YamlMealTemplateDatastore({ dataService }),
    nutriListStore: healthServices.nutriListStore,
    clock: { now: () => Date.now() },
    createId: uuidv4,
    logger,
  });

  // The catalog drift audit (catalog-density fix, step 5). Its OWN catalog
  // adapter off the shared `dataService`, the same pattern goals/savedMeals/
  // medical/templates use above — both handles resolve the identical
  // users/{userId}/lifelog/nutrition/food_catalog.yml.
  //
  // It shares the TEMPLATE service built above, because the dismissal ledger is
  // the household's one "never propose this again" list and drift keys live in
  // it alongside meal-template keys (namespaced, so they cannot collide).
  const catalogAuditService = createCatalogAuditService({
    healthServices,
    templateService,
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

  // The food-icon vocabulary (PRD F5.1). Its OWN instance off the shared
  // `dataService`, exactly as goals/savedMeals/medical/photos above. The
  // manifest lives in the data mount and the files it names live on the media
  // mount, so the store needs both roots; `getMediaDir()` is the same root
  // `getPath('icons')` derives from.
  //
  // A household with no manifest installed yields an empty vocabulary and the
  // icon route 404s — rows fall back to the neutral dot rather than the app
  // refusing to boot over decoration.
  const iconManifestStore = configService?.getMediaDir
    ? new IconManifestStore({ dataService, mediaRoot: configService.getMediaDir(), logger })
    : null;

  // Warm the render cache in the background, unhurried, so the edit sheet's
  // picker (60 icons at once) is never the thing that discovers a cold cache.
  // Fire-and-forget by design: nothing waits for it, a failure is logged and
  // dropped, and it paces itself so it never becomes the reason a request is
  // slow. See IconManifestStore.warmCache for why the cache goes cold at all.
  iconManifestStore?.warmCache().catch((error) => {
    logger.warn?.('health.icons.warm.failed', { error: error.message });
  });

  // The kitchen-scale observation ledger, for the day view's read / re-pair / dismiss
  // surface. Its OWN adapter instance off the shared `dataService`, exactly as
  // goals/savedMeals/medical/photos above — the live scale path (app.mjs) builds a second
  // instance for the frame path, and both resolve the identical
  // users/{userId}/lifelog/nutrition/observations.yml, so this is operationally a
  // singleton without threading one across composition boundaries.
  //
  // `scaleConfig` is a THUNK: the household config is cached in memory at boot and a
  // reload must be picked up without rebuilding the router. Normalized here (containers +
  // density levels with their defaults) so the service is handed the same shape the
  // nutribot scale path uses.
  const observationPairing = createObservationPairingService({
    observationStore: new YamlObservationStore({ dataService, logger }),
    entries: {
      find: (userId, uuid) => healthOperations.findNutritionItem(userId, uuid),
      // `ratify: false` — a re-pair corrects an entry's grams from a measurement, and
      // (with no density scan) leaves its calories as the machine estimated them.
      // Stamping settled:true would certify a calorie figure nobody reviewed and hide
      // the very badge asking them to.
      update: (userId, uuid, changes) => healthOperations.updateNutritionItem(userId, uuid, changes, { ratify: false }),
    },
    // `normalizeScaleNutribotConfig` takes the WHOLE scales config and reads its own
    // `nutribot` block — passing that block directly would find no `nutribot` key inside
    // it and silently fall back to the default container/density tables.
    scaleConfig: () => normalizeScaleNutribotConfig(
      configService?.getHouseholdAppConfig?.(null, 'scales') || {},
    ),
    logger,
  });

  return createHealthRouter({
    healthService: healthServices.healthService,
    healthOperations,
    dashboardService,
    longitudinalService,
    catalogService,
    budgetService,
    savedMealsService,
    templateService,
    catalogAuditService,
    medicalService,
    photoStore,
    observationPairing,
    iconManifestStore,
    logger
  });
}

/**
 * Compose the weekly template-curation job (PRD F6.2).
 *
 * Its OWN TemplateService instance off the shared `dataService`, the same
 * pattern every other store in this file uses — rather than reshaping
 * `createHealthApiRouter`'s return value, which every caller destructures as a
 * router. Both instances resolve the identical
 * users/{userId}/apps/health/meal-templates.yml, and the job only ever appends
 * proposals, so two handles on one file is operationally a singleton.
 *
 * Registered on the agents Scheduler in app.mjs.
 *
 * @param {Object} config
 * @param {Object} config.healthServices - from createHealthServices (nutriListStore)
 * @param {Object} [config.logger]
 * @returns {TemplateCurationJob}
 */
export function createTemplateCurationJob({ healthServices, logger = console }) {
  return new TemplateCurationJob({
    templateService: new TemplateService({
      templateStore: new YamlMealTemplateDatastore({ dataService }),
      nutriListStore: healthServices.nutriListStore,
      clock: { now: () => Date.now() },
      createId: uuidv4,
      logger,
    }),
    nutriListStore: healthServices.nutriListStore,
    clock: { now: () => Date.now() },
    logger,
  });
}

/**
 * Compose the catalog drift audit and the reconcile job it re-seeds through.
 *
 * Same "own adapter instance off the shared dataService" pattern as every
 * other store in this file. Used twice: by the router (the manual report and
 * its Approve/Dismiss) and by the weekly `health:catalog-audit` task in
 * app.mjs, which only reads and logs.
 *
 * @param {Object} config
 * @param {Object} config.healthServices - from createHealthServices (nutriListStore)
 * @param {Object} [config.templateService] - the shared dismissal ledger; one is
 *   built here when the caller has none of its own
 * @param {Object} [config.logger]
 * @returns {CatalogAuditService}
 */
export function createCatalogAuditService({ healthServices, templateService = null, logger = console }) {
  const catalogStore = new YamlFoodCatalogDatastore({ dataService, logger });
  const reconcileJob = new CatalogReconcileJob({
    catalogStore,
    nutriListStore: healthServices.nutriListStore,
    clock: { now: () => Date.now() },
    logger,
  });
  return new CatalogAuditService({
    catalogStore,
    reconcileJob,
    templateService: templateService || new TemplateService({
      templateStore: new YamlMealTemplateDatastore({ dataService }),
      nutriListStore: healthServices.nutriListStore,
      clock: { now: () => Date.now() },
      createId: uuidv4,
      logger,
    }),
    logger,
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
