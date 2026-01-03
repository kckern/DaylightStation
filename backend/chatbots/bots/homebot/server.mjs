/**
 * HomeBot Server/Router
 * @module homebot/server
 * 
 * Express router for HomeBot endpoints.
 */

import { Router } from 'express';
import { 
  tracingMiddleware,
  webhookValidationMiddleware,
  idempotencyMiddleware,
  errorHandlerMiddleware,
  requestLoggerMiddleware,
  asyncHandler,
} from '../../adapters/http/middleware/index.mjs';
import { createTelegramWebhookHandler } from '../../adapters/http/TelegramWebhookHandler.mjs';
import { HomeBotEventRouter } from './adapters/HomeBotEventRouter.mjs';

import { defaultLogger as logger } from '../../_lib/logging/Logger.mjs';

/**
 * Create HomeBot Express Router
 * @param {import('./container.mjs').HomeBotContainer} container
 * @param {Object} [options]
 * @param {string} [options.botId] - Telegram bot ID (defaults to env var or config)
 * @param {Object} [options.gateway] - TelegramGateway for callback acknowledgements
 * @returns {Router}
 */
export function createHomeBotRouter(container, options = {}) {
  const router = Router();

  // Get botId from options, container config, or environment
  const botId = options.botId 
    || container.getConfig?.()?.telegram?.botId 
    || process.env.HOMEBOT_TELEGRAM_BOT_ID;

  if (!botId) {
    logger.warn('homebot.bot_id_missing');
  }

  // Create the HomeBot-specific event router
  const eventRouter = new HomeBotEventRouter(container);

  // Create webhook handler using the unified pattern, but with our custom router
  const webhookHandler = createTelegramWebhookHandler(
    container,
    { botId, botName: 'homebot' },
    { 
      gateway: options.gateway,
      RouterClass: function() {
        // Return our custom router wrapped to match expected interface
        return {
          route: (event) => eventRouter.route(event),
        };
      },
    }
  );

  // Apply middleware
  router.use(tracingMiddleware());
  router.use(requestLoggerMiddleware({ logBody: false }));

  // Webhook endpoint with validation and idempotency
  router.post(
    '/webhook',
    webhookValidationMiddleware('homebot'),
    idempotencyMiddleware({ ttlMs: 300000 }),
    asyncHandler(webhookHandler)
  );

  // Health check endpoint
  router.get('/health', (req, res) => {
    res.json({ 
      status: 'ok', 
      bot: 'homebot',
      timestamp: new Date().toISOString(),
    });
  });

  // Apply error handler
  router.use(errorHandlerMiddleware({ isWebhook: false }));

  return router;
}

export default createHomeBotRouter;
