// backend/src/4_api/routers/homebot.mjs

import { Router } from 'express';

// Shared Telegram adapters
import { TelegramWebhookParser, createBotWebhookHandler } from '../../2_adapters/telegram/index.mjs';
import { HomeBotInputRouter } from '../../2_adapters/homebot/HomeBotInputRouter.mjs';

// HTTP middleware
import {
  webhookValidationMiddleware,
  idempotencyMiddleware,
  errorHandlerMiddleware,
} from '../../0_system/http/middleware/index.mjs';

/**
 * Create Homebot Express Router
 * @param {import('../../3_applications/homebot/HomeBotContainer.mjs').HomeBotContainer} container
 * @param {Object} [options]
 * @param {import('../../0_system/users/UserResolver.mjs').UserResolver} [options.userResolver] - For resolving platform users to system usernames
 * @param {string} [options.botId] - Telegram bot ID
 * @param {string} [options.secretToken] - X-Telegram-Bot-Api-Secret-Token for webhook auth
 * @param {Object} [options.gateway] - TelegramAdapter for callback acknowledgements
 * @param {Object} [options.logger] - Logger instance
 * @returns {Router}
 */
export function createHomebotRouter(container, options = {}) {
  const router = Router();
  const { userResolver, botId, secretToken, gateway, logger = console } = options;

  // Create webhook components
  const parser = botId ? new TelegramWebhookParser({ botId, logger }) : null;
  const inputRouter = new HomeBotInputRouter(container, { userResolver, logger });

  // Webhook endpoint using shared handler
  if (parser) {
    router.post(
      '/webhook',
      webhookValidationMiddleware('homebot', { secretToken }),
      idempotencyMiddleware({ ttlMs: 300000 }),
      createBotWebhookHandler({
        botName: 'homebot',
        botId,
        parser,
        inputRouter,
        gateway,
        logger,
      }),
    );
  } else {
    logger.warn?.('homebot.webhook.disabled', { reason: 'No botId configured' });
  }

  // Health check endpoint
  router.get('/health', (req, res) => {
    res.json({ status: 'ok', bot: 'homebot' });
  });

  // Apply error handler
  router.use(errorHandlerMiddleware({ isWebhook: false }));

  return router;
}

export default createHomebotRouter;
