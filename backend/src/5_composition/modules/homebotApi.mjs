// backend/src/5_composition/modules/homebotApi.mjs
// Composition wiring for Homebot API router(s). Extracted from bootstrap.mjs (Task P2.7-E).

import { HomeBotInputRouter } from '#adapters/homebot/index.mjs';
import { TelegramAdapter } from '#adapters/messaging/TelegramAdapter.mjs';
import { TelegramWebhookParser } from '#adapters/telegram/TelegramWebhookParser.mjs';
import { createBotWebhookHandler } from '#adapters/telegram/createBotWebhookHandler.mjs';
import { createHomebotRouter } from '#api/v1/routers/homebot.mjs';
import { createHomebotServices } from '../bootstrap.mjs';

/**
 * Create homebot API router
 * @param {Object} config
 * @param {Object} config.homebotServices - Services from createHomebotServices
 * @param {Object} [config.userResolver] - UserResolver for platform ID mapping
 * @param {string} [config.botId] - Telegram bot ID
 * @param {string} [config.secretToken] - X-Telegram-Bot-Api-Secret-Token for webhook auth
 * @param {Object} [config.gateway] - TelegramAdapter for callback acknowledgements
 * @param {Function} [config.createTelegramWebhookHandler] - Webhook handler factory
 * @param {Object} [config.middleware] - Middleware functions
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createHomebotApiRouter(config) {
  const {
    homebotServices,
    userResolver,
    userIdentityService,
    telegramIdentityAdapter,
    botId,
    secretToken,
    gateway,
    createTelegramWebhookHandler,
    middleware,
    logger = console
  } = config;

  // Create webhook parser and input router
  const webhookParser = botId ? new TelegramWebhookParser({ botId, logger }) : null;
  const inputRouter = new HomeBotInputRouter(homebotServices.homebotContainer, { userResolver, userIdentityService, logger });

  // Build webhook handler (adapter layer concern, not API layer)
  const webhookHandler = (webhookParser && inputRouter)
    ? createBotWebhookHandler({
        botName: 'homebot',
        botId,
        parser: webhookParser,
        inputRouter,
        gateway,
        logger,
      })
    : null;

  return createHomebotRouter(homebotServices.homebotContainer, {
    webhookHandler,
    telegramIdentityAdapter,
    botId,
    secretToken,
    gateway,
    createTelegramWebhookHandler,
    middleware,
    logger
  });
}
