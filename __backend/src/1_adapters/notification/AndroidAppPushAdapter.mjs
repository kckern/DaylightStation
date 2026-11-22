import { INotificationChannel } from '#apps/notification/ports/INotificationChannel.mjs';
import { NotificationAction } from '#domains/notification/value-objects/NotificationAction.mjs';

export const ANDROID_ACK_TIMEOUT_MS = 4000;

/** The notification as the DaylightStation Android app reads it (push-receiver capability). */
export function toAndroidWire(intent) {
  const p = intent.presentation || {};
  return {
    id: intent.id,
    title: intent.title,
    body: intent.body,
    category: intent.category,
    urgency: intent.urgency,
    presentation: {
      tag: p.tag ?? null, group: p.group ?? null, alertOnce: !!p.alertOnce, ttlSeconds: p.ttlSeconds ?? null,
      importance: p.importance || 'default', channel: p.channel ?? null, imageUrl: p.imageUrl ?? null,
      icon: p.icon ?? null, deepLink: p.deepLink ?? null,
    },
    actions: (intent.actions || []).filter(a => a instanceof NotificationAction).map(a => ({
      id: a.id, kind: a.kind, label: a.label, requiresUnlock: a.requiresUnlock, destructive: a.destructive,
      replyPlaceholder: a.replyPlaceholder, deepLink: a.deepLink,
    })),
    createdAt: intent.createdAt ?? null,
  };
}

/**
 * Push through the DaylightStation Android app over the WebSocket bus. Sends
 * `push.notification` to the recipient's phone connection and counts it
 * delivered only when that same connection answers `push.ack` in time. A late
 * phone is told `push.cancel`, so the fallback transport is the only one that
 * shows it.
 */
export class AndroidAppPushAdapter extends INotificationChannel {
  #eventBus;
  #registry;
  #ackTimeoutMs;
  #logger;
  #pending = new Map(); // notification id -> { connectionId, resolve }

  get channel() { return 'push-android'; }

  constructor({ eventBus, registry, ackTimeoutMs = ANDROID_ACK_TIMEOUT_MS, logger } = {}) {
    super();
    this.#eventBus = eventBus;
    this.#registry = registry;
    this.#ackTimeoutMs = ackTimeoutMs;
    this.#logger = logger;
    // waitForMessage cannot see which connection answered; this handler can.
    eventBus?.onClientMessage?.((connectionId, message) => {
      if (message?.type !== 'push.ack') return;
      const waiting = this.#pending.get(message.id);
      if (waiting && waiting.connectionId === connectionId) waiting.resolve(true);
    });
  }

  async send(intent) {
    const username = intent.recipient?.username;
    const phone = username ? this.#registry?.currentFor(username) : null;
    if (!phone?.connectionId) return { delivered: false, error: 'phone not connected' };
    if (!intent.id) return { delivered: false, error: 'notification has no id' };

    const acked = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), this.#ackTimeoutMs);
      this.#pending.set(intent.id, { connectionId: phone.connectionId, resolve: (v) => { clearTimeout(timer); resolve(v); } });
    });
    const sent = this.#eventBus.sendToClient(phone.connectionId, { type: 'push.notification', notification: toAndroidWire(intent) });
    if (!sent) {
      this.#pending.get(intent.id)?.resolve(false);
      this.#pending.delete(intent.id);
      return { delivered: false, error: 'phone connection closed' };
    }
    const ok = await acked;
    this.#pending.delete(intent.id);
    if (!ok) {
      this.#eventBus.sendToClient(phone.connectionId, { type: 'push.cancel', id: intent.id });
      this.#logger?.warn?.('notification.android.ack-timeout', { username, id: intent.id, timeoutMs: this.#ackTimeoutMs });
      return { delivered: false, error: 'ack timeout' };
    }
    this.#logger?.info?.('notification.android.delivered', { username, id: intent.id, category: intent.category });
    return { delivered: true, channelId: `android-${phone.deviceId}` };
  }
}
