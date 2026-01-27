/**
 * Journalist Server/Router
 * @module api/routers/journalist
 *
 * Express router for Journalist endpoints.
 */

import { Router } from 'express';

// Shared Telegram adapters
import { TelegramWebhookParser, createBotWebhookHandler } from '../../2_adapters/telegram/index.mjs';
import { JournalistInputRouter } from '../../2_adapters/journalist/JournalistInputRouter.mjs';

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
 * @param {import('../../0_system/users/UserResolver.mjs').UserResolver} [options.userResolver] - For resolving platform users to system usernames
 * @param {string} [options.botId] - Telegram bot ID
 * @param {string} [options.secretToken] - X-Telegram-Bot-Api-Secret-Token for webhook auth
 * @param {Object} [options.gateway] - TelegramAdapter for callback acknowledgements
 * @param {Object} [options.configService] - Config service for user resolution
 * @param {Object} [options.logger] - Logger instance
 * @returns {Router}
 */
export function createJournalistRouter(container, options = {}) {
  const router = Router();
  const { userResolver, botId, secretToken, gateway, configService, logger = console } = options;

  // Create webhook components
  const parser = botId ? new TelegramWebhookParser({ botId, logger }) : null;
  const inputRouter = new JournalistInputRouter(container, { userResolver, logger });

  // Webhook endpoint using shared handler
  if (parser) {
    router.post(
      '/webhook',
      webhookValidationMiddleware('journalist', { secretToken }),
      idempotencyMiddleware({ ttlMs: 300000 }),
      createBotWebhookHandler({
        botName: 'journalist',
        botId,
        parser,
        inputRouter,
        gateway,
        logger,
      }),
    );
  } else {
    logger.warn?.('journalist.webhook.disabled', { reason: 'No botId configured' });
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
