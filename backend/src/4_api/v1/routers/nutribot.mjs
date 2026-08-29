/**
 * NutriBot API Router
 * @module nutribot/router
 *
 * Express router for NutriBot endpoints.
 * Provides Telegram webhook and direct API access.
 */

import { Router } from 'express';
import { nutribotReportHandler } from '../handlers/nutribot/report.mjs';
import { nutribotReportImgHandler } from '../handlers/nutribot/reportImg.mjs';
import { directUPCHandler, directImageHandler, directTextHandler } from '../handlers/nutribot/directInput.mjs';

// HTTP middleware
import {
  tracingMiddleware,
  errorHandlerMiddleware,
  asyncHandler,
} from '#system/http/middleware/index.mjs';
import { webhookValidationMiddleware } from '../middleware/messagingWebhookValidation.mjs';
import { idempotencyMiddleware } from '../middleware/messagingWebhookIdempotency.mjs';

/**
 * Create NutriBot Express Router
 * @param {Object} nutribotApi - Semantic direct-input and report service
 * @param {Object} [options]
 * @param {Function} [options.webhookHandler] - Pre-built Telegram webhook handler
 * @param {string} [options.botId] - Telegram bot ID
 * @param {string} [options.secretToken] - X-Telegram-Bot-Api-Secret-Token for webhook auth
 * @param {Object} [options.logger] - Logger instance
 * @returns {Router}
 */
export function createNutribotRouter(nutribotApi, options = {}) {
  const router = Router();
  const { webhookHandler, dailyReportImage, botId, secretToken, idempotencyStore, logger = console } = options;

  // Apply middleware
  router.use(tracingMiddleware());
  // No requestLoggerMiddleware here any more: it is mounted globally on
  // /api/v1 in app.mjs, and a second mount would log every nutribot request
  // twice into a size-capped sink.

  // Webhook endpoint using pre-built handler
  if (webhookHandler) {
    router.post(
      '/webhook',
      webhookValidationMiddleware('nutribot', { secretToken }),
      idempotencyMiddleware({ ttlMs: 300000, store: idempotencyStore }),
      webhookHandler,
    );
  } else {
    logger.warn?.('nutribot.webhook.disabled', { reason: 'No webhookHandler configured' });
  }

  // Direct input endpoints (programmatic API access)
  const handlerOpts = { logger };
  router.all('/upc', asyncHandler(directUPCHandler(nutribotApi, handlerOpts)));
  router.all('/image', asyncHandler(directImageHandler(nutribotApi, handlerOpts)));
  router.all('/text', asyncHandler(directTextHandler(nutribotApi, handlerOpts)));

  // Pinhole endpoint - public access for IFTTT/external integrations
  // Uses same handler as /image, but with dedicated Cloudflare Access bypass
  router.all('/pinhole', asyncHandler(directImageHandler(nutribotApi, handlerOpts)));

  // Report endpoints
  router.get('/report', asyncHandler(nutribotReportHandler(nutribotApi, { logger })));
  router.get('/report.png', asyncHandler(nutribotReportImgHandler(dailyReportImage, { logger })));

  // Health check endpoint
  router.get('/health', (req, res) => {
    res.json({ status: 'ok', bot: 'nutribot' });
  });

  // Apply error handler
  router.use(errorHandlerMiddleware({ isWebhook: false }));

  return router;
}

export default createNutribotRouter;
