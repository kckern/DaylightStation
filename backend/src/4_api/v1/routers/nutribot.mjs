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

// Shared Telegram handler factory
import { createBotWebhookHandler } from '../../2_adapters/telegram/index.mjs';

// HTTP middleware
import {
  tracingMiddleware,
  webhookValidationMiddleware,
  idempotencyMiddleware,
  errorHandlerMiddleware,
  requestLoggerMiddleware,
  asyncHandler,
} from '../../0_system/http/middleware/index.mjs';

/**
 * Create NutriBot Express Router
 * @param {import('../../3_applications/nutribot/NutribotContainer.mjs').NutribotContainer} container
 * @param {Object} [options]
 * @param {Object} [options.webhookParser] - Pre-built TelegramWebhookParser instance
 * @param {Object} [options.inputRouter] - Pre-built NutribotInputRouter instance
 * @param {string} [options.botId] - Telegram bot ID
 * @param {string} [options.secretToken] - X-Telegram-Bot-Api-Secret-Token for webhook auth
 * @param {Object} [options.gateway] - TelegramAdapter for callback acknowledgements
 * @param {Object} [options.logger] - Logger instance
 * @returns {Router}
 */
export function createNutribotRouter(container, options = {}) {
  const router = Router();
  const { webhookParser, inputRouter, botId, secretToken, gateway, logger = console } = options;

  // Use injected webhook components
  const parser = webhookParser;
  const router_ = inputRouter;

  // Apply middleware
  router.use(tracingMiddleware());
  router.use(requestLoggerMiddleware({ logBody: false }));

  // Webhook endpoint using shared handler
  if (parser && router_) {
    router.post(
      '/webhook',
      webhookValidationMiddleware('nutribot', { secretToken }),
      idempotencyMiddleware({ ttlMs: 300000 }),
      createBotWebhookHandler({
        botName: 'nutribot',
        botId,
        parser,
        inputRouter: router_,
        gateway,
        logger,
      }),
    );
  } else {
    logger.warn?.('nutribot.webhook.disabled', { reason: 'No parser or inputRouter configured' });
  }

  // Direct input endpoints (programmatic API access)
  router.all('/upc', asyncHandler(directUPCHandler(container, { logger })));
  router.all('/image', asyncHandler(directImageHandler(container, { logger })));
  router.all('/text', asyncHandler(directTextHandler(container, { logger })));

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
