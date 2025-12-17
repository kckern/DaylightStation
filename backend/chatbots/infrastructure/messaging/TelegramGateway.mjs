/**
 * Telegram Bot API Gateway Implementation
 * @module infrastructure/messaging/TelegramGateway
 * 
 * This gateway accepts plain string IDs at its boundary and converts
 * them internally to Telegram API format. It implements IMessagingGateway.
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import { MessageId } from '../../domain/value-objects/MessageId.mjs';
import { ExternalServiceError, RateLimitError } from '../../_lib/errors/index.mjs';
import { createLogger } from '../../_lib/logging/index.mjs';
import { IdConverter } from '../../_lib/ids/IdConverter.mjs';

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

/**
 * Telegram Bot API implementation of IMessagingGateway
 */
export class TelegramGateway {
  #token;
  #botId;
  #logger;
  #messageRepository;
  #aiGateway;

  /**
   * @param {Object} config - Gateway configuration
   * @param {string} config.token - Telegram bot token
   * @param {string} config.botId - Bot identifier
   * @param {Object} [options] - Additional options
   * @param {Object} [options.logger] - Logger instance
   * @param {Object} [options.messageRepository] - Optional repository for saving messages
   * @param {Object} [options.aiGateway] - AI gateway for voice transcription
   */
  constructor(config, options = {}) {
    if (!config?.token) {
      throw new Error('Telegram token is required');
    }
    if (!config?.botId) {
      throw new Error('Bot ID is required');
    }

    this.#token = config.token;
    this.#botId = config.botId;
    this.#logger = options.logger || createLogger({ source: 'telegram', app: 'gateway' });
    this.#messageRepository = options.messageRepository || null;
    this.#aiGateway = options.aiGateway || null;
  }

  /**
   * Get the bot ID
   * @returns {string}
   */
  get botId() {
    return this.#botId;
  }

  /**
   * Call Telegram Bot API
   * @private
   * @param {string} method - API method name
   * @param {Object} params - Method parameters
   * @returns {Promise<Object>}
   */
  async #callApi(method, params = {}) {
    const url = `${TELEGRAM_API_BASE}${this.#token}/${method}`;
    
    this.#logger.debug('telegram.api.request', { method, params: this.#redactParams(params) });

    try {
      const response = await axios.post(url, params, {
        timeout: 30000,
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.data.ok) {
        throw new Error(response.data.description || 'Unknown Telegram error');
      }

      this.#logger.debug('telegram.api.response', { method, success: true });
      return response.data.result;
    } catch (error) {
      // Handle rate limiting
      if (error.response?.status === 429) {
        const retryAfter = error.response.data?.parameters?.retry_after || 30;
        this.#logger.warn('telegram.api.rateLimit', { method, retryAfter });
        throw new RateLimitError('Telegram', retryAfter, { method });
      }

      // Handle other API errors
      const message = error.response?.data?.description || error.message;
      this.#logger.error('telegram.api.error', { method, error: message });
      throw new ExternalServiceError('Telegram', message, {
        method,
        statusCode: error.response?.status,
      });
    }
  }

