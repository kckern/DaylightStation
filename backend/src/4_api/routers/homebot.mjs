// backend/src/4_api/routers/homebot.mjs

import { Router } from 'express';
import { HomeBotInputRouter } from '../../2_adapters/homebot/HomeBotInputRouter.mjs';
import { TelegramWebhookParser } from '../../2_adapters/telegram/TelegramWebhookParser.mjs';
import {
  webhookValidationMiddleware as defaultWebhookValidation,
  idempotencyMiddleware as defaultIdempotency,
  asyncHandler,
  errorHandlerMiddleware,
} from '../../0_infrastructure/http/middleware/index.mjs';

/**
 * Create Homebot Express Router
 * @param {import('../../3_applications/homebot/HomeBotContainer.mjs').HomeBotContainer} container
 * @param {Object} [options]
 * @param {string} [options.botId] - Telegram bot ID
 * @param {string} [options.secretToken] - X-Telegram-Bot-Api-Secret-Token for webhook auth
 * @param {Object} [options.gateway] - TelegramAdapter for callback acknowledgements
 * @param {Object} [options.logger] - Logger instance
 * @returns {Router}
 */
export function createHomebotRouter(container, options = {}) {
  const router = Router();

  const {
    botId,
    secretToken,
    gateway,
    logger = console
  } = options;

  // Create webhook parser and input router
  const webhookParser = botId ? new TelegramWebhookParser({ botId, logger }) : null;
  const inputRouter = new HomeBotInputRouter({ container, logger });

  // Webhook endpoint with inline handling (like nutribot)
  if (webhookParser) {
    router.post(
      '/webhook',
      defaultWebhookValidation('homebot', { secretToken }),
      defaultIdempotency({ ttlMs: 300000 }),
      asyncHandler(async (req, res) => {
        try {
          // Parse Telegram update into normalized input
          const parsed = webhookParser.parse(req.body);
          if (!parsed) {
            logger.debug?.('homebot.webhook.unsupported', { updateKeys: Object.keys(req.body) });
            return res.sendStatus(200);
          }

          // Transform to InputRouter event shape
          const event = {
            type: parsed.type,
            conversationId: parsed.userId,
            text: parsed.text,
            fileId: parsed.fileId,
            callbackData: parsed.callbackData,
            callbackId: parsed.callbackId,
            messageId: parsed.messageId,
            command: parsed.command,
            metadata: parsed.metadata
          };

          // Acknowledge callback if present
          if (parsed.type === 'callback' && parsed.callbackId && gateway) {
            try {
              await gateway.answerCallback(parsed.callbackId);
            } catch (e) {
              logger.warn?.('homebot.callback.ack_failed', { error: e.message });
            }
          }

          // Route to use cases
          await inputRouter.route(event);

          res.sendStatus(200);
        } catch (error) {
          logger.error?.('homebot.webhook.error', { error: error.message, stack: error.stack });
          // Always return 200 to Telegram to prevent retry loops
          res.sendStatus(200);
        }
      })
    );
  } else {
    logger.warn?.('homebot.webhook.disabled', { reason: 'No botId configured' });
  }

  // Health check endpoint
  router.get('/health', (req, res) => {
    res.json({ status: 'ok', bot: 'homebot' });
  });

  // Apply error handler
  router.use(errorHandlerMiddleware({ isWebhook: false }));

  return router;
}

export default createHomebotRouter;
