/**
 * Journalist Server/Router
 * @module api/routers/journalist
 *
 * Express router for Journalist endpoints.
 */

import { Router } from 'express';
import { JournalistInputRouter } from '../../2_adapters/journalist/JournalistInputRouter.mjs';
import { TelegramWebhookParser } from '../../2_adapters/telegram/TelegramWebhookParser.mjs';
import {
  journalistJournalHandler,
  journalistTriggerHandler,
  handleMorningDebrief,
} from '../handlers/journalist/index.mjs';
import {
  webhookValidationMiddleware as defaultWebhookValidation,
  idempotencyMiddleware as defaultIdempotency,
  asyncHandler,
  errorHandlerMiddleware,
} from '../../0_infrastructure/http/middleware/index.mjs';


/**
 * Create Journalist Express Router
 * @param {import('../../3_applications/journalist/JournalistContainer.mjs').JournalistContainer} container
 * @param {Object} [options]
 * @param {string} [options.botId] - Telegram bot ID
 * @param {string} [options.secretToken] - X-Telegram-Bot-Api-Secret-Token for webhook auth
 * @param {Object} [options.gateway] - TelegramAdapter for callback acknowledgements
 * @param {Object} [options.configService] - Config service for user resolution
 * @param {Object} [options.logger] - Logger instance
 * @returns {Router}
 */
export function createJournalistRouter(container, options = {}) {
  const router = Router();

  const {
    botId,
    secretToken,
    gateway,
    configService,
    logger = console,
  } = options;

  // Create webhook parser and input router
  const webhookParser = botId ? new TelegramWebhookParser({ botId, logger }) : null;
  const inputRouter = new JournalistInputRouter(container, { logger });

  // Webhook endpoint with inline handling (like nutribot)
  if (webhookParser) {
    router.post(
      '/webhook',
      defaultWebhookValidation('journalist', { secretToken }),
      defaultIdempotency({ ttlMs: 300000 }),
      asyncHandler(async (req, res) => {
        try {
          // Parse Telegram update into normalized input
          const parsed = webhookParser.parse(req.body);
          if (!parsed) {
            logger.debug?.('journalist.webhook.unsupported', { updateKeys: Object.keys(req.body) });
            return res.sendStatus(200);
          }

          // Transform to JournalistInputRouter event shape
          const event = {
            type: parsed.type,
            conversationId: parsed.userId,
            messageId: parsed.messageId,
            userId: parsed.metadata?.from?.id?.toString(),
            payload: {
              text: parsed.text,
              data: parsed.callbackData,
              fileId: parsed.fileId,
              command: parsed.command,
              args: parsed.text,  // For commands, text contains args
              sourceMessageId: parsed.messageId,
            },
            metadata: {
              senderId: parsed.metadata?.from?.id?.toString(),
              firstName: parsed.metadata?.from?.first_name,
              username: parsed.metadata?.from?.username,
              chatType: parsed.metadata?.chatType,
            },
          };

          // Acknowledge callback if present
          if (parsed.type === 'callback' && parsed.callbackId && gateway) {
            try {
              await gateway.answerCallback(parsed.callbackId);
            } catch (e) {
              logger.warn?.('journalist.callback.ack_failed', { error: e.message });
            }
          }

          // Route to use cases
          await inputRouter.route(event);

          res.sendStatus(200);
        } catch (error) {
          logger.error?.('journalist.webhook.error', { error: error.message, stack: error.stack });
          // Always return 200 to Telegram to prevent retry loops
          res.sendStatus(200);
        }
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
      const date = req.query.date || null; // Optional: specific date (YYYY-MM-DD)

      if (!username) {
        return res.status(400).json({
          success: false,
          error: 'No username specified and no default user configured',
        });
      }

      // Get UserResolver from container (if available)
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
