/**
 * TelegramAdapter - Telegram Bot API adapter
 * Implements IMessagingGateway and INotificationChannel
 */

import { readBinary, getBasename, fileExists } from '../../0_infrastructure/utils/FileIO.mjs';
import { TelegramChatRef } from '../telegram/TelegramChatRef.mjs';
import { ConversationId } from '../../1_domains/messaging/value-objects/ConversationId.mjs';

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

export class TelegramAdapter {
  constructor({ token, httpClient, transcriptionService, logger }) {
    if (!token) {
      throw new Error('Telegram bot token is required');
    }
    this.token = token;
    this.httpClient = httpClient || { get: fetch, post: fetch };
    this.transcriptionService = transcriptionService;
    this.logger = logger || console;
    this.botInfo = null;

    // Metrics
    this.metrics = {
      startedAt: Date.now(),
      messagesSent: 0,
      messagesReceived: 0,
      errors: 0
    };
  }

  /**
   * Make a Telegram API request
   */
  async callApi(method, params = {}, httpMethod = 'POST') {
    const url = `${TELEGRAM_API_BASE}${this.token}/${method}`;

    try {
      let response;
      if (httpMethod === 'GET') {
        const queryString = new URLSearchParams(params).toString();
        const fullUrl = queryString ? `${url}?${queryString}` : url;
        response = await this.httpClient.get(fullUrl);
      } else {
        response = await this.httpClient.post(url, params);
      }

      const data = response.data || response;
      if (!data.ok) {
        this.metrics.errors++;
        this.logger.error?.('telegram.api.error', { method, error: data.description });
        const apiError = new Error(data.description || 'Unknown Telegram API error');
        apiError._isApiError = true;
        throw apiError;
      }

      return data.result;
    } catch (error) {
      // Only increment errors for network-level failures (not already-handled API errors)
      if (!error._isApiError) {
        this.metrics.errors++;
        this.logger.error?.('telegram.api.error', { method, error: error.message });
      }
      throw error;
    }
  }

  // ============ IMessagingGateway Implementation ============

  /**
   * Send a text message
   */
  async sendMessage(chatId, text, options = {}) {
    const params = {
      chat_id: this.extractChatId(chatId),
      text
    };

    if (options.parseMode) {
      params.parse_mode = options.parseMode;
    }

    if (options.removeKeyboard) {
      params.reply_markup = JSON.stringify({ remove_keyboard: true });
    } else if (options.choices) {
      params.reply_markup = JSON.stringify(
        this.buildKeyboard(options.choices, options.inline)
      );
    }

    const result = await this.callApi('sendMessage', params);
    this.metrics.messagesSent++;

    this.logger.debug?.('telegram.message.sent', {
      chatId,
      messageId: result.message_id
    });

    return {
      messageId: result.message_id.toString(),
      ok: true
    };
  }

  /**
   * Send an image
   * Alias: sendPhoto (for IMessagingGateway interface)
   * Supports: URLs, file_ids, local file paths, and Buffers
   */
  async sendImage(chatId, imageSource, caption = '', options = {}) {
    const numericChatId = this.extractChatId(chatId);

    // Check if imageSource is a local file path
    const isLocalPath = typeof imageSource === 'string' &&
      (imageSource.startsWith('/') || /^[A-Za-z]:[\\/]/.test(imageSource));

    // Check if imageSource is a Buffer
    const isBuffer = Buffer.isBuffer(imageSource);

    if (isLocalPath || isBuffer) {
      // Use multipart form upload for local files and buffers
      return this.#sendImageMultipart(numericChatId, imageSource, caption, options);
    }

    // URL or file_id - use standard API call
    const params = {
      chat_id: numericChatId,
      photo: imageSource
    };

    if (caption) {
      params.caption = caption;
    }

    if (options.parseMode) {
      params.parse_mode = options.parseMode;
    }

    if (options.choices) {
      params.reply_markup = JSON.stringify(
        this.buildKeyboard(options.choices, options.inline)
      );
    }

    const result = await this.callApi('sendPhoto', params);
    this.metrics.messagesSent++;

    return {
      messageId: result.message_id.toString(),
      ok: true
    };
  }

