// backend/src/4_api/routers/homebot.mjs

import { Router } from 'express';

// Shared Telegram handler factory
import { createBotWebhookHandler } from '../../2_adapters/telegram/index.mjs';

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
 * @param {Object} [options.webhookParser] - Pre-built TelegramWebhookParser instance
 * @param {Object} [options.inputRouter] - Pre-built HomeBotInputRouter instance
 * @param {string} [options.botId] - Telegram bot ID
 * @param {string} [options.secretToken] - X-Telegram-Bot-Api-Secret-Token for webhook auth
 * @param {Object} [options.gateway] - TelegramAdapter for callback acknowledgements
 * @param {Object} [options.logger] - Logger instance
 * @returns {Router}
 */
export function createHomebotRouter(container, options = {}) {
  const router = Router();
  const { webhookParser, inputRouter, botId, secretToken, gateway, logger = console } = options;

  // Use injected webhook components
  const parser = webhookParser;
  const router_ = inputRouter;

  // Webhook endpoint using shared handler
  if (parser && router_) {
    router.post(
      '/webhook',
      webhookValidationMiddleware('homebot', { secretToken }),
      idempotencyMiddleware({ ttlMs: 300000 }),
      createBotWebhookHandler({
        botName: 'homebot',
        botId,
        parser,
        inputRouter: router_,
        gateway,
        logger,
      }),
    );
  } else {
    logger.warn?.('homebot.webhook.disabled', { reason: 'No parser or inputRouter configured' });
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
