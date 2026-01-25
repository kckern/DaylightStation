// backend/src/2_adapters/telegram/createBotWebhookHandler.mjs

import { toInputEvent } from './IInputEvent.mjs';
import { TelegramChatRef } from './TelegramChatRef.mjs';

/**
 * Factory for creating standardized Telegram webhook handlers.
 *
 * Handles common concerns:
 * - Parsing webhook payload via TelegramWebhookParser
 * - Transforming to standardized IInputEvent with platform identity
 * - Auto-acknowledging callback queries
 * - Error handling with 200 response (prevents Telegram retries)
 * - Routing to bot-specific input router
 *
 * @param {Object} config
 * @param {string} config.botName - Bot identifier for logging
 * @param {string} config.botId - Telegram bot ID (for creating TelegramChatRef)
 * @param {Object} config.parser - TelegramWebhookParser instance
 * @param {Object} config.inputRouter - Bot's input router with route(event) method
 * @param {Object} [config.gateway] - TelegramAdapter for callback acknowledgement
 * @param {Object} [config.logger] - Logger instance
 * @returns {Function} Express async handler
 */
export function createBotWebhookHandler(config) {
  const { botName, botId, parser, inputRouter, gateway, logger = console } = config;

  if (!parser) throw new Error('createBotWebhookHandler requires parser');
  if (!inputRouter) throw new Error('createBotWebhookHandler requires inputRouter');

  return async (req, res) => {
    try {
      // 1. Parse Telegram update
      const parsed = parser.parse(req.body);
      if (!parsed) {
        logger.debug?.(`${botName}.webhook.unsupported`, {
          updateKeys: Object.keys(req.body),
        });
        return res.sendStatus(200);
      }

      // 2. Create TelegramChatRef for platform identity (if botId available)
      let telegramRef = null;
      if (botId) {
        try {
          telegramRef = TelegramChatRef.fromTelegramUpdate(botId, req.body);
        } catch (e) {
          logger.warn?.(`${botName}.chatref.failed`, { error: e.message });
        }
      }

      // 3. Transform to standardized event with platform identity
      const event = toInputEvent(parsed, telegramRef);

      // 4. Auto-acknowledge callback queries
      if (parsed.callbackId && gateway?.answerCallback) {
        try {
          await gateway.answerCallback(parsed.callbackId);
        } catch (e) {
          logger.warn?.(`${botName}.callback.ack_failed`, { error: e.message });
        }
      }

      // 5. Route to bot's input handler
      await inputRouter.route(event);

      // 6. Always return 200 to prevent Telegram retries
      res.sendStatus(200);
    } catch (error) {
      logger.error?.(`${botName}.webhook.error`, {
        error: error.message,
        stack: error.stack,
      });
      // Always return 200 to prevent Telegram retry loops
      res.sendStatus(200);
    }
  };
}

export default createBotWebhookHandler;
