/**
 * One thing a person can do from a notification: a button (approve, deny), a
 * quick reply, or opening a page of the app. Transport-neutral: each push
 * adapter translates it. The id is the producer's own string and travels
 * unchanged, so a handler (and any Home Assistant automation) can key on it.
 */
const KINDS = ['button', 'reply', 'open'];
const ID = /^[A-Za-z0-9_.:-]{1,120}$/;

export class NotificationAction {
  constructor({ id, kind = 'button', label, requiresUnlock = false, destructive = false, replyPlaceholder = null, deepLink = null } = {}) {
    if (typeof id !== 'string' || !ID.test(id)) throw new Error(`NotificationAction: invalid id "${id}"`);
    if (!KINDS.includes(kind)) throw new Error(`NotificationAction: invalid kind "${kind}". Valid: ${KINDS.join(', ')}`);
    if (typeof label !== 'string' || label.length < 1 || label.length > 40) throw new Error('NotificationAction: label must be 1-40 characters');
    if (deepLink !== null && (kind !== 'open' || typeof deepLink !== 'string' || !deepLink.startsWith('/'))) {
      throw new Error('NotificationAction: deepLink must be an app path starting with "/" on an open action');
    }
    this.id = id;
    this.kind = kind;
    this.label = label;
    this.requiresUnlock = !!requiresUnlock;
    this.destructive = !!destructive;
    this.replyPlaceholder = kind === 'reply' && typeof replyPlaceholder === 'string' ? replyPlaceholder : null;
    this.deepLink = deepLink;
    Object.freeze(this);
  }

  static from(value) {
    return value instanceof NotificationAction ? value : new NotificationAction(value);
  }
}
