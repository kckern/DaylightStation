// backend/src/5_composition/modules/nutribotApi.mjs
// Composition wiring for Nutribot API router(s). Extracted from bootstrap.mjs (Task P2.7-E).

import { WebNutribotAdapter } from '#adapters/nutribot/WebNutribotAdapter.mjs';
import { NutribotInputRouter } from '#adapters/nutribot/index.mjs';
import { TelegramWebhookParser } from '#adapters/telegram/TelegramWebhookParser.mjs';
import { createBotWebhookHandler } from '#adapters/telegram/createBotWebhookHandler.mjs';
import { createNutribotRouter } from '#api/v1/routers/nutribot.mjs';
import { createNutribotServices } from '../bootstrap.mjs';

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
    logger = console
  } = config;

  // Create webhook parser and input router
  const webhookParser = botId ? new TelegramWebhookParser({ botId, logger }) : null;
  const inputRouter = new NutribotInputRouter(nutribotServices.nutribotContainer, {
    userResolver,
    userIdentityService,
    config: nutribotServices.nutribotContainer.getConfig?.(),
    logger,
  });

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

  const router = createNutribotRouter(nutribotServices.nutribotContainer, {
    webhookHandler,
    telegramIdentityAdapter,
    defaultMember: config.defaultMember,
    botId,
    secretToken,
    gateway,
    logger
  });

  return { router, webNutribotAdapter };
}
