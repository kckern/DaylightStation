import { createNutritionCaptureStores, createNutritionCaptureVocabulary } from "../../../health/server/composition/nutrition-storage.mjs";
import { createNutribotRuntimeConfig } from "../../../health/server/nutrition-config.mjs";




import { normalizeScaleNutribotConfig } from "../../../health/server/scale-config.mjs";
import { NutribotContainer } from "../application/NutribotContainer.mjs";
import { FetchImageDownloader } from "../adapters/FetchImageDownloader.mjs";
import { createHealthBudget } from "../../../health/server/composition/budget.mjs";

export async function createNutribotServices(config) {
  const {
    configService,
    dataService,
    telegramAdapter,
    aiGateway,
    decisionGateway = null,
    upcGateway,
    googleImageGateway,
    conversationStateStore,
    reportRenderer = null,
    reportDelivery,
    nutribotConfig: rawNutribotConfig = {},
    reconciliationReader,
    healthStore = null,
    catalogService = null,
    agentOrchestrator = null,
    mealCoachingTrigger = null,
    scaleRawConfig = {},
    pause,
    logger = console
  } = config;

  // Ensure nutribotConfig has required methods (getUserGoals, getUserTimezone)
  // If it's a plain object from configService, wrap with default method implementations
  const nutribotConfig = createNutribotRuntimeConfig(rawNutribotConfig);

  const { foodLogStore, nutriListStore, photoStore } = createNutritionCaptureStores({ configService, dataService, logger });

  // NOTE: Legacy nutriCoachStore removed — coaching is now handled by
  // HealthCoachAgent via healthStore.loadCoachingData/saveCoachingData

  // Barcode image generator (for UPC photo status)
  const { BarcodeImageAdapter } = await import("../adapters/BarcodeImageAdapter.mjs");
  const barcodeGenerator = new BarcodeImageAdapter({ logger });

  // Preserve the application boundary: GenerateDailyReport receives a delivery
  // capability, never a renderer or temporary-file convention. App composition
  // historically supplied `reportRenderer` under its old name, leaving this
  // undefined and silently downgrading every report to text.
  let resolvedReportDelivery = reportDelivery ?? null;
  if (!resolvedReportDelivery && reportRenderer) {
    const { TemporaryNutriReportDelivery } = await import("../adapters/TemporaryNutriReportDelivery.mjs");
    resolvedReportDelivery = new TemporaryNutriReportDelivery({ renderer: reportRenderer, logger });
  }
  logger.info?.('nutribot.report.delivery.configured', {
    mode: resolvedReportDelivery ? 'photo' : 'text-fallback',
  });

  // The icon vocabulary the capture agent may choose from (PRD F5.1: ONE
  // vocabulary). The reviewed manifest is the source of truth; the legacy flat
  // directory is only the fallback for a household that has not installed one.
  //
  // Only the manifest's OFFERED slugs go in — its aliases exist so already-
  // stored `FoodItem.icon` values keep resolving, not so the model can pick
  // them. Every mapper CONFINES the model's answer to this same string
  // (2_domains/nutrition/services/icons.mjs), so a slug that is not here can
  // never reach a stored row.
  //
  // The hi-res manifest is the EXCLUSIVE icon set. With no manifest (or no
  // media root) the vocabulary is just the neutral fallback: the retired 20 px
  // flat directory is never read. Fail-soft: a configService double without
  // `getMediaDir` (the composition contract registry supplies one), or one
  // that throws, must not take the nutribot container down over decoration.
  const { foodIconsString, readFoodIconNames } = createNutritionCaptureVocabulary({ configService, dataService, logger });

  // Create nutribot container with all dependencies
  // Note: Identity resolution (conversation ID -> username) is handled by
  // UserResolver in the adapter layer (NutribotInputRouter), not here.
  //
  // agentOrchestrator may be provided as a lazy proxy if the orchestrator is
  // created after the container (e.g. in app.mjs initialization order).
  const scaleConfig = normalizeScaleNutribotConfig(scaleRawConfig);

  const nutribotContainer = new NutribotContainer(nutribotConfig, {
    foodIconNames: readFoodIconNames(),
    transcribeAudio: config.transcribeAudio,
    messagingGateway: telegramAdapter,
    aiGateway,
    decisionGateway,
    upcGateway,
    googleImageGateway,
    foodLogStore,
    nutriListStore,
    conversationStateStore,
    reportDelivery: resolvedReportDelivery,
    barcodeGenerator,
    foodIconsString,
    reconciliationReader,
    healthStore,
    catalogService,
    scaleConfig,
    pause,
    agentOrchestrator,
    mealCoachingTrigger,
    imageDownloader: new FetchImageDownloader(),
    photoStore,
    // The daily report states the health budget's range and zone.
    budgetService: createHealthBudget({ dataService, healthStore, nutriListStore, logger }),
    logger
  });

  return {
    foodLogStore,
    nutriListStore,
    nutribotContainer,
    scaleConfig
  };
}
