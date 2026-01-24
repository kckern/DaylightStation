// backend/src/4_api/routers/homebot.mjs

import { Router } from 'express';
import { HomeBotInputRouter } from '../../2_adapters/homebot/HomeBotInputRouter.mjs';
import {
  webhookValidationMiddleware as defaultWebhookValidation,
  idempotencyMiddleware as defaultIdempotency,
  asyncHandler,
} from '../../0_infrastructure/http/middleware/index.mjs';

/**
 * Create Homebot Express Router
 * @param {import('../../3_applications/homebot/HomeBotContainer.mjs').HomeBotContainer} container
 * @param {Object} [options]
 * @param {string} [options.botId] - Telegram bot ID
 * @param {string} [options.secretToken] - X-Telegram-Bot-Api-Secret-Token for webhook auth
 * @param {Object} [options.gateway] - TelegramAdapter for callback acknowledgements
 * @param {Function} [options.createTelegramWebhookHandler] - Webhook handler factory
 * @param {Object} [options.middleware] - Middleware functions
 * @returns {Router}
 */
export function createHomebotRouter(container, options = {}) {
  const router = Router();

  const {
    botId,
    secretToken,
    gateway,
    createTelegramWebhookHandler,
    middleware = {}
  } = options;

  // Get middleware functions with defaults
  const {
    tracingMiddleware = () => (req, res, next) => next(),
    requestLoggerMiddleware = () => (req, res, next) => next(),
    errorHandlerMiddleware = () => (err, req, res, next) => {
      res.status(500).json({ error: err.message });
    }
  } = middleware;

  // Apply middleware
  router.use(tracingMiddleware());
  router.use(requestLoggerMiddleware({ logBody: false }));

  // Webhook endpoint
  if (createTelegramWebhookHandler) {
    const webhookHandler = createTelegramWebhookHandler(
      container,
      { botId, botName: 'homebot' },
      {
        gateway,
        RouterClass: HomeBotInputRouter
      }
    );

    router.post(
      '/webhook',
      defaultWebhookValidation('homebot', { secretToken }),
      defaultIdempotency({ ttlMs: 300000 }),
      asyncHandler(webhookHandler)
    );
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
