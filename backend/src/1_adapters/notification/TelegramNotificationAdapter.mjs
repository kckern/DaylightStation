/**
 * Telegram notification adapter.
 * Wraps the existing TelegramAdapter for notification delivery.
 * Skeleton — will be wired when TelegramAdapter is available in the codebase.
 */
export class TelegramNotificationAdapter {
  #telegramAdapter;

  get channel() { return 'telegram'; }

  constructor({ telegramAdapter } = {}) {
    this.#telegramAdapter = telegramAdapter;
  }

  async send(intent) {
    if (!this.#telegramAdapter) {
      return { delivered: false, error: 'telegram adapter not configured' };
    }

    try {
      const message = `*${intent.title}*\n${intent.body}`;
      await this.#telegramAdapter.sendMessage(message);
      return { delivered: true, channelId: `tg-${Date.now()}` };
    } catch (error) {
      return { delivered: false, error: error.message };
    }
  }
}