  /**
   * Redact sensitive data from params for logging
   * @private
   */
  #redactParams(params) {
    const safe = { ...params };
    // Don't log full message text (could be sensitive)
    if (safe.text && safe.text.length > 100) {
      safe.text = safe.text.substring(0, 100) + '...';
    }
    return safe;
  }

  /**
   * Build keyboard markup
   * @private
   * @param {Array<Array<string|Object>>} choices - Button rows
   * @param {boolean} inline - Use inline keyboard
   * @returns {Object}
   */
  #buildKeyboard(choices, inline = false) {
    if (!choices) {
      return undefined;
    }

    // If choices is an empty array, return empty keyboard to remove buttons
    if (choices.length === 0) {
      return inline ? { inline_keyboard: [] } : { remove_keyboard: true };
    }

    if (inline) {
      // Inline keyboard
      const keyboard = choices.map(row =>
        row.map(button => {
          if (typeof button === 'string') {
            return { text: button, callback_data: button };
          }
          return {
            text: button.text || button.label,
            callback_data: button.callback_data || button.data || button.text,
            url: button.url,
          };
        })
      );
      return { inline_keyboard: keyboard };
    } else {
      // Reply keyboard
      const keyboard = choices.map(row =>
        row.map(button => {
          if (typeof button === 'string') {
            return { text: button };
          }
          return { text: button.text || button.label };
        })
      );
      return {
        keyboard,
        resize_keyboard: true,
        one_time_keyboard: true,
      };
    }
  }

  /**
   * Extract Telegram chat_id from various input formats.
   * Accepts:
   * - Plain string user ID: "575596036"
   * - Conversation ID: "telegram:6898194425_575596036"
   * - Legacy format: "b6898194425_u575596036"
   * - ChatId value object with .userId property (legacy support)
   * 
   * @private
   * @param {string|Object} chatIdOrConversationId - Chat identifier in any supported format
   * @returns {Object} Telegram API params with chat_id
   */
  #extractChatParams(chatIdOrConversationId) {
    // Handle ChatId value objects (legacy support)
    if (chatIdOrConversationId && typeof chatIdOrConversationId === 'object') {
      if (chatIdOrConversationId.userId) {
        return { chat_id: chatIdOrConversationId.userId };
      }
      if (chatIdOrConversationId.identifier) {
        return { chat_id: IdConverter.getUserId(chatIdOrConversationId.identifier) };
      }
      throw new Error('Invalid chatId object: missing userId or identifier');
    }

    // Handle string formats
    if (typeof chatIdOrConversationId === 'string') {
      const userId = IdConverter.getUserId(chatIdOrConversationId);
      return { chat_id: userId };
    }

    throw new Error(`Invalid chatId type: ${typeof chatIdOrConversationId}`);
  }

  /**
   * Normalize messageId to a number for Telegram API.
   * Accepts:
   * - Number
   * - String number
   * - MessageId value object
   * 
   * @private
   * @param {number|string|MessageId} messageId
   * @returns {number}
   */
  #normalizeMessageId(messageId) {
    if (messageId === null || messageId === undefined) {
      throw new Error('messageId is required');
    }
    
    // MessageId value object
    if (messageId && typeof messageId === 'object' && typeof messageId.toNumber === 'function') {
      return messageId.toNumber();
    }
    
    // String or number
    const num = parseInt(String(messageId), 10);
    if (isNaN(num)) {
      throw new Error(`Invalid messageId: ${messageId}`);
    }
    return num;
  }

  /**
   * Normalize chatId to string for storage/history.
   * @private
   * @param {string|Object} chatIdOrConversationId
   * @returns {string}
   */
  #normalizeChatIdForStorage(chatIdOrConversationId) {
    if (typeof chatIdOrConversationId === 'string') {
      return chatIdOrConversationId;
    }
    if (chatIdOrConversationId && typeof chatIdOrConversationId.toJSON === 'function') {
      return chatIdOrConversationId.toJSON();
    }
    if (chatIdOrConversationId && chatIdOrConversationId.identifier) {
      return chatIdOrConversationId.identifier;
    }
    return String(chatIdOrConversationId);
  }

  /**
   * Save message to history
   * @private
   * @param {string|Object} chatId - Chat identifier
   * @param {string|number|MessageId} messageId - Message ID
   * @param {string} text - Message text
   * @param {string} [foreignKey] - Optional foreign key
   */
  async #saveToHistory(chatId, messageId, text, foreignKey) {
    if (!this.#messageRepository) return;

    try {
      const normalizedChatId = this.#normalizeChatIdForStorage(chatId);
      const userId = IdConverter.getUserId(normalizedChatId);
      
      await this.#messageRepository.save({
        messageId: String(messageId),
        chatId: normalizedChatId,
        text,
        foreignKey,
        timestamp: new Date().toISOString(),
        direction: 'outgoing',
      }, userId);
    } catch (error) {
      this.#logger.warn('telegram.history.saveError', { error: error.message });
    }
  }

  /**
   * Send a text message
   * @param {string|Object} chatId - Chat ID (string, conversationId, or ChatId object)
   * @param {string} text - Message text
   * @param {Object} [options] - Send options
   * @param {string} [options.parseMode] - 'HTML' or 'Markdown'
   * @param {Array<Array>} [options.choices] - Keyboard buttons
   * @param {boolean} [options.inline] - Use inline keyboard
   * @param {boolean} [options.removeKeyboard] - Remove keyboard
   * @param {boolean} [options.saveMessage] - Save to history (default: true)
   * @param {string} [options.foreignKey] - Foreign key for history
   * @returns {Promise<{messageId: MessageId}>}
   */
  async sendMessage(chatId, text, options = {}) {
    const params = {
      ...this.#extractChatParams(chatId),
      text,
    };

    if (options.parseMode) {
      params.parse_mode = options.parseMode;
    }

    if (options.choices) {
      params.reply_markup = this.#buildKeyboard(options.choices, options.inline);
    } else if (options.removeKeyboard) {
      params.reply_markup = { remove_keyboard: true };
    }

    const result = await this.#callApi('sendMessage', params);
    const messageId = MessageId.from(result.message_id);

    if (options.saveMessage !== false) {
      await this.#saveToHistory(chatId, messageId, text, options.foreignKey);
    }

    return { messageId };
  }

  /**
   * Send an image
   * @param {string|Object} chatId - Chat ID (string, conversationId, or ChatId object)
   * @param {string|Buffer} imageSource - URL, file path, or Buffer
   * @param {string} [caption] - Image caption
   * @param {Object} [options] - Send options
   * @returns {Promise<{messageId: MessageId}>}
   */
  async sendImage(chatId, imageSource, caption, options = {}) {
    const chatParams = this.#extractChatParams(chatId);

    // Determine how to send the photo
    if (Buffer.isBuffer(imageSource)) {
      // Buffer - upload via FormData
      const form = new FormData();
      form.append('chat_id', chatParams.chat_id);
      form.append('photo', imageSource, { filename: 'photo.png', contentType: 'image/png' });
      if (caption) form.append('caption', caption);
      if (options.parseMode) form.append('parse_mode', options.parseMode);
      if (options.choices) {
        form.append('reply_markup', JSON.stringify(this.#buildKeyboard(options.choices, options.inline)));
      }
      
      const url = `${TELEGRAM_API_BASE}${this.#token}/sendPhoto`;
      const response = await axios.post(url, form, {
        headers: form.getHeaders(),
      });
      
      if (!response.data.ok) {
        throw new ExternalServiceError('Telegram API error', { response: response.data });
      }
      
      const messageId = MessageId.from(response.data.result.message_id);
      return { messageId };
      
    } else if (imageSource.startsWith && imageSource.startsWith('http')) {
      // URL - pass directly
      const params = {
        ...chatParams,
        photo: imageSource,
      };
      if (caption) params.caption = caption;
      if (options.parseMode) params.parse_mode = options.parseMode;
      if (options.choices) {
        params.reply_markup = this.#buildKeyboard(options.choices, options.inline);
      }
      
      const result = await this.#callApi('sendPhoto', params);
      const messageId = MessageId.from(result.message_id);
      return { messageId };
      
    } else if (typeof imageSource === 'string' && fs.existsSync(imageSource)) {
      // Local file path - upload via FormData
      const form = new FormData();
      form.append('chat_id', chatParams.chat_id);
      form.append('photo', fs.createReadStream(imageSource), {
        filename: path.basename(imageSource),
        contentType: 'image/png',
      });
      if (caption) form.append('caption', caption);
      if (options.parseMode) form.append('parse_mode', options.parseMode);
      if (options.choices) {
        form.append('reply_markup', JSON.stringify(this.#buildKeyboard(options.choices, options.inline)));
      }
      
      const url = `${TELEGRAM_API_BASE}${this.#token}/sendPhoto`;
      this.#logger.debug('telegram.api.uploadPhoto', { path: imageSource });
      const response = await axios.post(url, form, {
        headers: form.getHeaders(),
      });
      
      if (!response.data.ok) {
        this.#logger.error('telegram.api.error', { method: 'sendPhoto', error: response.data });
        throw new ExternalServiceError('Telegram API error', { response: response.data });
      }
      
      this.#logger.debug('telegram.api.response', { method: 'sendPhoto', success: true });
      const messageId = MessageId.from(response.data.result.message_id);
      return { messageId };
      
    } else if (typeof imageSource === 'string') {
      // Assume it's a Telegram file_id - pass directly to API
      const params = {
        ...chatParams,
        photo: imageSource,
      };
      if (caption) params.caption = caption;
      if (options.parseMode) params.parse_mode = options.parseMode;
      if (options.choices) {
        params.reply_markup = this.#buildKeyboard(options.choices, options.inline);
      }
      
      this.#logger.debug('telegram.api.sendPhotoFileId', { fileId: imageSource.substring(0, 20) + '...' });
      const result = await this.#callApi('sendPhoto', params);
      const messageId = MessageId.from(result.message_id);
      return { messageId };

    } else {
      throw new Error(`Invalid image source: ${typeof imageSource}`);
    }
  }

  /**
   * Send a photo (alias for sendImage)
   * @param {string|Object} chatId - Chat ID
   * @param {string|Buffer} photo - URL, file path, or Buffer
   * @param {Object} [options] - Send options
   * @param {string} [options.caption] - Image caption
   * @returns {Promise<{messageId: MessageId}>}
   */
  async sendPhoto(chatId, photo, options = {}) {
    return this.sendImage(chatId, photo, options.caption, options);
  }

  /**
   * Update an existing message
   * @param {string|Object} chatId - Chat ID (string, conversationId, or ChatId object)
   * @param {string|number|MessageId} messageId - Message ID to update
   * @param {Object} updates - Updates to apply
   * @param {string} [updates.text] - New text content (for text messages)
   * @param {string} [updates.caption] - New caption (for photo/media messages)
   * @param {string} [updates.parseMode] - Parse mode
   * @param {Array<Array>} [updates.choices] - New keyboard
   * @returns {Promise<void>}
   */
  async updateMessage(chatId, messageId, updates) {
    const baseParams = {
      ...this.#extractChatParams(chatId),
      message_id: this.#normalizeMessageId(messageId),
    };

    // Handle text messages (editMessageText)
    if (updates.text !== undefined) {
      const params = {
        ...baseParams,
        text: updates.text,
      };
      if (updates.parseMode) {
        params.parse_mode = updates.parseMode;
      }
      if (updates.choices) {
        params.reply_markup = this.#buildKeyboard(updates.choices, true);
      }
      await this.#callApi('editMessageText', params);
    } 
    // Handle photo/media messages (editMessageCaption) - can include choices
    else if (updates.caption !== undefined) {
      const params = {
        ...baseParams,
        caption: updates.caption,
      };
      if (updates.parseMode) {
        params.parse_mode = updates.parseMode;
      }
      if (updates.choices) {
        params.reply_markup = this.#buildKeyboard(updates.choices, true);
      }
      await this.#callApi('editMessageCaption', params);
    } 
    // Handle reply markup only (works for both text and photo messages)
    else if (updates.choices !== undefined) {
      await this.updateKeyboard(chatId, messageId, updates.choices);
    }
  }

  /**
   * Update just the keyboard of a message
   * @param {string|Object} chatId - Chat ID (string, conversationId, or ChatId object)
   * @param {string|number|MessageId} messageId - Message ID to update
   * @param {Array<Array<string|Object>>} choices - New keyboard buttons
   * @returns {Promise<void>}
   */
  async updateKeyboard(chatId, messageId, choices) {
    const params = {
      ...this.#extractChatParams(chatId),
      message_id: this.#normalizeMessageId(messageId),
      reply_markup: this.#buildKeyboard(choices, true),
    };

    await this.#callApi('editMessageReplyMarkup', params);
  }

  /**
   * Delete a message
   * @param {string|Object} chatId - Chat ID (string, conversationId, or ChatId object)
   * @param {string|number|MessageId} messageId - Message ID to delete
   * @returns {Promise<void>}
   */
  async deleteMessage(chatId, messageId) {
    const normalizedMsgId = this.#normalizeMessageId(messageId);
    const params = {
      ...this.#extractChatParams(chatId),
      message_id: normalizedMsgId,
    };

    try {
      await this.#callApi('deleteMessage', params);
    } catch (error) {
      // Ignore "message to delete not found" errors
      if (!error.message?.includes('message to delete not found')) {
        throw error;
      }
      this.#logger.debug('telegram.deleteMessage.notFound', { messageId: String(messageId) });
    }
  }

  /**
   * Answer a callback query (acknowledge button press)
   * @param {string} callbackQueryId - Callback query ID from Telegram
   * @param {Object} [options] - Response options
   * @param {string} [options.text] - Optional notification text
   * @param {boolean} [options.showAlert] - Show as alert popup
   * @returns {Promise<void>}
   */
  async answerCallbackQuery(callbackQueryId, options = {}) {
    const params = {
      callback_query_id: callbackQueryId,
    };
    
    if (options.text) {
      params.text = options.text;
    }
    if (options.showAlert) {
      params.show_alert = true;
    }
    
    await this.#callApi('answerCallbackQuery', params);
  }

  /**
   * Transcribe a voice message
   * @param {string} voiceFileId - Telegram file ID
   * @returns {Promise<string>}
   */
  async transcribeVoice(voiceFileId) {
    if (!this.#aiGateway) {
      throw new Error('AI gateway required for voice transcription');
    }

    // Get file info
    const fileInfo = await this.#callApi('getFile', { file_id: voiceFileId });
    const fileUrl = `https://api.telegram.org/file/bot${this.#token}/${fileInfo.file_path}`;

    // Download the file
    const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    const audioBuffer = Buffer.from(response.data);

    // Transcribe using AI gateway
    const text = await this.#aiGateway.transcribe(audioBuffer);
    return text;
  }

  /**
   * Get download URL for a file
   * @param {string} fileId - Telegram file ID
   * @returns {Promise<string>}
   */
  async getFileUrl(fileId) {
    const fileInfo = await this.#callApi('getFile', { file_id: fileId });
    return `https://api.telegram.org/file/bot${this.#token}/${fileInfo.file_path}`;
  }
}

export default TelegramGateway;
