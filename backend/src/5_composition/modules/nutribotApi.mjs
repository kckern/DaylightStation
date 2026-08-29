// backend/src/5_composition/modules/nutribotApi.mjs
// Composition wiring for Nutribot API router(s). Extracted from bootstrap.mjs (Task P2.7-E).

import { WebNutribotAdapter } from '#adapters/nutribot/WebNutribotAdapter.mjs';
import { NutribotInputRouter } from '#apps/nutribot/services/NutribotInputRouter.mjs';
import { LegacyNutribotInputRouter } from '#adapters/nutribot/LegacyNutribotInputRouter.mjs';
import { TelegramWebhookParser } from '#adapters/telegram/TelegramWebhookParser.mjs';
import { createBotWebhookHandler } from '#adapters/telegram/createBotWebhookHandler.mjs';
import { createNutribotRouter } from '#api/v1/routers/nutribot.mjs';
import { createNutribotServices } from '../bootstrap.mjs';
import { DailyReportImage } from '#apps/nutribot/DailyReportImage.mjs';
import { NutribotApiService } from '#apps/nutribot/NutribotApiService.mjs';
import { InMemoryRequestDeduplicationStore } from '#adapters/http/InMemoryRequestDeduplicationStore.mjs';

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
    userResolver,
    userIdentityService,
    config: nutribotServices.nutribotContainer.getConfig?.(),
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

  // Web adapter — captures responses instead of sending via Telegram
  const webNutribotAdapter = new WebNutribotAdapter({ inputRouter, logger });

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
