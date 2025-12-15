/**
 * Telegram Input Adapter
 * @module adapters/telegram/TelegramInputAdapter
 * 
 * Converts Telegram webhook payloads into platform-agnostic IInputEvent format.
 * This adapter handles all Telegram-specific parsing logic, keeping it
 * isolated from the application layer.
 */

import {
  InputEventType,
  createTextEvent,
  createImageEvent,
  createVoiceEvent,
  createCallbackEvent,
  createCommandEvent,
  createUPCEvent,
  createDocumentEvent,
} from '../../application/ports/IInputEvent.mjs';

// ==================== Constants ====================

/**
 * Channel identifier for Telegram
 * @constant {string}
 */
export const TELEGRAM_CHANNEL = 'telegram';

/**
 * UPC pattern: 8-14 digits, optionally with dashes
 * Must start and end with digit
 * @constant {RegExp}
 */
const UPC_PATTERN = /^\d[\d-]{6,13}\d$/;

/**
 * Slash command pattern: /command optionally followed by args
 * @constant {RegExp}
 */
const COMMAND_PATTERN = /^\/([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(.*))?$/;

// ==================== Main Adapter ====================

/**
 * Telegram Input Adapter
 * 
 * Stateless adapter class for parsing Telegram webhook updates.
 * All methods are static since no instance state is required.
 */
export class TelegramInputAdapter {
  /**
   * Parse a Telegram webhook update into an IInputEvent
   * 
   * @param {Object} update - Telegram Update object
   * @param {Object} config - Bot configuration
   * @param {string} config.botId - Telegram bot ID
   * @returns {import('../../application/ports/IInputEvent.mjs').IInputEvent|null}
   */
  static parse(update, config) {
    if (!update || typeof update !== 'object') {
      return null;
    }

    if (!config?.botId) {
      throw new Error('config.botId is required');
    }

    const { message, callback_query, edited_message } = update;

    // Handle callback query (button press)
    if (callback_query) {
      return this.#parseCallbackQuery(callback_query, config);
    }

    // Handle regular message
    if (message) {
      return this.#parseMessage(message, config);
    }

    // Handle edited message (treat same as new message for now)
    if (edited_message) {
      return this.#parseMessage(edited_message, config);
    }

    // Unsupported update type
    return null;
  }

  /**
   * Parse a Telegram Message object
   * @private
   * @param {Object} message - Telegram Message object
   * @param {Object} config - Bot configuration
   * @returns {import('../../application/ports/IInputEvent.mjs').IInputEvent|null}
   */
  static #parseMessage(message, config) {
    const userId = String(message.chat?.id || message.from?.id);
    const conversationId = this.buildConversationId(config.botId, userId);
    const messageId = String(message.message_id);

    // Extract common metadata
    const metadata = {
      chatType: message.chat?.type, // private, group, supergroup, channel
      username: message.from?.username,
      firstName: message.from?.first_name,
      lastName: message.from?.last_name,
      languageCode: message.from?.language_code,
      updateId: message.update_id,
    };

    // Photo message (check before text since photos can have captions)
    if (message.photo && message.photo.length > 0) {
      return this.#parsePhotoMessage(message, { userId, conversationId, messageId, metadata });
    }

    // Voice message
    if (message.voice) {
      return this.#parseVoiceMessage(message, { userId, conversationId, messageId, metadata });
    }

    // Document message (could be image sent as document)
    if (message.document) {
      return this.#parseDocumentMessage(message, { userId, conversationId, messageId, metadata });
    }

    // Text message (last, since other types may have text/caption)
    if (message.text) {
      return this.#parseTextMessage(message, { userId, conversationId, messageId, metadata });
    }

    // Unsupported message type
    return null;
  }

  /**
   * Parse a text message, detecting commands and UPCs
   * @private
   */
  static #parseTextMessage(message, { userId, conversationId, messageId, metadata }) {
    const text = message.text.trim();

    // Check for slash command
    const commandMatch = text.match(COMMAND_PATTERN);
    if (commandMatch) {
      return createCommandEvent({
        userId,
        conversationId,
        messageId,
        command: commandMatch[1].toLowerCase(),
        args: commandMatch[2]?.trim() || undefined,
        rawText: text,
        channel: TELEGRAM_CHANNEL,
        metadata,
      });
    }

    // Check for UPC pattern
    const cleanedText = text.replace(/-/g, '');
    if (UPC_PATTERN.test(text) || (cleanedText.length >= 8 && cleanedText.length <= 14 && /^\d+$/.test(cleanedText))) {
      return createUPCEvent({
        userId,
        conversationId,
        messageId,
        upc: cleanedText,
        rawText: text,
        channel: TELEGRAM_CHANNEL,
        metadata,
      });
    }

    // Regular text message
    return createTextEvent({
      userId,
      conversationId,
      messageId,
      text,
      channel: TELEGRAM_CHANNEL,
      metadata,
    });
  }

  /**
   * Parse a photo message
   * @private
   */
  static #parsePhotoMessage(message, { userId, conversationId, messageId, metadata }) {
    // Telegram provides multiple sizes, get the largest (last in array)
    const photos = message.photo;
    const largestPhoto = photos[photos.length - 1];

    return createImageEvent({
      userId,
      conversationId,
      messageId,
      fileId: largestPhoto.file_id,
      caption: message.caption,
      channel: TELEGRAM_CHANNEL,
      metadata: {
        ...metadata,
        width: largestPhoto.width,
        height: largestPhoto.height,
        fileUniqueId: largestPhoto.file_unique_id,
        allSizes: photos.map(p => ({ 
          fileId: p.file_id, 
          width: p.width, 
          height: p.height,
        })),
      },
    });
  }

  /**
   * Parse a voice message
   * @private
   */
  static #parseVoiceMessage(message, { userId, conversationId, messageId, metadata }) {
    const voice = message.voice;

    return createVoiceEvent({
      userId,
      conversationId,
      messageId,
      fileId: voice.file_id,
      duration: voice.duration,
      channel: TELEGRAM_CHANNEL,
      metadata: {
        ...metadata,
        mimeType: voice.mime_type,
        fileSize: voice.file_size,
        fileUniqueId: voice.file_unique_id,
      },
    });
  }

  /**
   * Parse a document message
   * @private
   */
  static #parseDocumentMessage(message, { userId, conversationId, messageId, metadata }) {
    const doc = message.document;

    // Check if document is an image (sometimes users send images as documents)
    const isImage = doc.mime_type?.startsWith('image/');
    
    if (isImage) {
      return createImageEvent({
        userId,
        conversationId,
        messageId,
        fileId: doc.file_id,
        caption: message.caption,
        channel: TELEGRAM_CHANNEL,
        metadata: {
          ...metadata,
          fileName: doc.file_name,
          mimeType: doc.mime_type,
          fileSize: doc.file_size,
          fileUniqueId: doc.file_unique_id,
          sentAsDocument: true,
        },
      });
    }

    return createDocumentEvent({
      userId,
      conversationId,
      messageId,
      fileId: doc.file_id,
      fileName: doc.file_name,
      mimeType: doc.mime_type,
      fileSize: doc.file_size,
      channel: TELEGRAM_CHANNEL,
      metadata: {
        ...metadata,
        fileUniqueId: doc.file_unique_id,
        thumbnail: doc.thumbnail,
      },
    });
  }

  /**
   * Parse a callback query (button press)
   * @private
   * @param {Object} callbackQuery - Telegram CallbackQuery object
   * @param {Object} config - Bot configuration
   * @returns {import('../../application/ports/IInputEvent.mjs').IInputEvent|null}
   */
  static #parseCallbackQuery(callbackQuery, config) {
    const message = callbackQuery.message;
    
    if (!message) {
      // Callback from inline mode (no message) - not supported
      return null;
    }

    const userId = String(message.chat?.id || callbackQuery.from?.id);
    const conversationId = this.buildConversationId(config.botId, userId);

    return createCallbackEvent({
      userId,
      conversationId,
      data: callbackQuery.data || '',
      sourceMessageId: String(message.message_id),
      callbackQueryId: callbackQuery.id,
      channel: TELEGRAM_CHANNEL,
      metadata: {
        chatType: message.chat?.type,
        username: callbackQuery.from?.username,
        firstName: callbackQuery.from?.first_name,
        lastName: callbackQuery.from?.last_name,
        chatInstance: callbackQuery.chat_instance,
      },
    });
  }

  // ==================== ID Building ====================

  /**
   * Build a canonical conversation ID from Telegram IDs
   * 
   * Format: "telegram:{botId}_{userId}"
   * 
   * @param {string} botId - Telegram bot ID
   * @param {string} userId - Telegram user/chat ID
   * @returns {string}
   */
  static buildConversationId(botId, userId) {
    return `${TELEGRAM_CHANNEL}:${botId}_${userId}`;
  }

  /**
   * Parse a conversation ID to extract bot and user IDs
   * 
   * @param {string} conversationId - Conversation ID to parse
   * @returns {{ botId: string, userId: string } | null}
   */
  static parseConversationId(conversationId) {
    const match = conversationId.match(/^telegram:(\d+)_(\d+)$/);
    if (!match) return null;
    return { botId: match[1], userId: match[2] };
  }

  // ==================== Utilities ====================

  /**
   * Check if text looks like a UPC code
   * @param {string} text
   * @returns {boolean}
   */
  static isUPCLike(text) {
    if (!text) return false;
    const cleaned = text.replace(/-/g, '').trim();
    return cleaned.length >= 8 && cleaned.length <= 14 && /^\d+$/.test(cleaned);
  }

  /**
   * Check if text is a slash command
   * @param {string} text
   * @returns {boolean}
   */
  static isCommand(text) {
    if (!text) return false;
    return text.trim().startsWith('/');
  }

  /**
   * Extract file ID from message for any file type
   * @param {Object} message - Telegram Message
   * @returns {string|null}
   */
  static extractFileId(message) {
    if (message.photo?.length > 0) {
      return message.photo[message.photo.length - 1].file_id;
    }
    if (message.voice) return message.voice.file_id;
    if (message.document) return message.document.file_id;
    if (message.audio) return message.audio.file_id;
    if (message.video) return message.video.file_id;
    if (message.video_note) return message.video_note.file_id;
    if (message.sticker) return message.sticker.file_id;
    return null;
  }
}

export default TelegramInputAdapter;
