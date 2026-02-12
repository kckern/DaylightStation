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
  webhookValidationMiddleware,
  idempotencyMiddleware,
  errorHandlerMiddleware,
  requestLoggerMiddleware,
  asyncHandler,
} from '#system/http/middleware/index.mjs';

/**
 * Create NutriBot Express Router
 * @param {import('../../3_applications/nutribot/NutribotContainer.mjs').NutribotContainer} container
 * @param {Object} [options]
 * @param {Function} [options.webhookHandler] - Pre-built Telegram webhook handler
 * @param {string} [options.botId] - Telegram bot ID
 * @param {string} [options.secretToken] - X-Telegram-Bot-Api-Secret-Token for webhook auth
 * @param {Object} [options.gateway] - TelegramAdapter for callback acknowledgements
 * @param {Object} [options.logger] - Logger instance
 * @returns {Router}
 */
export function createNutribotRouter(container, options = {}) {
  const router = Router();
  const { webhookHandler, telegramIdentityAdapter, defaultMember, botId, secretToken, gateway, logger = console } = options;

  // Apply middleware
  router.use(tracingMiddleware());
  router.use(requestLoggerMiddleware({ logBody: false }));

  // Webhook endpoint using pre-built handler
  if (webhookHandler) {
    router.post(
      '/webhook',
      webhookValidationMiddleware('nutribot', { secretToken }),
      idempotencyMiddleware({ ttlMs: 300000 }),
      webhookHandler,
    );
  } else {
    logger.warn?.('nutribot.webhook.disabled', { reason: 'No webhookHandler configured' });
  }

  // Direct input endpoints (programmatic API access)
  const handlerOpts = { logger, identityAdapter: telegramIdentityAdapter, defaultMember };
  router.all('/upc', asyncHandler(directUPCHandler(container, handlerOpts)));
  router.all('/image', asyncHandler(directImageHandler(container, handlerOpts)));
  router.all('/text', asyncHandler(directTextHandler(container, handlerOpts)));

  // Pinhole endpoint - public access for IFTTT/external integrations
  // Uses same handler as /image, but with dedicated Cloudflare Access bypass
  router.all('/pinhole', asyncHandler(directImageHandler(container, handlerOpts)));

  // Report endpoints
  router.get('/report', asyncHandler(nutribotReportHandler(container, { logger })));
  router.get('/report.png', asyncHandler(nutribotReportImgHandler(container, { logger })));

  // Health check endpoint
  router.get('/health', (req, res) => {
    res.json({ status: 'ok', bot: 'nutribot' });
  });

  // Apply error handler
  router.use(errorHandlerMiddleware({ isWebhook: false }));

  return router;
}

export default createNutribotRouter;
