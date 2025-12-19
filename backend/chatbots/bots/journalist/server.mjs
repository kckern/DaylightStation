/**
 * Journalist Server/Router
 * @module journalist/server
 * 
 * Express router for Journalist endpoints.
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
import { JournalistInputRouter } from './adapters/JournalistInputRouter.mjs';
import { journalistJournalHandler } from './handlers/journal.mjs';
import { journalistTriggerHandler } from './handlers/trigger.mjs';

/**
 * Create Journalist Express Router
 * @param {import('./container.mjs').JournalistContainer} container
 * @param {Object} [options]
 * @param {string} [options.botId] - Telegram bot ID
 * @param {Object} [options.gateway] - TelegramGateway for callback acknowledgements
 * @returns {Router}
 */
export function createJournalistRouter(container, options = {}) {
  const router = Router();

  // Get botId from options, container config, or environment
  const botId = options.botId 
    || container.getConfig?.()?.telegram?.botId 
    || process.env.JOURNALIST_TELEGRAM_BOT_ID
    || process.env.TELEGRAM_BOT_ID;

  // Create webhook handler using unified pattern with Journalist-specific router
  const webhookHandler = createTelegramWebhookHandler(
    container,
    { botId, botName: 'journalist' },
    { 
      gateway: options.gateway,
      RouterClass: JournalistInputRouter,
    }
  );

  // Apply middleware
  router.use(tracingMiddleware());
  router.use(requestLoggerMiddleware({ logBody: false }));

  // Webhook endpoint with validation and idempotency
  router.post(
    '/webhook',
    webhookValidationMiddleware('journalist'),
    idempotencyMiddleware({ ttlMs: 300000 }),
    asyncHandler(webhookHandler)
  );

  // Journal export endpoint
  router.get('/journal', asyncHandler(journalistJournalHandler(container)));

  // Trigger endpoint
  router.get('/trigger', asyncHandler(journalistTriggerHandler(container)));

  // Apply error handler
  router.use(errorHandlerMiddleware({ isWebhook: false }));

  return router;
}

export default createJournalistRouter;
