/**
 * Push notification adapter backed by Home Assistant.
 * Delivers via HA's notify integration (mobile app push), calling
 * notify.<service> with the intent title/body.
 */
export class PushNotificationAdapter {
  #haGateway;
  #resolveNotifyService;
  #logger;

  get channel() { return 'push'; }

  /**
   * @param {Object} deps
   * @param {Object} [deps.haGateway] - HomeAssistantAdapter-compatible gateway
   *   exposing callService(domain, service, data)
   * @param {Function} [deps.resolveNotifyService] - username -> HA notify service
   *   name (e.g. 'mobile_app_kc_phone'), or null when the user has none configured
   * @param {Object} [deps.logger]
   */
  constructor({ haGateway, resolveNotifyService, logger } = {}) {
    this.#haGateway = haGateway;
    this.#resolveNotifyService = resolveNotifyService;
    this.#logger = logger;
  }

  async send(intent) {
    if (!this.#haGateway) {
      return { delivered: false, error: 'home assistant gateway not configured' };
    }

    const username = intent.metadata?.username;
    const service = username ? this.#resolveNotifyService?.(username) : null;
    if (!service) {
      return { delivered: false, error: `no HA notify service for user "${username}"` };
    }

    try {
      await this.#haGateway.callService('notify', service, {
        title: intent.title,
        message: intent.body,
      });
      this.#logger?.info?.('notification.push.sent', { username, service, category: intent.category });
      return { delivered: true, channelId: `ha-${service}` };
    } catch (error) {
      this.#logger?.warn?.('notification.push.failed', { username, service, error: error.message });
      return { delivered: false, error: error.message };
    }
  }
}
