import { INotificationChannel } from './ports/INotificationChannel.mjs';
import { choosePushTransport } from '#domains/notification/services/PushRoute.mjs';
import { NotificationAction } from '#domains/notification/value-objects/NotificationAction.mjs';

/**
 * The `push` channel: the DaylightStation Android app when the recipient's
 * phone is connected and fresh and acknowledges, otherwise the Home Assistant
 * companion app. Exactly one transport shows a notification: the Android
 * adapter cancels on its phone before this falls back.
 */
export class CompositePushChannel extends INotificationChannel {
  #android;
  #ha;
  #registry;
  #clock;
  #logger;

  get channel() { return 'push'; }

  constructor({ android, ha, registry, clock, logger } = {}) {
    super();
    this.#android = android;
    this.#ha = ha;
    this.#registry = registry;
    this.#clock = clock;
    this.#logger = logger;
  }

  async send(intent) {
    const username = intent.recipient?.username || intent.metadata?.username || null;
    const phone = username && this.#registry ? this.#registry.currentFor(username) : null;
    const nowMs = (this.#clock?.now?.() || new Date()).getTime();
    const answerable = (intent.actions || []).some(a => a instanceof NotificationAction && a.kind !== 'open');
    const route = this.#android ? choosePushTransport({ phone, nowMs, answerable }) : 'ha';

    let fellBack = false;
    if (route === 'android') {
      const result = await this.#android.send(intent);
      if (result.delivered) return this.#done(intent, username, result, 'android', false);
      fellBack = true;
    }
    const result = this.#ha ? await this.#ha.send(intent) : { delivered: false, error: 'no push transport' };
    return this.#done(intent, username, result, 'ha', fellBack);
  }

  #done(intent, username, result, transport, fellBack) {
    this.#logger?.info?.('notification.push.route', { id: intent.id ?? null, username, category: intent.category, transport, fellBack, delivered: result.delivered ?? null });
    return { ...result, transport, fellBack };
  }
}
