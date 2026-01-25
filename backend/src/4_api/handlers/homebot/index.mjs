// backend/src/4_api/handlers/homebot/index.mjs

import { TelegramChatRef } from '../../../2_adapters/telegram/TelegramChatRef.mjs';

/**
 * Create webhook handler for homebot
 *
 * NOTE: This is a legacy handler. The preferred approach is to use
 * createBotWebhookHandler from 2_adapters/telegram which uses
 * standardized IInputEvent and TelegramChatRef for platform identity.
 *
 * @param {Object} container - HomeBotContainer
 * @param {Object} options
 * @param {string} options.botId
 * @param {string} options.botName
 * @param {Object} deps
 * @param {Object} deps.gateway - TelegramAdapter
 * @param {Function} deps.RouterClass - HomeBotInputRouter class
 * @returns {Function} Express handler
 */
export function createHomebotWebhookHandler(container, options, deps) {
  const { botId, botName } = options;
  const { gateway, RouterClass } = deps;

  const inputRouter = new RouterClass({
    container,
    logger: console
  });

  return async (req, res) => {
    try {
      const update = req.body;

      // Parse Telegram update
      const parsed = gateway.parseUpdate(update);
      if (!parsed) {
        return res.sendStatus(200);
      }

      // Create TelegramChatRef for platform identity
      let telegramRef = null;
      if (botId) {
        try {
          telegramRef = TelegramChatRef.fromTelegramUpdate(botId, update);
        } catch (e) {
          console.warn('homebot.chatref.failed', { error: e.message });
        }
      }

      // Normalize to input event with platform identity
      const event = {
        type: parsed.type,
        conversationId: telegramRef ? telegramRef.toConversationId().toString() : parsed.chatId,
        platform: 'telegram',
        platformUserId: telegramRef ? telegramRef.platformUserId : null,
        messageId: parsed.messageId,
        text: parsed.content,
        fileId: parsed.raw?.voice?.file_id || parsed.raw?.photo?.[0]?.file_id,
        callbackData: parsed.type === 'callback' ? parsed.content : null,
        callbackId: parsed.raw?.id
      };

      // Acknowledge callback immediately
      if (event.callbackId) {
        await gateway.answerCallbackQuery(event.callbackId);
      }

      // Route to use case
      await inputRouter.route(event);

      res.sendStatus(200);
    } catch (error) {
      console.error('homebot.webhook.error', error);
      res.sendStatus(200); // Always 200 to Telegram
    }
  };
}

export default createHomebotWebhookHandler;
