/**
 * Telegram notification adapter.
 * Wraps the messaging TelegramAdapter for notification delivery, resolving
 * the recipient chat id from the intent's metadata.username.
 */
export class TelegramNotificationAdapter {
  #getTelegramAdapter;
  #resolveChatId;
  #publicBaseUrl;
  #logger;

  get channel() { return 'telegram'; }

  /**
   * @param {Object} deps
   * @param {Object|Function} deps.telegramAdapter - TelegramAdapter instance, or a
   *   thunk returning one (lets the composition root inject an adapter that is
   *   constructed later in startup)
   * @param {Function} deps.resolveChatId - username -> telegram chat id (or null)
   * @param {string} [deps.publicBaseUrl] - Absolute base URL for turning an intent
   *   action's relative `data.url` (e.g. "/life/ceremony/…") into a tappable inline
   *   button. When unset, actions are ignored and the nudge is plain text only.
   * @param {Object} [deps.logger]
   */
  constructor({ telegramAdapter, resolveChatId, publicBaseUrl, logger } = {}) {
    this.#getTelegramAdapter = typeof telegramAdapter === 'function'
      ? telegramAdapter
      : () => telegramAdapter;
    this.#resolveChatId = resolveChatId;
    this.#publicBaseUrl = publicBaseUrl || null;
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

      // Turn the intent's actions into a one-row inline keyboard when a public base
      // URL is configured. The messaging TelegramAdapter.sendMessage has no raw
      // reply_markup option — it derives params.reply_markup from `choices` (rows of
      // buttons) and requires `inline: true` for a button's `url` to be preserved.
      const buttons = (intent.actions || [])
        .filter(a => a?.data?.url && this.#publicBaseUrl)
        .map(a => ({ text: a.label || 'Open', url: new URL(a.data.url, this.#publicBaseUrl).href }));
      const opts = { parseMode: 'Markdown' };
      if (buttons.length) {
        opts.choices = [buttons];
        opts.inline = true;
      }

      await adapter.sendMessage(chatId, text, opts);
      this.#logger?.info?.('notification.telegram.sent', {
        username,
        category: intent.category,
        buttons: buttons.length,
      });
      return { delivered: true, channelId: `tg-${chatId}` };
    } catch (error) {
      this.#logger?.warn?.('notification.telegram.failed', { username, error: error.message });
      return { delivered: false, error: error.message };
    }
  }
}
