/**
 * In-app notification adapter.
 * Broadcasts notifications via WebSocketEventBus for real-time frontend delivery.
 */
export class AppNotificationAdapter {
  #eventBus;

  get channel() { return 'app'; }

  constructor({ eventBus } = {}) {
    this.#eventBus = eventBus;
  }

  async send(intent) {
    if (!this.#eventBus) {
      return { delivered: false, error: 'eventBus not configured' };
    }

    try {
      this.#eventBus.broadcast('notification', intent.toJSON());
      return { delivered: true, channelId: `app-${Date.now()}` };
    } catch (error) {
      return { delivered: false, error: error.message };
    }
  }
}
