/**
 * In-app notification adapter.
 * Broadcasts notifications via WebSocketEventBus for real-time frontend delivery.
 */
export function serializeNotificationIntent(intent) {
  return {
    title: intent.title,
    body: intent.body,
    category: intent.category,
    urgency: intent.urgency,
    actions: intent.actions,
    metadata: intent.metadata,
    dedupeKey: intent.dedupeKey,
    createdAt: intent.createdAt,
  };
}

import { INotificationChannel } from '#apps/notification/ports/INotificationChannel.mjs';

export class AppNotificationAdapter extends INotificationChannel {
  #eventBus;

  get channel() { return 'app'; }

  constructor({ eventBus } = {}) {
    super();
    this.#eventBus = eventBus;
  }

  async send(intent) {
    if (!this.#eventBus) {
      return { delivered: false, error: 'eventBus not configured' };
    }

    try {
      this.#eventBus.broadcast('notification', serializeNotificationIntent(intent));
      return { delivered: true, channelId: `app-${Date.now()}` };
    } catch (error) {
      return { delivered: false, error: error.message };
    }
  }
}
