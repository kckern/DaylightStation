// backend/src/4_api/routers/homebot.mjs

import { Router } from 'express';

// HTTP middleware
import { errorHandlerMiddleware } from '#system/http/middleware/index.mjs';
import { webhookValidationMiddleware } from '../middleware/messagingWebhookValidation.mjs';
import { idempotencyMiddleware } from '../middleware/messagingWebhookIdempotency.mjs';

/**
 * Create Homebot Express Router
 * @param {Object} [options]
 * @param {Function} [options.webhookHandler] - Pre-built Telegram webhook handler
 * @param {string} [options.botId] - Telegram bot ID
 * @param {string} [options.secretToken] - X-Telegram-Bot-Api-Secret-Token for webhook auth
 * @param {Object} [options.logger] - Logger instance
 * @returns {Router}
 */
export function createHomebotRouter(options = {}) {
  const router = Router();
  const { webhookHandler, botId, secretToken, idempotencyStore, logger = console } = options;

  // Webhook endpoint using pre-built handler
  if (webhookHandler) {
    router.post(
      '/webhook',
      webhookValidationMiddleware('homebot', { secretToken }),
      idempotencyMiddleware({ ttlMs: 300000, store: idempotencyStore }),
      webhookHandler,
    );
  } else {
    logger.warn?.('homebot.webhook.disabled', { reason: 'No webhookHandler configured' });
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
