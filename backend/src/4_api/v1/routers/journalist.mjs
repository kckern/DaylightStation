/**
 * Journalist Server/Router
 * @module api/routers/journalist
 *
 * Express router for Journalist endpoints.
 */

import { Router } from 'express';

// Shared Telegram handler factory
import { createBotWebhookHandler } from '../../2_adapters/telegram/index.mjs';

// API handlers
import {
  journalistJournalHandler,
  journalistTriggerHandler,
  handleMorningDebrief,
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
 * @param {Object} [options.webhookParser] - Pre-built TelegramWebhookParser instance
 * @param {Object} [options.inputRouter] - Pre-built JournalistInputRouter instance
 * @param {string} [options.botId] - Telegram bot ID
 * @param {string} [options.secretToken] - X-Telegram-Bot-Api-Secret-Token for webhook auth
 * @param {Object} [options.gateway] - TelegramAdapter for callback acknowledgements
 * @param {Object} [options.configService] - Config service for user resolution
 * @param {Object} [options.logger] - Logger instance
 * @returns {Router}
 */
export function createJournalistRouter(container, options = {}) {
  const router = Router();
  const { webhookParser, inputRouter, botId, secretToken, gateway, configService, logger = console } = options;

  // Use injected webhook components
  const parser = webhookParser;
  const router_ = inputRouter;

  // Webhook endpoint using shared handler
  if (parser && router_) {
    router.post(
      '/webhook',
      webhookValidationMiddleware('journalist', { secretToken }),
      idempotencyMiddleware({ ttlMs: 300000 }),
      createBotWebhookHandler({
        botName: 'journalist',
        botId,
        parser,
        inputRouter: router_,
        gateway,
        logger,
      }),
    );
  } else {
    logger.warn?.('journalist.webhook.disabled', { reason: 'No parser or inputRouter configured' });
  }

  // Journal export endpoint
  router.get('/journal', asyncHandler(journalistJournalHandler(container)));

  // Trigger endpoint
  router.get('/trigger', asyncHandler(journalistTriggerHandler(container)));

  // Morning debrief endpoint (triggered by cron or manual)
  router.get(
    '/morning',
    asyncHandler(async (req, res) => {
      const username = req.query.user || configService?.getHeadOfHousehold?.() || 'kckern';
      const date = req.query.date || null;

      if (!username) {
        return res.status(400).json({
          success: false,
          error: 'No username specified and no default user configured',
        });
      }

      const userResolver = container.getUserResolver?.() || null;

      const result = await handleMorningDebrief(
        {
          generateMorningDebrief: container.getGenerateMorningDebrief(),
          sendMorningDebrief: container.getSendMorningDebrief(),
          userResolver,
        },
        username,
        date,
      );

      return res.status(result.success ? 200 : 500).json(result);
    }),
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
