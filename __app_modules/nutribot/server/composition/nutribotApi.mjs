import { createNutritionWebDependencies } from "../../../health/server/composition/web-capture.mjs";
// __backend/src/5_composition/modules/nutribotApi.mjs
// Composition wiring for Nutribot API router(s). Extracted from bootstrap.mjs (Task P2.7-E).






import { WebNutribotAdapter } from "../adapters/WebNutribotAdapter.mjs";
import { NutribotInputRouter } from "../application/services/NutribotInputRouter.mjs";
import { LegacyNutribotInputRouter } from "../adapters/LegacyNutribotInputRouter.mjs";
import { TelegramWebhookParser } from '#adapters/telegram/TelegramWebhookParser.mjs';
import { createBotWebhookHandler } from '#adapters/telegram/createBotWebhookHandler.mjs';
import { createNutribotRouter } from "../api/routers/nutribot.mjs";
import { createNutribotServices } from "./runtime.mjs";
import { DailyReportImage } from "../application/DailyReportImage.mjs";
import { NutribotApiService } from "../application/NutribotApiService.mjs";
import { InMemoryRequestDeduplicationStore } from '#adapters/http/InMemoryRequestDeduplicationStore.mjs';

import { dataService } from "../../../../__backend/src/5_composition/runtimePersistence.mjs";

/**
 * Create nutribot API router
 * @param {Object} config
 * @param {Object} config.nutribotServices - Services from createNutribotServices
 * @param {Object} [config.userResolver] - UserResolver for platform ID mapping
 * @param {string} [config.botId] - Telegram bot ID
 * @param {string} [config.secretToken] - X-Telegram-Bot-Api-Secret-Token for webhook auth
 * @param {Object} [config.gateway] - TelegramGateway for callback acknowledgements
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createNutribotApiRouter(config) {
  const {
    nutribotServices,
    userResolver,
    userIdentityService,
    telegramIdentityAdapter,
    botId,
    secretToken,
    gateway,
    aiGatewayAvailable = true,
    logger = console,
    idempotencyStore = new InMemoryRequestDeduplicationStore({ logger })
  } = config;

  // Create webhook parser and input router
  const webhookParser = botId ? new TelegramWebhookParser({ botId, logger }) : null;
  const applicationInputRouter = new NutribotInputRouter(nutribotServices.nutribotContainer, {
    cleanupProvider: config.cleanupProvider,
    userResolver,
    userIdentityService,
    config: nutribotServices.nutribotContainer.getConfig?.(),
    aiGatewayAvailable,
    logger,
  });
  const inputRouter = new LegacyNutribotInputRouter({ inputRouter: applicationInputRouter, logger });

  // Build webhook handler (adapter layer concern, not API layer)
  const webhookHandler = (webhookParser && inputRouter)
    ? createBotWebhookHandler({
        botName: 'nutribot',
        botId,
        parser: webhookParser,
        inputRouter,
        gateway,
        logger,
      })
    : null;

  // Web adapter — captures responses instead of sending via Telegram.
  // Uses the unwrapped application router directly: WebNutribotAdapter calls
  // handleText/handleVoice/handleImage/handleUpc/handleCallback, which only
  // exist on NutribotInputRouter itself — LegacyNutribotInputRouter exposes
  // only route() (for the Telegram webhook's NutribotScaleRefusal mapping).
  //
  // The voice-memo store is built here, off the shared `dataService`, in the
  // same style healthApi.mjs builds its own PhotoStore: each composition path
  // constructs its adapter instance rather than threading one across
  // boundaries. It writes the capture to disk BEFORE transcription, which is
  // what makes a failed transcription recoverable instead of terminal.
  const webNutribotAdapter = new WebNutribotAdapter(createNutritionWebDependencies({ applicationInputRouter, aiGatewayAvailable, logger, nutribotServices, dataService }));

  const unavailableAiOperation = {
    execute() {
      const error = new Error('NutriBot AI input is unavailable');
      error.status = 503;
      throw error;
    },
  };
  const nutribotApi = new NutribotApiService({
    logFoodFromUpc: nutribotServices.nutribotContainer.getLogFoodFromUPC(),
    logFoodFromImage: aiGatewayAvailable
      ? nutribotServices.nutribotContainer.getLogFoodFromImage()
      : unavailableAiOperation,
    logFoodFromText: aiGatewayAvailable
      ? nutribotServices.nutribotContainer.getLogFoodFromText()
      : unavailableAiOperation,
    getReport: nutribotServices.nutribotContainer.getGetReportAsJSON(),
    resolveIdentity: (username) => telegramIdentityAdapter.resolve('nutribot', { username }),
    defaultMember: config.defaultMember,
  });
  const router = createNutribotRouter(nutribotApi, {
    webhookHandler,
    botId,
    secretToken,
    gateway,
    idempotencyStore,
    dailyReportImage: new DailyReportImage({
      reports: nutribotServices.nutribotContainer.getGetReportAsJSON(),
      renderer: nutribotServices.nutribotContainer.getReportRenderer?.() || null,
    }),
    logger
  });

  return { router, webNutribotAdapter };
}
