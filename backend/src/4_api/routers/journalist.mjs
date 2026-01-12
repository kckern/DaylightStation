/**
 * Journalist Server/Router
 * @module api/routers/journalist
 *
 * Express router for Journalist endpoints.
 */

import { Router } from 'express';
import { JournalistInputRouter } from '../../2_adapters/journalist/JournalistInputRouter.mjs';
import {
  journalistJournalHandler,
  journalistTriggerHandler,
  handleMorningDebrief,
} from '../handlers/journalist/index.mjs';

/**
 * Async handler wrapper
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Create Journalist Express Router
 * @param {import('../../3_applications/journalist/JournalistContainer.mjs').JournalistContainer} container
 * @param {Object} [options]
 * @param {string} [options.botId] - Telegram bot ID
 * @param {Object} [options.gateway] - TelegramGateway for callback acknowledgements
 * @param {Function} [options.createTelegramWebhookHandler] - Webhook handler factory
 * @param {Object} [options.middleware] - Middleware functions
 * @param {Object} [options.configService] - Config service for user resolution
 * @returns {Router}
 */
export function createJournalistRouter(container, options = {}) {
  const router = Router();

  const {
    botId,
    gateway,
    createTelegramWebhookHandler,
    middleware = {},
    configService,
  } = options;

  // Get middleware functions with defaults
  const {
    tracingMiddleware = () => (req, res, next) => next(),
    requestLoggerMiddleware = () => (req, res, next) => next(),
    webhookValidationMiddleware = () => (req, res, next) => next(),
    idempotencyMiddleware = () => (req, res, next) => next(),
    errorHandlerMiddleware = () => (err, req, res, next) => {
      res.status(500).json({ error: err.message });
    },
  } = middleware;

  // Apply middleware
  router.use(tracingMiddleware());
  router.use(requestLoggerMiddleware({ logBody: false }));

  // Webhook endpoint with validation and idempotency (if handler factory provided)
  if (createTelegramWebhookHandler) {
    const webhookHandler = createTelegramWebhookHandler(
      container,
      { botId, botName: 'journalist' },
      {
        gateway,
        RouterClass: JournalistInputRouter,
      },
    );

    router.post(
      '/webhook',
      webhookValidationMiddleware('journalist'),
      idempotencyMiddleware({ ttlMs: 300000 }),
      asyncHandler(webhookHandler),
    );
  }

  // Journal export endpoint
  router.get('/journal', asyncHandler(journalistJournalHandler(container)));

  // Trigger endpoint
  router.get('/trigger', asyncHandler(journalistTriggerHandler(container)));

  // Morning debrief endpoint (triggered by cron or manual)
  router.get(
    '/morning',
    asyncHandler(async (req, res) => {
      const username = req.query.user || configService?.getHeadOfHousehold?.() || 'kckern';
      const date = req.query.date || null; // Optional: specific date (YYYY-MM-DD)

      if (!username) {
        return res.status(400).json({
          success: false,
          error: 'No username specified and no default user configured',
        });
      }

      // Get UserResolver from container (if available)
      const userResolver = container.getUserResolver?.() || null;

      const result = await handleMorningDebrief(
        {
          generateMorningDebrief: container.getGenerateMorningDebrief(),
          sendMorningDebrief: container.getSendMorningDebrief(),
          userResolver,
        },
        username,
        date,
      );

      return res.status(result.success ? 200 : 500).json(result);
    }),
  );

  // Apply error handler
  router.use(errorHandlerMiddleware({ isWebhook: false }));

  return router;
}

export default createJournalistRouter;
