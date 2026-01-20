/**
 * NutriBot Server/Router
 * @module nutribot/server
 * 
 * Express router for NutriBot endpoints.
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
import { nutribotReportHandler } from './handlers/report.mjs';
import { nutribotReportImgHandler } from './handlers/reportImg.mjs';
import { directUPCHandler, directImageHandler, directTextHandler } from './handlers/directInput.mjs';

/**
 * Create NutriBot Express Router
 * @param {import('./container.mjs').NutribotContainer} container
 * @param {Object} [options]
 * @param {string} [options.botId] - Telegram bot ID (defaults to env var or config)
 * @param {Object} [options.gateway] - TelegramGateway for callback acknowledgements
 * @returns {Router}
 */
export function createNutribotRouter(container, options = {}) {
  const router = Router();

  // Get botId from options, container config, or environment
  const botId = options.botId 
    || container.getConfig?.()?.telegram?.botId 
    || process.env.NUTRIBOT_TELEGRAM_BOT_ID 
    || '6898194425';

  // Create webhook handler using the unified pattern
  const webhookHandler = createTelegramWebhookHandler(
    container,
    { botId, botName: 'nutribot' },
    { gateway: options.gateway }
  );

  // Apply middleware
  router.use(tracingMiddleware());
  router.use(requestLoggerMiddleware({ logBody: false }));

  // Webhook endpoint with validation and idempotency
  router.post(
    '/webhook',
    webhookValidationMiddleware('nutribot'),
    idempotencyMiddleware({ ttlMs: 300000 }),
    asyncHandler(webhookHandler)
  );

  // Direct input endpoints (programmatic API access)
  router.all('/upc', asyncHandler(directUPCHandler(container)));
  router.all('/image', asyncHandler(directImageHandler(container)));
  router.all('/text', asyncHandler(directTextHandler(container)));

  // Report endpoints (no webhook middleware needed)
  router.get('/report', asyncHandler(nutribotReportHandler(container)));
  router.get('/report.png', asyncHandler(nutribotReportImgHandler(container)));

  // Apply error handler
  router.use(errorHandlerMiddleware({ isWebhook: false }));

  return router;
}

export default createNutribotRouter;
