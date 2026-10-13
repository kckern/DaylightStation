import { NotificationIntent } from '#domains/notification/entities/NotificationIntent.mjs';

function toNotificationRecord(intent) {
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
  #policy;
  #ledgerStore;
  #configLoader;
  #clock;
  #resolveDefaultRecipient;

  /**
   * @param {Object} deps
   * @param {Array<{channel: string, send: Function}>} deps.adapters - Channel adapters
   * @param {Function} deps.preferenceLoader - Returns NotificationPreference for current user
   * @param {Object} [deps.logger]
   * @param {Object} [deps.policy] - NotificationPolicy; enables governance when paired with ledgerStore
   * @param {Object} [deps.ledgerStore] - dedupe/quiet-hours ledger; enables governance when paired with policy
   * @param {Function} [deps.configLoader] - () => ({ quietHours, cooldowns })
   * @param {Object} [deps.clock] - { now: () => Date }
   * @param {Function} [deps.resolveDefaultRecipient] - () => username; the house-wide
   *   fallback addressee for SYSTEM-category intents (see #withResolvedRecipient)
   */
  constructor({ adapters = [], preferenceLoader, logger, policy, ledgerStore, configLoader, clock, resolveDefaultRecipient } = {}) {
    this.#adapters = adapters;
    this.#adapterMap = new Map(adapters.map(a => [a.channel, a]));
    this.#preferenceLoader = preferenceLoader;
    this.#logger = logger;
    this.#pending = [];
    this.#policy = policy;
    this.#ledgerStore = ledgerStore;
    this.#configLoader = configLoader;
    this.#clock = clock;
    this.#resolveDefaultRecipient = resolveDefaultRecipient;
  }

  /**
   * Give a SYSTEM-category intent an addressee when the caller supplied none.
   *
   * Every delivery channel resolves its destination from `metadata.username` —
   * the Telegram adapter turns it into a chat id and refuses without one. That is
   * right for the personal categories: a ceremony nudge or a school backlog
   * reminder is about one person, and guessing a recipient would deliver their
   * prompt to somebody else. So the default is scoped to `system` alone, whose
   * subject is the house rather than a person: a dead relay, a wedged kiosk. Such
   * an alert had no addressee and therefore no delivery, which is how the relay
   * watchdog managed to be both correct and silent.
   *
   * A missing or throwing resolver leaves the intent exactly as it was — the
   * caller then gets the same undelivered result it got before, never an
   * exception on the notification path.
   *
   * @private
   */
  #withResolvedRecipient(intent) {
    if (intent.category !== 'system' || intent.metadata?.username) return intent;
    if (typeof this.#resolveDefaultRecipient !== 'function') return intent;

    let username = null;
    try {
      username = this.#resolveDefaultRecipient() || null;
    } catch (error) {
      this.#logger?.warn?.('notification.default_recipient.failed', { error: error.message });
      return intent;
    }
    if (!username) {
      this.#logger?.warn?.('notification.default_recipient.unresolved', { category: intent.category });
      return intent;
    }

    this.#logger?.debug?.('notification.default_recipient.applied', { username });
    return new NotificationIntent({
      ...toNotificationRecord(intent),
      metadata: { ...intent.metadata, username },
    });
  }

  #nowIso() {
    const now = this.#clock?.now?.() || new Date();
    return (now instanceof Date ? now : new Date(now)).toISOString();
  }

  /**
   * Send a notification intent, routing to channels based on preferences.
   * Accepts a NotificationIntent or a plain object with the same shape
   * (normalized here so callers don't need the domain entity import).
   * @param {NotificationIntent|Object} rawIntent
   * @returns {Promise<Array<{delivered: boolean, channel: string, channelId?: string, error?: string}>>}
   */
  async send(rawIntent) {
    // Resolve the addressee BEFORE governance so the dedupe ledger is keyed on
    // the recipient who actually gets the message rather than on a placeholder.
    const intent = this.#withResolvedRecipient(
      rawIntent instanceof NotificationIntent ? rawIntent : new NotificationIntent({
        ...rawIntent, createdAt: rawIntent?.createdAt ?? this.#nowIso(),
      }),
    );

    // Governance (dedupe + quiet hours). Additive: only active when policy+ledger
    // are wired. Degrades open — a governance error never blocks delivery.
    const governed = this.#policy && this.#ledgerStore;
    let gv = null;
    if (governed) {
      try {
        const now = this.#clock?.now?.() || new Date();
        const username = intent.metadata?.username || null;
        const dedupeKey = intent.dedupeKey || `${intent.category}:${username || '-'}:${String(intent.body || intent.title || '').slice(0, 80)}`;
        const cfg = this.#configLoader?.() || { quietHours: null, cooldowns: {} };
        const cooldownMins = cfg.cooldowns?.[intent.category] ?? cfg.cooldowns?.default ?? 60;
        const cooldownMs = cooldownMins * 60_000;
        const lastSentAt = this.#ledgerStore.getLastSent(username, dedupeKey);
        const decision = this.#policy.evaluate({ intent, lastSentAt, now, quietHours: cfg.quietHours, cooldownMs });
        gv = { now, username, dedupeKey };
        if (!decision.send) {
          this.#ledgerStore.recordSuppressed({ username, dedupeKey, category: intent.category, reason: decision.reason, atMs: now.getTime() });
          this.#logger?.debug?.('notification.suppressed', { category: intent.category, reason: decision.reason, dedupeKey });
          return [{ delivered: false, suppressed: true, reason: decision.reason, channel: null }];
        }
      } catch (error) {
        this.#logger?.warn?.('notification.governance.degraded', { error: error.message });
        gv = null; // fall through and deliver
      }
    }

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
      this.#pending.push({ intent: toNotificationRecord(intent), results, timestamp: new Date().toISOString() });
    }

    if (governed && gv) {
      try {
        this.#ledgerStore.recordSent({ username: gv.username, dedupeKey: gv.dedupeKey, category: intent.category, atMs: gv.now.getTime() });
      } catch (error) {
        this.#logger?.warn?.('notification.governance.degraded', { error: error.message });
      }
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
