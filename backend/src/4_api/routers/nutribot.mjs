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

// DDD adapters for webhook handling
import { TelegramWebhookParser } from '../../2_adapters/telegram/TelegramWebhookParser.mjs';
import { WebhookHandler } from '../../3_applications/nutribot/handlers/WebhookHandler.mjs';

// Middleware (still using legacy until fully migrated)
import {
  tracingMiddleware,
  webhookValidationMiddleware,
  idempotencyMiddleware,
  errorHandlerMiddleware,
  requestLoggerMiddleware,
  asyncHandler,
} from '../../../_legacy/chatbots/adapters/http/middleware/index.mjs';

/**
 * Create NutriBot Express Router
 * @param {import('../../3_applications/nutribot/NutribotContainer.mjs').NutribotContainer} container
 * @param {Object} [options]
 * @param {string} [options.botId] - Telegram bot ID (defaults to env var or config)
 * @param {Object} [options.gateway] - TelegramGateway for callback acknowledgements (deprecated)
 * @param {Object} [options.webhookParser] - TelegramWebhookParser instance (DDD)
 * @param {Object} [options.webhookHandler] - WebhookHandler instance (DDD)
 * @param {Object} [options.logger] - Logger instance
 * @returns {Router}
 */
export function createNutribotRouter(container, options = {}) {
  const router = Router();
  const logger = options.logger || console;

  // Get botId from options, container config, or environment
  const botId =
    options.botId || container.getConfig?.()?.telegram?.botId || process.env.NUTRIBOT_TELEGRAM_BOT_ID || '6898194425';

  // Use injected DDD components or create them
  const webhookParser = options.webhookParser || new TelegramWebhookParser({ botId, logger });
  const webhookHandler = options.webhookHandler || new WebhookHandler({
    container,
    nutribotConfig: container.getConfig?.(),
    logger
  });

  // Apply middleware
  router.use(tracingMiddleware());
  router.use(requestLoggerMiddleware({ logBody: false }));

  // Webhook endpoint using DDD pattern
  router.post(
    '/webhook',
    webhookValidationMiddleware('nutribot'),
    idempotencyMiddleware({ ttlMs: 300000 }),
    asyncHandler(async (req, res) => {
      try {
        // Parse Telegram update into normalized input
        const input = webhookParser.parse(req.body);
        if (!input) {
          // Acknowledge unknown update types gracefully
          logger.debug?.('nutribot.webhook.unsupported', { updateKeys: Object.keys(req.body) });
          return res.sendStatus(200);
        }

        // Route to use cases via handler
        await webhookHandler.handle(input);

        res.sendStatus(200);
      } catch (error) {
        logger.error?.('nutribot.webhook.error', { error: error.message, stack: error.stack });
        // Always return 200 to Telegram to prevent retry loops
        res.sendStatus(200);
      }
    })
  );

  // Direct input endpoints (programmatic API access)
  router.all('/upc', asyncHandler(directUPCHandler(container, { logger })));
  router.all('/image', asyncHandler(directImageHandler(container, { logger })));
  router.all('/text', asyncHandler(directTextHandler(container, { logger })));

  // Report endpoints (no webhook middleware needed)
  router.get('/report', asyncHandler(nutribotReportHandler(container, { logger })));
  router.get('/report.png', asyncHandler(nutribotReportImgHandler(container, { logger })));

  // Apply error handler
  router.use(errorHandlerMiddleware({ isWebhook: false }));

  return router;
}

export default createNutribotRouter;
