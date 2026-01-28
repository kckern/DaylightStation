// backend/src/2_adapters/telegram/TelegramWebhookParser.mjs

import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * @typedef {Object} NormalizedInput
 * @property {'text'|'image'|'voice'|'callback'|'command'|'upc'} type
 * @property {string} userId - Conversation ID format: "telegram:botId_chatId"
 * @property {string} [text]
 * @property {string} [command]
 * @property {string} [fileId]
 * @property {string} [callbackData]
 * @property {string} [callbackId]
 * @property {string} [messageId]
 * @property {Object} [metadata]
 */

/**
 * Parses Telegram webhook payloads into normalized input events
 */
export class TelegramWebhookParser {
  #botId;
  #logger;

  constructor(config) {
    if (!config.botId) {
      throw new InfrastructureError('TelegramWebhookParser requires botId', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'botId'
      });
    }
    this.#botId = config.botId;
    this.#logger = config.logger || console;
  }

  #buildConversationId(chatId) {
    return `telegram:${this.#botId}_${chatId}`;
  }

  #isUPC(text) {
    const cleaned = text.replace(/-/g, '');
    return /^\d{8,14}$/.test(cleaned);
  }

  #isCommand(text) {
    return text.startsWith('/');
  }

  parse(update) {
    if (update.callback_query) {
      return this.#parseCallback(update.callback_query);
    }

    const message = update.message || update.edited_message;
    if (!message) {
      this.#logger.debug?.('telegram.parse.unsupported', { updateKeys: Object.keys(update) });
      return null;
    }

    if (message.photo) {
      return this.#parsePhoto(message);
    }
    if (message.document) {
      return this.#parseDocument(message);
    }
    if (message.voice) {
      return this.#parseVoice(message);
    }
    if (message.text) {
      return this.#parseText(message);
    }

    this.#logger.debug?.('telegram.parse.unsupported', { messageKeys: Object.keys(message) });
    return null;
  }

  #parseCallback(callbackQuery) {
    const chatId = callbackQuery.message?.chat?.id || callbackQuery.from?.id;
    return {
      type: 'callback',
      userId: this.#buildConversationId(chatId),
      callbackData: callbackQuery.data,
      callbackId: callbackQuery.id,
      messageId: String(callbackQuery.message?.message_id),
      metadata: {
        from: callbackQuery.from,
        chatType: callbackQuery.message?.chat?.type
      }
    };
  }

  #parsePhoto(message) {
    const photo = message.photo[message.photo.length - 1];
    return {
      type: 'image',
      userId: this.#buildConversationId(message.chat.id),
      fileId: photo.file_id,
      text: message.caption || '',
      messageId: String(message.message_id),
      metadata: {
        from: message.from,
        chatType: message.chat.type,
        width: photo.width,
        height: photo.height
      }
    };
  }

  #parseDocument(message) {
    const doc = message.document;
    return {
      type: 'image',
      userId: this.#buildConversationId(message.chat.id),
      fileId: doc.file_id,
      text: message.caption || '',
      messageId: String(message.message_id),
      metadata: {
        from: message.from,
        chatType: message.chat.type,
        fileName: doc.file_name,
        mimeType: doc.mime_type,
        fileSize: doc.file_size
      }
    };
  }

  #parseVoice(message) {
    return {
      type: 'voice',
      userId: this.#buildConversationId(message.chat.id),
      fileId: message.voice.file_id,
      messageId: String(message.message_id),
      metadata: {
        from: message.from,
        chatType: message.chat.type,
        duration: message.voice.duration,
        mimeType: message.voice.mime_type
      }
    };
  }

  #parseText(message) {
    const text = message.text.trim();

    if (this.#isCommand(text)) {
      const [command, ...args] = text.slice(1).split(/\s+/);
      return {
        type: 'command',
        userId: this.#buildConversationId(message.chat.id),
        command: command.toLowerCase(),
        text: args.join(' '),
        messageId: String(message.message_id),
        metadata: {
          from: message.from,
          chatType: message.chat.type
        }
      };
    }

    if (this.#isUPC(text)) {
      return {
        type: 'upc',
        userId: this.#buildConversationId(message.chat.id),
        text: text.replace(/-/g, ''),
        messageId: String(message.message_id),
        metadata: {
          from: message.from,
          chatType: message.chat.type
        }
      };
    }

    return {
      type: 'text',
      userId: this.#buildConversationId(message.chat.id),
      text,
      messageId: String(message.message_id),
      metadata: {
        from: message.from,
        chatType: message.chat.type
      }
    };
  }
}

export default TelegramWebhookParser;
