// backend/src/4_api/handlers/homebot/index.mjs

/**
 * Extract chat ID from Telegram update
 * @param {object} update - Telegram update object
 * @returns {string|null} Chat ID or null if not found
 */
function extractChatIdFromUpdate(update) {
  const chatId =
    update.message?.chat?.id ||
    update.callback_query?.message?.chat?.id ||
    update.edited_message?.chat?.id ||
    update.channel_post?.chat?.id;

  return chatId ? String(chatId) : null;
}

/**
 * Create standardized conversation ID for Telegram
 * Format: "telegram:b{botId}_c{chatId}"
 * @param {string} botId
 * @param {string} chatId
 * @returns {string}
 */
function createConversationId(botId, chatId) {
  const identifier = `b${botId}_c${chatId}`;
  return `telegram:${identifier}`;
}

/**
 * Create webhook handler for homebot
 *
 * NOTE: This is a legacy handler. The preferred approach is to use
 * createBotWebhookHandler from 2_adapters/telegram which uses
 * standardized IInputEvent for platform identity.
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

      // Extract platform identity from update
      let conversationId = parsed.chatId;
      let platformUserId = null;

      if (botId) {
        try {
          const chatId = extractChatIdFromUpdate(update);
          if (chatId) {
            conversationId = createConversationId(botId, chatId);
            platformUserId = chatId;
          }
        } catch (e) {
          console.warn('homebot.chatref.failed', { error: e.message });
        }
      }

      // Normalize to input event with platform identity
      const event = {
        type: parsed.type,
        conversationId,
        platform: 'telegram',
        platformUserId,
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
