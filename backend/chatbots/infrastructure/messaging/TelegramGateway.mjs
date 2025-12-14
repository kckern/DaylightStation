/**
 * Telegram Bot API Gateway Implementation
 * @module infrastructure/messaging/TelegramGateway
 */

import axios from 'axios';
import { MessageId } from '../../domain/value-objects/MessageId.mjs';
import { ExternalServiceError, RateLimitError } from '../../_lib/errors/index.mjs';
import { createLogger } from '../../_lib/logging/index.mjs';

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
    if (!choices || choices.length === 0) {
      return undefined;
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
   * Extract chat parameters from ChatId
   * @private
   * @param {import('../../domain/value-objects/ChatId.mjs').ChatId} chatId
   * @returns {Object}
   */
  #extractChatParams(chatId) {
    return { chat_id: chatId.userId };
  }

  /**
   * Save message to history
   * @private
   */
  async #saveToHistory(chatId, messageId, text, foreignKey) {
    if (!this.#messageRepository) return;

    try {
      await this.#messageRepository.save({
        messageId: messageId.toString(),
        chatId: chatId.toJSON(),
        text,
        foreignKey,
        timestamp: new Date().toISOString(),
        direction: 'outgoing',
      }, chatId.userId);
    } catch (error) {
      this.#logger.warn('telegram.history.saveError', { error: error.message });
    }
  }

  /**
   * Send a text message
   * @param {import('../../domain/value-objects/ChatId.mjs').ChatId} chatId
   * @param {string} text
   * @param {Object} [options]
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
   * @param {import('../../domain/value-objects/ChatId.mjs').ChatId} chatId
   * @param {string|Buffer} imageSource - URL, file path, or Buffer
   * @param {string} [caption]
   * @param {Object} [options]
   * @returns {Promise<{messageId: MessageId}>}
   */
  async sendImage(chatId, imageSource, caption, options = {}) {
    const params = {
      ...this.#extractChatParams(chatId),
    };

    // Determine how to send the photo
    if (Buffer.isBuffer(imageSource)) {
      // For buffers, we need to use multipart form data
      // For now, throw an error - implement FormData upload later
      throw new Error('Buffer image upload not yet implemented');
    } else if (imageSource.startsWith('http')) {
      params.photo = imageSource;
    } else {
      // File path - Telegram can fetch from URL, but local files need upload
      throw new Error('Local file upload not yet implemented');
    }

    if (caption) {
      params.caption = caption;
    }

    if (options.parseMode) {
      params.parse_mode = options.parseMode;
    }

    if (options.choices) {
      params.reply_markup = this.#buildKeyboard(options.choices, options.inline);
    }

    const result = await this.#callApi('sendPhoto', params);
    const messageId = MessageId.from(result.message_id);

    return { messageId };
  }

  /**
   * Update an existing message
   * @param {import('../../domain/value-objects/ChatId.mjs').ChatId} chatId
   * @param {MessageId} messageId
   * @param {Object} updates
   * @returns {Promise<void>}
   */
  async updateMessage(chatId, messageId, updates) {
    const baseParams = {
      ...this.#extractChatParams(chatId),
      message_id: messageId.toNumber(),
    };

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
    } else if (updates.caption !== undefined) {
      const params = {
        ...baseParams,
        caption: updates.caption,
      };
      if (updates.parseMode) {
        params.parse_mode = updates.parseMode;
      }
      await this.#callApi('editMessageCaption', params);
    } else if (updates.choices !== undefined) {
      await this.updateKeyboard(chatId, messageId, updates.choices);
    }
  }

  /**
   * Update just the keyboard of a message
   * @param {import('../../domain/value-objects/ChatId.mjs').ChatId} chatId
   * @param {MessageId} messageId
   * @param {Array<Array<string|Object>>} choices
   * @returns {Promise<void>}
   */
  async updateKeyboard(chatId, messageId, choices) {
    const params = {
      ...this.#extractChatParams(chatId),
      message_id: messageId.toNumber(),
      reply_markup: this.#buildKeyboard(choices, true),
    };

    await this.#callApi('editMessageReplyMarkup', params);
  }

  /**
   * Delete a message
   * @param {import('../../domain/value-objects/ChatId.mjs').ChatId} chatId
   * @param {MessageId} messageId
   * @returns {Promise<void>}
   */
  async deleteMessage(chatId, messageId) {
    const params = {
      ...this.#extractChatParams(chatId),
      message_id: messageId.toNumber(),
    };

    try {
      await this.#callApi('deleteMessage', params);
    } catch (error) {
      // Ignore "message to delete not found" errors
      if (!error.message?.includes('message to delete not found')) {
        throw error;
      }
      this.#logger.debug('telegram.deleteMessage.notFound', { messageId: messageId.toString() });
    }
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
