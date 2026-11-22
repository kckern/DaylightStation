import { isNotificationActionHandler } from '../ports/INotificationActionHandler.mjs';

/**
 * A press on a notification action (a button, a quick reply), from the Android
 * app or relayed by Home Assistant, handed to the app that owns that action id.
 */
export class RespondToNotificationAction {
  #handlers;
  #logger;
  #deviceAuth;

  constructor({ handlers = [], deviceAuth = null, logger } = {}) {
    this.#deviceAuth = deviceAuth;
    this.#handlers = [];
    this.#logger = logger;
    handlers.forEach(h => this.register(h));
  }

  /** Apps register at composition, after this use case exists. */
  register(handler) {
    if (!isNotificationActionHandler(handler)) throw new Error('RespondToNotificationAction: not an action handler (needs matches and handle)');
    this.#handlers.push(handler);
  }

  async execute({ notificationId, actionId, reply = null, username = null }) {
    const press = { notificationId, actionId, reply, username };
    if (this.#deviceAuth && !this.#deviceAuth.allowPress(press)) {
      this.#logger?.warn?.('notification.action.unauthorized', { notificationId, actionId, username });
      return { ok: false, code: 'DEVICE_UNAUTHORIZED' };
    }
    const handler = this.#handlers.find(h => h.matches(actionId));
    if (!handler) {
      this.#logger?.warn?.('notification.action.unknown', { notificationId, actionId, username });
      return { ok: false, code: 'ACTION_UNKNOWN' };
    }
    this.#logger?.info?.('notification.action.received', { notificationId, actionId, username, hasReply: !!reply });
    const result = await handler.handle(press);
    this.#logger?.info?.('notification.action.handled', { notificationId, actionId, ok: !!result?.ok, code: result?.code ?? null });
    return result?.ok ? { ok: true } : { ok: false, code: result?.code || 'ACTION_REFUSED' };
  }
}