  /**
   * Send image via multipart form data (for local files and buffers)
   * @private
   */
  async #sendImageMultipart(chatId, imageSource, caption, options) {
    const FormData = (await import('form-data')).default;
    const axios = (await import('axios')).default;
    const form = new FormData();

    form.append('chat_id', chatId.toString());

    if (Buffer.isBuffer(imageSource)) {
      form.append('photo', imageSource, { filename: 'image.png', contentType: 'image/png' });
    } else {
      // Local file path - use FileIO utilities
      const fileBuffer = readBinary(imageSource);
      if (!fileBuffer) {
        throw new Error(`File not found: ${imageSource}`);
      }
      const filename = getBasename(imageSource);
      form.append('photo', fileBuffer, { filename, contentType: 'image/png' });
    }

    if (caption) {
      form.append('caption', caption);
    }

    if (options.parseMode) {
      form.append('parse_mode', options.parseMode);
    }

    if (options.choices) {
      form.append('reply_markup', JSON.stringify(
        this.buildKeyboard(options.choices, options.inline)
      ));
    }

    const url = `${TELEGRAM_API_BASE}${this.token}/sendPhoto`;

    try {
      const response = await axios.post(url, form, {
        headers: form.getHeaders()
      });

      const data = response.data;

      if (!data.ok) {
        this.metrics.errors++;
        this.logger.error?.('telegram.api.error', { method: 'sendPhoto', error: data.description });
        throw new Error(data.description || 'Telegram API error');
      }

      this.metrics.messagesSent++;

      return {
        messageId: data.result.message_id.toString(),
        ok: true
      };
    } catch (error) {
      this.metrics.errors++;
      const errData = error.response?.data;
      this.logger.error?.('telegram.api.multipart_error', {
        method: 'sendPhoto',
        status: error.response?.status,
        error: errData?.description || error.message
      });
      throw new Error(errData?.description || error.message);
    }
  }

  /**
   * Alias for sendImage (IMessagingGateway interface)
   * @param {string} chatId - Chat ID or conversationId
   * @param {string} imageSource - File ID or URL
   * @param {Object} options - Options including caption, choices, inline
   */
  async sendPhoto(chatId, imageSource, options = {}) {
    const { caption = '', ...rest } = options;
    return this.sendImage(chatId, imageSource, caption, rest);
  }

  /**
   * Edit an existing message
   */
  async updateMessage(chatId, messageId, updates) {
    const numericChatId = this.extractChatId(chatId);

    // Handle string shorthand: updateMessage(chatId, msgId, "text") -> { text: "text" }
    if (typeof updates === 'string') {
      updates = { text: updates };
    }

    if (updates.text) {
      const params = {
        chat_id: numericChatId,
        message_id: messageId,
        text: updates.text
      };

      if (updates.parseMode) {
        params.parse_mode = updates.parseMode;
      }

      if (updates.choices) {
        params.reply_markup = JSON.stringify(
          this.buildKeyboard(updates.choices, true)
        );
      }

      await this.callApi('editMessageText', params);
    } else if (updates.caption) {
      const params = {
        chat_id: numericChatId,
        message_id: messageId,
        caption: updates.caption
      };

      if (updates.parseMode) {
        params.parse_mode = updates.parseMode;
      }

      if (updates.choices) {
        params.reply_markup = JSON.stringify(
          this.buildKeyboard(updates.choices, true)
        );
      }

      await this.callApi('editMessageCaption', params);
    } else if ('choices' in updates) {
      // Only updating keyboard (removing buttons)
      const params = {
        chat_id: numericChatId,
        message_id: messageId,
      };

      if (updates.choices && updates.choices.length > 0) {
        params.reply_markup = JSON.stringify(
          this.buildKeyboard(updates.choices, true)
        );
      } else {
        // Empty inline_keyboard to remove buttons
        params.reply_markup = JSON.stringify({ inline_keyboard: [] });
      }

      await this.callApi('editMessageReplyMarkup', params);
    }
  }

  /**
   * Update keyboard on a message
   * Pass null/empty choices to remove keyboard
   */
  async updateKeyboard(chatId, messageId, choices) {
    const params = {
      chat_id: this.extractChatId(chatId),
      message_id: messageId
    };

    // Handle null/empty choices - removes keyboard
    if (choices && choices.length > 0) {
      params.reply_markup = JSON.stringify(this.buildKeyboard(choices, true));
    } else {
      // Empty inline_keyboard to remove buttons
      params.reply_markup = JSON.stringify({ inline_keyboard: [] });
    }

    await this.callApi('editMessageReplyMarkup', params);
  }

  /**
   * Edit message reply markup (alias for updateKeyboard with raw markup)
   */
  async editMessageReplyMarkup(chatId, messageId, replyMarkup) {
    const params = {
      chat_id: this.extractChatId(chatId),
      message_id: messageId
    };
    if (replyMarkup) {
      params.reply_markup = typeof replyMarkup === 'string' ? replyMarkup : JSON.stringify(replyMarkup);
    }
    await this.callApi('editMessageReplyMarkup', params);
  }

  /**
   * Delete a message
   */
  async deleteMessage(chatId, messageId) {
    await this.callApi('deleteMessage', {
      chat_id: this.extractChatId(chatId),
      message_id: messageId
    });
  }

  /**
   * Transcribe a voice message
   */
  async transcribeVoice(fileId) {
    if (!this.transcriptionService) {
      throw new Error('Transcription service not configured');
    }

    const fileUrl = await this.getFileUrl(fileId);
    return this.transcriptionService.transcribe(fileUrl);
  }

  /**
   * Get download URL for a file
   */
  async getFileUrl(fileId) {
    const file = await this.callApi('getFile', { file_id: fileId });
    return `https://api.telegram.org/file/bot${this.token}/${file.file_path}`;
  }

  // ============ INotificationChannel Implementation ============

  /**
   * Send a notification
   */
  async send(notification) {
    const chatId = notification.recipient;
    const text = notification.title
      ? `*${notification.title}*\n\n${notification.body}`
      : notification.body;

    await this.sendMessage(chatId, text, {
      parseMode: 'Markdown'
    });

    this.logger.info?.('telegram.notification.sent', {
      notificationId: notification.id,
      recipient: chatId
    });
  }

  // ============ Bot Management ============

  /**
   * Get bot information
   */
  async getBotInfo() {
    if (!this.botInfo) {
      this.botInfo = await this.callApi('getMe', {}, 'GET');
    }
    return this.botInfo;
  }

  /**
   * Set webhook URL
   */
  async setWebhook(url, options = {}) {
    const params = { url };

    if (options.secretToken) {
      params.secret_token = options.secretToken;
    }
    if (options.allowedUpdates) {
      params.allowed_updates = options.allowedUpdates;
    }
    if (options.maxConnections) {
      params.max_connections = options.maxConnections;
    }
    if (options.dropPendingUpdates) {
      params.drop_pending_updates = true;
    }

    this.logger.info?.('telegram.webhook.set', { url });
    return this.callApi('setWebhook', params);
  }

  /**
   * Delete webhook
   */
  async deleteWebhook(options = {}) {
    const params = {};
    if (options.dropPendingUpdates) {
      params.drop_pending_updates = true;
    }
    return this.callApi('deleteWebhook', params);
  }

  /**
   * Get webhook info
   */
  async getWebhookInfo() {
    return this.callApi('getWebhookInfo', {}, 'GET');
  }

  /**
   * Set bot commands
   */
  async setCommands(commands) {
    const validatedCommands = commands.map(cmd => ({
      command: cmd.command.replace(/^\//, '').toLowerCase(),
      description: cmd.description
    }));

    return this.callApi('setMyCommands', { commands: validatedCommands });
  }

  // ============ Helper Methods ============

  /**
   * Extract numeric chat ID from conversationId format
   * Uses TelegramChatRef for proper parsing of domain ConversationId
   * Also handles raw numeric IDs for backwards compatibility
   */
  extractChatId(conversationId) {
    if (!conversationId) return conversationId;

    // Already a numeric ID
    if (/^-?\d+$/.test(conversationId)) {
      return conversationId;
    }

    // Parse domain ConversationId format using TelegramChatRef
    if (conversationId.startsWith('telegram:')) {
      try {
        const domainConvId = ConversationId.parse(conversationId);
        const telegramRef = TelegramChatRef.fromConversationId(domainConvId);
        return telegramRef.chatId;
      } catch (e) {
        this.logger.warn?.('telegram.chatId.parseError', { conversationId, error: e.message });
      }
    }

    // Fallback: return as-is and let Telegram API reject it
    this.logger.warn?.('telegram.chatId.unparseable', { conversationId });
    return conversationId;
  }

  /**
   * Build keyboard markup
   */
  buildKeyboard(choices, inline = false) {
    const keyboard = choices.map(row =>
      row.map(button => {
        if (typeof button === 'string') {
          return inline
            ? { text: button, callback_data: button }
            : { text: button };
        }
        // Transform label/data to text/callback_data if needed
        const text = button.text || button.label;
        const callback_data = button.callback_data || button.data;
        if (inline) {
          return { text, callback_data };
        }
        return { text };
      })
    );

    if (inline) {
      return { inline_keyboard: keyboard };
    }
    return {
      keyboard,
      resize_keyboard: true,
      one_time_keyboard: true
    };
  }

  /**
   * Parse incoming update
   */
  parseUpdate(update) {
    if (update.message) {
      return {
        type: update.message.voice ? 'voice'
          : update.message.photo ? 'image'
          : update.message.document ? 'document'
          : 'text',
        chatId: update.message.chat.id.toString(),
        messageId: update.message.message_id.toString(),
        senderId: update.message.from?.id.toString(),
        content: update.message.text || update.message.caption || null,
        raw: update.message
      };
    }

    if (update.callback_query) {
      return {
        type: 'callback',
        chatId: update.callback_query.message?.chat.id.toString(),
        messageId: update.callback_query.message?.message_id.toString(),
        senderId: update.callback_query.from?.id.toString(),
        content: update.callback_query.data,
        raw: update.callback_query
      };
    }

    return null;
  }

  /**
   * Answer callback query (acknowledge button press)
   * Alias: answerCallback (for IMessagingGateway interface)
   */
  async answerCallbackQuery(callbackQueryId, options = {}) {
    const params = { callback_query_id: callbackQueryId };
    if (options.text) params.text = options.text;
    if (options.showAlert) params.show_alert = true;

    return this.callApi('answerCallbackQuery', params);
  }

  /**
   * Alias for answerCallbackQuery (IMessagingGateway interface)
   */
  async answerCallback(callbackId, text) {
    return this.answerCallbackQuery(callbackId, text ? { text } : {});
  }

  /**
   * Get adapter metrics
   */
  getMetrics() {
    return {
      uptime: {
        ms: Date.now() - this.metrics.startedAt,
        formatted: this.formatDuration(Date.now() - this.metrics.startedAt)
      },
      totals: {
        messagesSent: this.metrics.messagesSent,
        messagesReceived: this.metrics.messagesReceived,
        errors: this.metrics.errors
      }
    };
  }

  /**
   * Format duration
   */
  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }

  /**
   * Check if adapter is configured
   */
  isConfigured() {
    return !!this.token;
  }
}

export default TelegramAdapter;
