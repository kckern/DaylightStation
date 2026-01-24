/**
 * Webhook Validation Middleware
 * @module infrastructure/http/middleware/validation
 *
 * Validates webhook payload structure.
 */

import { createLogger } from '../../logging/logger.js';

const logger = createLogger({ source: 'middleware', app: 'http' });

/**
 * Create webhook validation middleware
 * @param {string} botName - Bot name for logging
 * @returns {Function} Express middleware
 */
export function webhookValidationMiddleware(botName = 'unknown') {
  return (req, res, next) => {
    // Check req.body exists
    if (!req.body) {
      logger.warn('webhook.validation.noBody', { botName, traceId: req.traceId });
      // Return 200 to prevent Telegram retry
      return res.status(200).json({ ok: true, skipped: true, reason: 'no_body' });
    }

    const body = req.body;

    // Validate basic structure (message or callback_query)
    const hasMessage = body.message && typeof body.message === 'object';
    const hasCallbackQuery = body.callback_query && typeof body.callback_query === 'object';
    const hasEditedMessage = body.edited_message && typeof body.edited_message === 'object';

    if (!hasMessage && !hasCallbackQuery && !hasEditedMessage) {
      logger.warn('webhook.validation.invalidStructure', {
        botName,
        traceId: req.traceId,
        keys: Object.keys(body),
      });
      // Return 200 to prevent Telegram retry
      return res.status(200).json({ ok: true, skipped: true, reason: 'invalid_structure' });
    }

    // Extract chatId and attach to request
    let chatId = null;
    let messageId = null;

    if (hasMessage) {
      chatId = body.message.chat?.id;
      messageId = body.message.message_id;
    } else if (hasCallbackQuery) {
      chatId = body.callback_query.message?.chat?.id;
      messageId = body.callback_query.message?.message_id;
    } else if (hasEditedMessage) {
      chatId = body.edited_message.chat?.id;
      messageId = body.edited_message.message_id;
    }

    if (!chatId) {
      logger.warn('webhook.validation.noChatId', { botName, traceId: req.traceId });
      return res.status(200).json({ ok: true, skipped: true, reason: 'no_chat_id' });
    }

    // Attach extracted info to request
    req.chatId = String(chatId);
    req.messageId = messageId ? String(messageId) : null;
    req.webhookType = hasMessage ? 'message' : hasCallbackQuery ? 'callback_query' : 'edited_message';

    next();
  };
}

export default webhookValidationMiddleware;
