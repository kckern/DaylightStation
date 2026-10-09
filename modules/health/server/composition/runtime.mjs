import { YamlHealthDatastore } from "../adapters/persistence/yaml/YamlHealthDatastore.mjs";
import { createWorkoutHistoryReader } from "../../../fitness/server/workout-history.mjs";
import { YamlNutriListDatastore } from "../adapters/persistence/yaml/YamlNutriListDatastore.mjs";
import { ReconciliationProcessor } from "../application/health/ReconciliationProcessor.mjs";
import { YamlHealthScanDatastore } from "../adapters/persistence/yaml/YamlHealthScanDatastore.mjs";
import { AggregateHealthUseCase } from "../application/health/AggregateHealthUseCase.mjs";
import { LatestReconciliationReader } from "../application/health/LatestReconciliationReader.mjs";
import { YamlFoodCatalogDatastore } from "../adapters/persistence/yaml/YamlFoodCatalogDatastore.mjs";
import { IconManifestStore } from "../adapters/persistence/IconManifestStore.mjs";
import { FoodCatalogService } from "../application/health/FoodCatalogService.mjs";
import crypto from "node:crypto";
import { iconVocabulary } from "../domain/nutrition/services/icons.mjs";

export function createHealthServices(config) {
  const {
    dataService,
    userResolver,
    configService,
    logger = console
  } = config;

  // Health store (YAML persistence)
  // YamlHealthDatastore uses dataService.user.read() API
  const healthStore = new YamlHealthDatastore({
    dataService,
    userResolver,
    configService,
    // Home Fitness-app sessions count as exercise before Strava catches up.
    homeSessionStore: configService?.getHouseholdPath
      ? createWorkoutHistoryReader({ configService, logger })
      : null,
    logger
  });

  // NutriList store for nutrilist endpoints and adjustment data (optional, requires dataService)
  let nutriListStore = null;
  if (dataService) {
    nutriListStore = new YamlNutriListDatastore({
      dataService,
      logger
    });
  }

  // Calorie reconciliation processor (runs after health aggregation)
  // nutritionItemsReader uses nutriListStore for archive-aware nutrilist access
  const reconciliationProcessor = new ReconciliationProcessor({
    healthStore,
    nutritionItemsReader: nutriListStore,
    // DEXA scans (lifelog/archives/scans/) anchor the resting rate.
    bodyScans: configService?.getDataDir ? new YamlHealthScanDatastore({ dataDir: configService.getDataDir(), logger }) : null,
    logger
  });

  // Health aggregation use case (application layer)
  const healthService = new AggregateHealthUseCase({
    healthStore,
    reconciliationProcessor,
    logger
  });

  // Reconciliation reader closure for real-time prompt boost
  const latestReconciliation = new LatestReconciliationReader({
    store: healthStore,
    defaultUserId: () => configService.getHeadOfHousehold?.() || 'user_1',
  });
  const reconciliationReader = () => latestReconciliation.read();

  // Food catalog persistence + service
  const catalogStore = new YamlFoodCatalogDatastore({ dataService, logger });
  // The catalog needs the manifest's offered (hi-res) vocabulary. Built fail-soft
  // like nutribot's own store: no media root, no filtering.
  let catalogMediaRoot = null;
  try { catalogMediaRoot = configService?.getMediaDir?.() ?? null; }
  catch (e) { logger.warn?.('health.catalog.icons.mediaRootUnavailable', { error: e.message }); }
  const catalogIcons = catalogMediaRoot
    ? new IconManifestStore({ dataService, mediaRoot: catalogMediaRoot, logger })
    : null;
  const catalogService = new FoodCatalogService({
    catalogStore,
    nutriListStore,
    clock: { now: () => Date.now() },
    createId: crypto.randomUUID,
    logger,
    iconOffered: catalogIcons ? slug => catalogIcons.list().includes(slug) : null,
    // Offered slugs + reviewed food-name aliases, for the suggest-time icon
    // fallback. Built per call: the store re-reads after an operator edit.
    iconVocabulary: catalogIcons ? () => iconVocabulary(catalogIcons.list().join(' '), catalogIcons.foodNames()) : null,
  });

  return {
    healthStore,
    healthService,
    nutriListStore,
    reconciliationReader,
    catalogService,
  };
}
