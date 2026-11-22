import { NotificationAction } from '#domains/notification/value-objects/NotificationAction.mjs';
import { NotificationPresentation } from '#domains/notification/value-objects/NotificationPresentation.mjs';

/**
 * The HA companion-app call for an intent: `{title, message, data}`. `data`
 * carries the rich presentation and push actions translated to the companion
 * app's keys (tag, group, alert_once, ttl, priority, channel, importance, image,
 * clickAction, actions with authenticationRequired / textInput / URI). Legacy
 * `metadata.pushData` keys the model does not hold pass through underneath.
 * Paths become absolute through `publicUrl(path)`; without it, image and links
 * are dropped (the companion app cannot open a relative path).
 */
export function toHaNotifyData(intent, { publicUrl } = {}) {
  const p = intent.presentation instanceof NotificationPresentation ? intent.presentation
    : NotificationPresentation.fromPushData(intent.metadata?.pushData);
  const abs = path => (path && typeof publicUrl === 'function' ? publicUrl(path) : null);
  const t = {};
  if (p.ttlSeconds !== null) t.ttl = p.ttlSeconds;
  if (p.importance === 'high') t.priority = 'high';
  if (p.tag) t.tag = p.tag;
  if (p.group) t.group = p.group;
  if (p.alertOnce) t.alert_once = true;
  if (p.channel) t.channel = p.channel;
  if (p.importance !== 'default') t.importance = p.importance;
  if (abs(p.imageUrl)) t.image = abs(p.imageUrl);
  if (abs(p.deepLink)) t.clickAction = abs(p.deepLink);
  const actions = (intent.actions || []).filter(a => a instanceof NotificationAction).map((a) => {
    if (a.kind === 'open') return abs(a.deepLink) ? { action: 'URI', title: a.label, uri: abs(a.deepLink) } : null;
    const out = { action: a.id, title: a.label };
    if (a.requiresUnlock) out.authenticationRequired = true;
    if (a.kind === 'reply') out.behavior = 'textInput';
    return out;
  }).filter(Boolean);
  if (actions.length) t.actions = actions;
  const legacy = intent.metadata?.pushData && typeof intent.metadata.pushData === 'object' ? intent.metadata.pushData : {};
  const data = { ...legacy, ...t };
  return { title: intent.title, message: intent.body, ...(Object.keys(data).length ? { data } : {}) };
}

/**
 * Push notification adapter backed by Home Assistant.
 * Delivers via HA's notify integration (mobile app push), calling
 * notify.<service> with the intent title/body.
 */
export class PushNotificationAdapter {
  #haGateway;
  #resolveNotifyService;
  #publicUrl;
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
  constructor({ haGateway, resolveNotifyService, publicUrl, logger } = {}) {
    this.#haGateway = haGateway;
    this.#publicUrl = publicUrl;
    this.#resolveNotifyService = resolveNotifyService;
    this.#logger = logger;
  }

  async send(intent) {
    if (!this.#haGateway) {
      return { delivered: false, error: 'home assistant gateway not configured' };
    }

    const username = intent.recipient?.username || intent.metadata?.username;
    const service = username ? this.#resolveNotifyService?.(username) : null;
    if (!service) {
      return { delivered: false, error: `no HA notify service for user "${username}"` };
    }

    try {
      const response=await this.#haGateway.callService('notify', service, toHaNotifyData(intent, { publicUrl: this.#publicUrl }));
      if(response?.ok===false)return {accepted:false,delivered:false,error:'Home Assistant rejected notification'};
      this.#logger?.info?.('notification.push.sent', { username, service, category: intent.category });
      return { ...(intent.metadata?.deliveryRequired==='push'?{accepted:true,delivered:null}:{delivered:true}), channelId: `ha-${service}` };
    } catch (error) {
      this.#logger?.warn?.('notification.push.failed', { username, service, error: error.message });
      return { delivered: false, error: error.message };
    }
  }
}
