/**
 * Notification orchestration service.
 * Resolves preferences, routes intents to appropriate channel adapters.
 */
export class NotificationService {
  #adapters;
  #adapterMap;
  #preferenceLoader;
  #logger;
  #pending;

  /**
   * @param {Object} deps
   * @param {Array<{channel: string, send: Function}>} deps.adapters - Channel adapters
   * @param {Function} deps.preferenceLoader - Returns NotificationPreference for current user
   * @param {Object} [deps.logger]
   */
  constructor({ adapters = [], preferenceLoader, logger } = {}) {
    this.#adapters = adapters;
    this.#adapterMap = new Map(adapters.map(a => [a.channel, a]));
    this.#preferenceLoader = preferenceLoader;
    this.#logger = logger;
    this.#pending = [];
  }

  /**
   * Send a notification intent, routing to channels based on preferences.
   * @param {import('#domains/notification/entities/NotificationIntent.mjs').NotificationIntent} intent
   * @returns {Promise<Array<{delivered: boolean, channel: string, channelId?: string, error?: string}>>}
   */
  async send(intent) {
    const preference = this.#preferenceLoader?.();
    const channels = preference
      ? preference.getChannelsFor(intent.category, intent.urgency)
      : ['app'];

    this.#logger?.debug?.('notification.routing', {
      category: intent.category,
      urgency: intent.urgency,
      channels,
    });

    const results = [];

    for (const channel of channels) {
      const adapter = this.#adapterMap.get(channel);
      if (adapter) {
        try {
          const result = await adapter.send(intent);
          results.push({ ...result, channel });
        } catch (error) {
          this.#logger?.warn?.('notification.send.error', {
            channel,
            error: error.message,
          });
          results.push({ delivered: false, channel, error: error.message });
        }
      } else {
        this.#logger?.debug?.('notification.adapter.missing', { channel });
      }
    }

    // If no adapter delivered, fall back to app
    if (results.length === 0) {
      const appAdapter = this.#adapterMap.get('app');
      if (appAdapter) {
        try {
          const result = await appAdapter.send(intent);
          results.push({ ...result, channel: 'app' });
        } catch (error) {
          results.push({ delivered: false, channel: 'app', error: error.message });
        }
      }
    }

    // Track undelivered for in-app pending list
    const anyDelivered = results.some(r => r.delivered);
    if (!anyDelivered) {
      this.#pending.push({ intent: intent.toJSON(), results, timestamp: new Date().toISOString() });
    }

    return results;
  }

  /**
   * Get pending (undelivered) notifications.
   */
  getPending() {
    return [...this.#pending];
  }

  /**
   * Dismiss a pending notification by index.
   */
  dismiss(index) {
    if (index >= 0 && index < this.#pending.length) {
      this.#pending.splice(index, 1);
      return true;
    }
    return false;
  }
}
