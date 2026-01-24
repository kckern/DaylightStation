// backend/src/4_api/routers/homebot.mjs

import { Router } from 'express';
import { HomeBotInputRouter } from '../../2_adapters/homebot/HomeBotInputRouter.mjs';

/**
 * Async handler wrapper
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Create Homebot Express Router
 * @param {import('../../3_applications/homebot/HomeBotContainer.mjs').HomeBotContainer} container
 * @param {Object} [options]
 * @param {string} [options.botId] - Telegram bot ID
 * @param {Object} [options.gateway] - TelegramAdapter for callback acknowledgements
 * @param {Function} [options.createTelegramWebhookHandler] - Webhook handler factory
 * @param {Object} [options.middleware] - Middleware functions
 * @returns {Router}
 */
export function createHomebotRouter(container, options = {}) {
  const router = Router();

  const {
    botId,
    gateway,
    createTelegramWebhookHandler,
    middleware = {}
  } = options;

  // Get middleware functions with defaults
  const {
    tracingMiddleware = () => (req, res, next) => next(),
    requestLoggerMiddleware = () => (req, res, next) => next(),
    webhookValidationMiddleware = () => (req, res, next) => next(),
    idempotencyMiddleware = () => (req, res, next) => next(),
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
      webhookValidationMiddleware('homebot'),
      idempotencyMiddleware({ ttlMs: 300000 }),
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
