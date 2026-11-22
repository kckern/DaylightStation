/**
 * How a notification looks and behaves on the phone, independent of transport:
 * replace-by-tag, grouping, ring once, expiry, importance and channel, a picture,
 * an icon and the page a tap opens. Paths are backend-relative ("/..."); an
 * adapter makes them absolute for its transport.
 */
const IMPORTANCE = ['low', 'default', 'high'];
const ICON = /^[a-z0-9-]{1,32}$/;
const isPath = v => typeof v === 'string' && v.startsWith('/') && !v.startsWith('//');

export class NotificationPresentation {
  constructor({ tag = null, group = null, alertOnce = false, ttlSeconds = null, importance = 'default', channel = null, imageUrl = null, icon = null, deepLink = null } = {}) {
    if (!IMPORTANCE.includes(importance)) throw new Error(`NotificationPresentation: invalid importance "${importance}"`);
    if (imageUrl !== null && !isPath(imageUrl)) throw new Error('NotificationPresentation: imageUrl must be a backend path starting with "/"');
    if (deepLink !== null && !isPath(deepLink)) throw new Error('NotificationPresentation: deepLink must be an app path starting with "/"');
    if (icon !== null && !ICON.test(icon)) throw new Error(`NotificationPresentation: invalid icon key "${icon}"`);
    if (ttlSeconds !== null && !(Number.isInteger(ttlSeconds) && ttlSeconds >= 0)) throw new Error('NotificationPresentation: ttlSeconds must be a non-negative integer');
    this.tag = tag;
    this.group = group;
    this.alertOnce = !!alertOnce;
    this.ttlSeconds = ttlSeconds;
    this.importance = importance;
    this.channel = channel;
    this.imageUrl = imageUrl;
    this.icon = icon;
    this.deepLink = deepLink;
    Object.freeze(this);
  }

  static from(value) {
    return value instanceof NotificationPresentation ? value : new NotificationPresentation(value || {});
  }

  /**
   * The legacy Home Assistant companion-app block producers composed before this
   * model existed. Tolerant: a field the model cannot hold (an absolute image) is
   * dropped rather than failing the push.
   */
  static fromPushData(data) {
    if (!data || typeof data !== 'object') return new NotificationPresentation();
    const importance = IMPORTANCE.includes(data.importance) ? data.importance
      : data.priority === 'high' ? 'high' : 'default';
    return new NotificationPresentation({
      tag: data.tag ?? null,
      group: data.group ?? null,
      alertOnce: !!data.alert_once,
      ttlSeconds: Number.isInteger(data.ttl) && data.ttl >= 0 ? data.ttl : null,
      importance,
      channel: data.channel ?? null,
      imageUrl: isPath(data.image) ? data.image : null,
      deepLink: isPath(data.clickAction) ? data.clickAction : null,
    });
  }
}
