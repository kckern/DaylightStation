/**
 * Journalist Server/Router
 * @module api/routers/journalist
 *
 * Express router for Journalist endpoints.
 */

import { Router } from 'express';

// API handlers
import {
  journalistJournalHandler,
  journalistTriggerHandler,
  journalistMorningDebriefHandler,
} from '../handlers/journalist/index.mjs';

// HTTP middleware
import {
  webhookValidationMiddleware,
  idempotencyMiddleware,
  asyncHandler,
  errorHandlerMiddleware,
} from '../../0_system/http/middleware/index.mjs';

/**
 * Create Journalist Express Router
 * @param {import('../../3_applications/journalist/JournalistContainer.mjs').JournalistContainer} container
 * @param {Object} [options]
 * @param {Function} [options.webhookHandler] - Pre-built Telegram webhook handler
 * @param {string} [options.botId] - Telegram bot ID
 * @param {string} [options.secretToken] - X-Telegram-Bot-Api-Secret-Token for webhook auth
 * @param {Object} [options.gateway] - TelegramAdapter for callback acknowledgements
 * @param {Object} [options.configService] - Config service for user resolution
 * @param {Object} [options.logger] - Logger instance
 * @returns {Router}
 */
export function createJournalistRouter(container, options = {}) {
  const router = Router();
  const { webhookHandler, botId, secretToken, gateway, configService, logger = console } = options;

  // Webhook endpoint using pre-built handler
  if (webhookHandler) {
    router.post(
      '/webhook',
      webhookValidationMiddleware('journalist', { secretToken }),
      idempotencyMiddleware({ ttlMs: 300000 }),
      webhookHandler,
    );
  } else {
    logger.warn?.('journalist.webhook.disabled', { reason: 'No webhookHandler configured' });
  }

  // Journal export endpoint
  router.get('/journal', asyncHandler(journalistJournalHandler(container)));

  // Trigger endpoint
  router.get('/trigger', asyncHandler(journalistTriggerHandler(container)));

  // Morning debrief endpoint (triggered by cron or manual)
  router.get(
    '/morning',
    asyncHandler(journalistMorningDebriefHandler(container, { configService, logger })),
  );

  // Health check endpoint
  router.get('/health', (req, res) => {
    res.json({ status: 'ok', bot: 'journalist' });
  });

  // Apply error handler
  router.use(errorHandlerMiddleware({ isWebhook: false }));

  return router;
}

export default createJournalistRouter;
