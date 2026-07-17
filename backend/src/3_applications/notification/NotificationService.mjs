import { NotificationIntent } from '#domains/notification/entities/NotificationIntent.mjs';

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

  /**
   * @param {Object} deps
   * @param {Array<{channel: string, send: Function}>} deps.adapters - Channel adapters
   * @param {Function} deps.preferenceLoader - Returns NotificationPreference for current user
   * @param {Object} [deps.logger]
   * @param {Object} [deps.policy] - NotificationPolicy; enables governance when paired with ledgerStore
   * @param {Object} [deps.ledgerStore] - dedupe/quiet-hours ledger; enables governance when paired with policy
   * @param {Function} [deps.configLoader] - () => ({ quietHours, cooldowns })
   * @param {Object} [deps.clock] - { now: () => Date }
   */
  constructor({ adapters = [], preferenceLoader, logger, policy, ledgerStore, configLoader, clock } = {}) {
    this.#adapters = adapters;
    this.#adapterMap = new Map(adapters.map(a => [a.channel, a]));
    this.#preferenceLoader = preferenceLoader;
    this.#logger = logger;
    this.#pending = [];
    this.#policy = policy;
    this.#ledgerStore = ledgerStore;
    this.#configLoader = configLoader;
    this.#clock = clock;
  }

  /**
   * Send a notification intent, routing to channels based on preferences.
   * Accepts a NotificationIntent or a plain object with the same shape
   * (normalized here so callers don't need the domain entity import).
   * @param {NotificationIntent|Object} rawIntent
   * @returns {Promise<Array<{delivered: boolean, channel: string, channelId?: string, error?: string}>>}
   */
  async send(rawIntent) {
    const intent = rawIntent instanceof NotificationIntent
      ? rawIntent
      : new NotificationIntent(rawIntent);

    // Governance (dedupe + quiet hours). Additive: only active when policy+ledger
    // are wired. Degrades open — a governance error never blocks delivery.
    const governed = this.#policy && this.#ledgerStore;
    let gv = null;
    if (governed) {
      try {
        const now = this.#clock?.now?.() || new Date();
        const username = intent.metadata?.username || null;
        const dedupeKey = intent.dedupeKey || `${intent.category}:${username || '-'}:${intent.title || ''}`;
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
      this.#pending.push({ intent: intent.toJSON(), results, timestamp: new Date().toISOString() });
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
