// backend/src/4_api/handlers/homebot/index.mjs

/**
 * Create webhook handler for homebot
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

      // Normalize to input event
      const event = {
        type: parsed.type,
        conversationId: parsed.chatId,
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
