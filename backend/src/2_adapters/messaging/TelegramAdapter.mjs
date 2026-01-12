/**
 * TelegramAdapter - Telegram Bot API adapter
 * Implements IMessagingGateway and INotificationChannel
 */

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
      chat_id: chatId,
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
   */
  async sendImage(chatId, imageSource, caption = '', options = {}) {
    const params = {
      chat_id: chatId
    };

    if (typeof imageSource === 'string') {
      // URL or file_id
      params.photo = imageSource;
    } else {
      // Buffer - would need multipart form handling
      throw new Error('Buffer image upload not yet implemented');
    }

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
   * Edit an existing message
   */
  async updateMessage(chatId, messageId, updates) {
    if (updates.text) {
      const params = {
        chat_id: chatId,
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
        chat_id: chatId,
        message_id: messageId,
        caption: updates.caption
      };

      if (updates.parseMode) {
        params.parse_mode = updates.parseMode;
      }

      await this.callApi('editMessageCaption', params);
    }
  }

  /**
   * Update keyboard on a message
   */
  async updateKeyboard(chatId, messageId, choices) {
    await this.callApi('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: JSON.stringify(this.buildKeyboard(choices, true))
    });
  }

  /**
   * Delete a message
   */
  async deleteMessage(chatId, messageId) {
    await this.callApi('deleteMessage', {
      chat_id: chatId,
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
        return button;
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
   */
  async answerCallbackQuery(callbackQueryId, options = {}) {
    const params = { callback_query_id: callbackQueryId };
    if (options.text) params.text = options.text;
    if (options.showAlert) params.show_alert = true;

    return this.callApi('answerCallbackQuery', params);
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
