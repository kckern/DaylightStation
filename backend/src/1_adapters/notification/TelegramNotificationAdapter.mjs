/**
 * Telegram notification adapter.
 * Wraps the messaging TelegramAdapter for notification delivery, resolving
 * the recipient chat id from the intent's metadata.username.
 */
export class TelegramNotificationAdapter {
  #getTelegramAdapter;
  #resolveChatId;
  #logger;

  get channel() { return 'telegram'; }

  /**
   * @param {Object} deps
   * @param {Object|Function} deps.telegramAdapter - TelegramAdapter instance, or a
   *   thunk returning one (lets the composition root inject an adapter that is
   *   constructed later in startup)
   * @param {Function} deps.resolveChatId - username -> telegram chat id (or null)
   * @param {Object} [deps.logger]
   */
  constructor({ telegramAdapter, resolveChatId, logger } = {}) {
    this.#getTelegramAdapter = typeof telegramAdapter === 'function'
      ? telegramAdapter
      : () => telegramAdapter;
    this.#resolveChatId = resolveChatId;
    this.#logger = logger;
  }

  async send(intent) {
    const adapter = this.#getTelegramAdapter();
    if (!adapter) {
      return { delivered: false, error: 'telegram adapter not configured' };
    }

    const username = intent.metadata?.username;
    const chatId = username ? this.#resolveChatId?.(username) : null;
    if (!chatId) {
      return { delivered: false, error: `no telegram chat id for user "${username}"` };
    }

    try {
      const text = intent.title ? `*${intent.title}*\n\n${intent.body}` : intent.body;
      await adapter.sendMessage(chatId, text, { parseMode: 'Markdown' });
      this.#logger?.info?.('notification.telegram.sent', { username, category: intent.category });
      return { delivered: true, channelId: `tg-${chatId}` };
    } catch (error) {
      this.#logger?.warn?.('notification.telegram.failed', { username, error: error.message });
      return { delivered: false, error: error.message };
    }
  }
}
