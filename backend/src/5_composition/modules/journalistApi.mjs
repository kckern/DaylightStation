// backend/src/5_composition/modules/journalistApi.mjs
// Composition wiring for Journalist API router(s). Extracted from bootstrap.mjs (Task P2.7-E).

import { JournalistInputRouter } from '#adapters/journalist/JournalistInputRouter.mjs';
import { TelegramWebhookParser } from '#adapters/telegram/TelegramWebhookParser.mjs';
import { createBotWebhookHandler } from '#adapters/telegram/createBotWebhookHandler.mjs';
import { createJournalistRouter } from '#api/v1/routers/journalist.mjs';
import { createJournalistServices } from '../bootstrap.mjs';

/**
 * Create journalist API router
 * @param {Object} config
 * @param {Object} config.journalistServices - Services from createJournalistServices
 * @param {Object} config.configService - ConfigService for user lookup
 * @param {Object} [config.userResolver] - UserResolver for platform ID mapping
 * @param {Object} [config.secretToken] - Telegram webhook secret token
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createJournalistApiRouter(config) {
  const {
    journalistServices,
    configService,
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
  const inputRouter = new JournalistInputRouter(journalistServices.journalistContainer, { userResolver, userIdentityService, logger });

  // Build webhook handler (adapter layer concern, not API layer)
  const webhookHandler = (webhookParser && inputRouter)
    ? createBotWebhookHandler({
        botName: 'journalist',
        botId,
        parser: webhookParser,
        inputRouter,
        gateway,
        logger,
      })
    : null;

  return createJournalistRouter(journalistServices.journalistContainer, {
    webhookHandler,
    telegramIdentityAdapter,
    botId,
    secretToken,
    gateway,
    configService,
    logger
  });
}
