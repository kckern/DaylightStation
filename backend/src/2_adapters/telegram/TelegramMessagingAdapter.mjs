// backend/src/2_adapters/telegram/TelegramMessagingAdapter.mjs

/**
 * Telegram messaging adapter implementing IMessagingGateway
 */
export class TelegramMessagingAdapter {
  #token;
  #baseUrl;
  #httpClient;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.token - Telegram bot token
   * @param {Object} deps
   * @param {import('#system/services/HttpClient.mjs').HttpClient} deps.httpClient
   * @param {Object} [deps.logger=console]
   */
  constructor(config, deps = {}) {
    if (!config.token) {
      throw new Error('TelegramMessagingAdapter requires token');
    }
    if (!deps.httpClient) {
      throw new Error('TelegramMessagingAdapter requires httpClient');
    }
    this.#token = config.token;
    this.#baseUrl = `https://api.telegram.org/bot${config.token}`;
    this.#httpClient = deps.httpClient;
    this.#logger = deps.logger || console;
  }

  async #callApi(method, params = {}) {
    try {
      const response = await this.#httpClient.post(
        `${this.#baseUrl}/${method}`,
        params
      );

      if (!response.data.ok) {
        this.#logger.error?.('telegram.api.error', {
          method,
          error: response.data.description
        });
        const err = new Error('Telegram API request failed');
        err.code = 'TELEGRAM_API_ERROR';
        err.isTransient = false;
        throw err;
      }

      return response.data.result;
    } catch (error) {
      if (error.code === 'TELEGRAM_API_ERROR') throw error;

      // Wrap HttpError
      this.#logger.error?.('telegram.request.failed', {
        method,
        error: error.message,
        code: error.code
      });
      const wrapped = new Error('Failed to call Telegram API');
      wrapped.code = error.code || 'UNKNOWN_ERROR';
      wrapped.isTransient = error.isTransient || false;
      throw wrapped;
    }
  }

  #extractChatId(userId) {
    if (userId.includes('_')) {
      return userId.split('_').pop();
    }
    return userId;
  }

  async sendMessage(userId, text, options = {}) {
    const chatId = this.#extractChatId(userId);
    const result = await this.#callApi('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: options.parseMode || 'HTML',
      disable_notification: options.silent || false
    });

    this.#logger.debug?.('telegram.message.sent', {
      chatId,
      messageId: result.message_id
    });

    return { messageId: String(result.message_id) };
  }

  async sendPhoto(userId, imageSource, caption, options = {}) {
    const chatId = this.#extractChatId(userId);
    const params = {
      chat_id: chatId,
      caption,
      parse_mode: options.parseMode || 'HTML'
    };

    if (typeof imageSource === 'string') {
      params.photo = imageSource;
    } else {
      throw new Error('Buffer upload not yet implemented');
    }

    const result = await this.#callApi('sendPhoto', params);
    return { messageId: String(result.message_id) };
  }

  async sendKeyboard(userId, text, buttons, options = {}) {
    const chatId = this.#extractChatId(userId);
    const inlineKeyboard = buttons.map(row =>
      row.map(btn => ({
        text: btn.label,
        callback_data: btn.data
      }))
    );

    const result = await this.#callApi('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: options.parseMode || 'HTML',
      reply_markup: { inline_keyboard: inlineKeyboard }
    });

    return { messageId: String(result.message_id) };
  }

  async editMessage(userId, messageId, text, options = {}) {
    const chatId = this.#extractChatId(userId);
    await this.#callApi('editMessageText', {
      chat_id: chatId,
      message_id: parseInt(messageId, 10),
      text,
      parse_mode: options.parseMode || 'HTML'
    });
    return { messageId };
  }

  async editKeyboard(userId, messageId, buttons) {
    const chatId = this.#extractChatId(userId);
    const inlineKeyboard = buttons.map(row =>
      row.map(btn => ({
        text: btn.label,
        callback_data: btn.data
      }))
    );

    await this.#callApi('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: parseInt(messageId, 10),
      reply_markup: { inline_keyboard: inlineKeyboard }
    });
    return { messageId };
  }

  async deleteMessage(userId, messageId) {
    const chatId = this.#extractChatId(userId);
    await this.#callApi('deleteMessage', {
      chat_id: chatId,
      message_id: parseInt(messageId, 10)
    });
    return true;
  }

  async answerCallback(callbackId, text) {
    await this.#callApi('answerCallbackQuery', {
      callback_query_id: callbackId,
      text: text || undefined
    });
    return true;
  }

  async getFileUrl(fileId) {
    const file = await this.#callApi('getFile', { file_id: fileId });
    return `https://api.telegram.org/file/bot${this.#token}/${file.file_path}`;
  }

  async downloadFile(fileId) {
    const url = await this.getFileUrl(fileId);
    return this.#httpClient.downloadBuffer(url);
  }
}
