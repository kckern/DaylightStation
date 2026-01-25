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

// Shared Telegram adapters
import { TelegramWebhookParser, createBotWebhookHandler } from '../../2_adapters/telegram/index.mjs';
import { NutribotInputRouter } from '../../2_adapters/nutribot/index.mjs';

// HTTP middleware
import {
  tracingMiddleware,
  webhookValidationMiddleware,
  idempotencyMiddleware,
  errorHandlerMiddleware,
  requestLoggerMiddleware,
  asyncHandler,
} from '../../0_infrastructure/http/middleware/index.mjs';

/**
 * Create NutriBot Express Router
 * @param {import('../../3_applications/nutribot/NutribotContainer.mjs').NutribotContainer} container
 * @param {Object} [options]
 * @param {import('../../0_infrastructure/users/UserResolver.mjs').UserResolver} [options.userResolver] - For resolving platform users to system usernames
 * @param {string} [options.botId] - Telegram bot ID
 * @param {string} [options.secretToken] - X-Telegram-Bot-Api-Secret-Token for webhook auth
 * @param {Object} [options.gateway] - TelegramAdapter for callback acknowledgements
 * @param {Object} [options.logger] - Logger instance
 * @returns {Router}
 */
export function createNutribotRouter(container, options = {}) {
  const router = Router();
  const { userResolver, secretToken, gateway, logger = console } = options;

  // Get botId from options, container config, or environment
  const botId =
    options.botId || container.getConfig?.()?.telegram?.botId || process.env.NUTRIBOT_TELEGRAM_BOT_ID;

  // Create webhook components
  const parser = botId ? new TelegramWebhookParser({ botId, logger }) : null;
  const inputRouter = new NutribotInputRouter(container, {
    userResolver,
    config: container.getConfig?.(),
    logger,
  });

  // Apply middleware
  router.use(tracingMiddleware());
  router.use(requestLoggerMiddleware({ logBody: false }));

  // Webhook endpoint using shared handler
  if (parser) {
    router.post(
      '/webhook',
      webhookValidationMiddleware('nutribot', { secretToken }),
      idempotencyMiddleware({ ttlMs: 300000 }),
      createBotWebhookHandler({
        botName: 'nutribot',
        botId,
        parser,
        inputRouter,
        gateway,
        logger,
      }),
    );
  } else {
    logger.warn?.('nutribot.webhook.disabled', { reason: 'No botId configured' });
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
