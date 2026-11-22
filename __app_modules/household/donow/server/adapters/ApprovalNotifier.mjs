/**
 * ApprovalNotifier — asks a grown-up to approve a DoNow pending request with a
 * push through NotificationService (the Android app, else Home Assistant).
 *
 * The two action ids (`DONOW_APPROVE_<id>` / `DONOW_DENY_<id>`) are the whole
 * callback contract. A press on the Android app reaches
 * `POST /api/v1/notifications/actions` and DoNowActionHandler; on Home Assistant
 * the companion automation keys on the same ids and posts to
 * `POST /api/v1/donow/approvals/:id/approve|deny`, as before.
 */
export class ApprovalNotifier {
  #notificationService;
  #haNotifyService;
  #recipient;
  #makeId;
  #logger;

  /**
   * @param {Object} config
   * @param {{send: Function}} config.notificationService
   * @param {string} [config.notifyService] - The HA notify target from donow config
   *   (`notify.<target>`); kept so the HA path reaches exactly that phone.
   * @param {string} config.recipient - The approver's username.
   */
  constructor({ notificationService, notifyService = null, recipient, makeId = () => globalThis.crypto.randomUUID(), logger } = {}) {
    if (!notificationService?.send) throw new Error('ApprovalNotifier requires notificationService');
    if (!recipient) throw new Error('ApprovalNotifier requires recipient');
    this.#notificationService = notificationService;
    const dot = notifyService ? notifyService.indexOf('.') : -1;
    this.#haNotifyService = notifyService ? (dot >= 0 ? notifyService.slice(dot + 1) : notifyService) : null;
    this.#recipient = recipient;
    this.#makeId = makeId;
    this.#logger = logger || console;
  }

  /** @param {Object} record - A pending record (`{id, label, ...}`). */
  async notify(record) {
    // Labels are article-free lowercase noun phrases; this is the one place a
    // label starts a sentence, so it capitalizes it.
    const sentence = record.label ? record.label.charAt(0).toUpperCase() + record.label.slice(1) : 'This';
    const results = await this.#notificationService.send({
      title: 'Approval needed',
      body: `${sentence} — a grown-up's OK is needed to start.`,
      category: 'approval',
      // Critical: a waiting child is never held back by quiet hours.
      urgency: 'critical',
      recipient: { username: this.#recipient },
      // Immediate delivery (ttl 0 + high importance): a doze-delayed card can
      // outlive the request's TTL (default 120 s). A re-send for the same request
      // replaces its card (tag) without ringing twice (alertOnce).
      presentation: { tag: `donow-${record.id}`, alertOnce: true, ttlSeconds: 0, importance: 'high', channel: 'DoNow approvals' },
      actions: [
        { id: `DONOW_APPROVE_${record.id}`, label: 'Approve', requiresUnlock: true },
        { id: `DONOW_DENY_${record.id}`, label: 'Deny', destructive: true },
      ],
      // Unique per send: a re-send must not be swallowed by the cooldown.
      dedupeKey: `donow:${record.id}:${this.#makeId()}`,
      metadata: { username: this.#recipient, deliveryRequired: 'push', ...(this.#haNotifyService ? { haNotifyService: this.#haNotifyService } : {}) },
    });
    this.#logger.debug?.('donow.notifier.sent', { id: record.id, surface: record.surface, delivered: results?.some?.(r => r.delivered) ?? null });
    return results;
  }
}
