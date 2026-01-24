// backend/src/2_adapters/telegram/TelegramMessagingAdapter.mjs

/**
 * Telegram messaging adapter implementing IMessagingGateway
 */
export class TelegramMessagingAdapter {
  #token;
  #baseUrl;
  #logger;

  constructor(config) {
    if (!config.token) {
      throw new Error('TelegramMessagingAdapter requires token');
    }
    this.#token = config.token;
    this.#baseUrl = `https://api.telegram.org/bot${config.token}`;
    this.#logger = config.logger || console;
  }

  async #callApi(method, params = {}) {
    const response = await fetch(`${this.#baseUrl}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });

    const data = await response.json();

    if (!data.ok) {
      this.#logger.error?.('telegram.api.error', {
        method,
        error: data.description
      });
      throw new Error(`Telegram API error: ${data.description}`);
    }

    return data.result;
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
    const response = await fetch(url);
    return Buffer.from(await response.arrayBuffer());
  }
}
