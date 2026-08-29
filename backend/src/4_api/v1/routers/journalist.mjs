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
import { asyncHandler, errorHandlerMiddleware } from '#system/http/middleware/index.mjs';
import { webhookValidationMiddleware } from '../middleware/messagingWebhookValidation.mjs';
import { idempotencyMiddleware } from '../middleware/messagingWebhookIdempotency.mjs';

/**
 * Create Journalist Express Router
 * @param {Object} journalistApi - Semantic Journalist service
 * @param {Object} [options]
 * @param {Function} [options.webhookHandler] - Pre-built Telegram webhook handler
 * @param {string} [options.botId] - Telegram bot ID
 * @param {string} [options.secretToken] - X-Telegram-Bot-Api-Secret-Token for webhook auth
 * @param {Object} [options.logger] - Logger instance
 * @returns {Router}
 */
export function createJournalistRouter(journalistApi, options = {}) {
  const router = Router();
  const { webhookHandler, botId, secretToken, gateway, idempotencyStore, logger = console } = options;

  // Webhook endpoint using pre-built handler
  if (webhookHandler) {
    router.post(
      '/webhook',
      webhookValidationMiddleware('journalist', { secretToken }),
      idempotencyMiddleware({ ttlMs: 300000, store: idempotencyStore }),
      webhookHandler,
    );
  } else {
    logger.warn?.('journalist.webhook.disabled', { reason: 'No webhookHandler configured' });
  }

  // Journal export endpoint
  router.get('/journal', asyncHandler(journalistJournalHandler(journalistApi)));

  // Trigger endpoint
  router.get('/trigger', asyncHandler(journalistTriggerHandler(journalistApi)));

  // Morning debrief endpoint (triggered by cron or manual)
  router.get(
    '/morning',
    asyncHandler(journalistMorningDebriefHandler(journalistApi, { logger })),
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
