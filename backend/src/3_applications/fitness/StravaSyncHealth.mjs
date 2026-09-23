/**
 * StravaSyncHealth — watches the Strava pipeline for success, not for errors.
 *
 * The 2026-09 audit found the hourly sweep had failed 1407 times in five days
 * and every rename webhook had been dropped, all of it logged and none of it
 * read. So each stage reports what it did, `evaluate()` (its own 15-minute
 * task, no provider calls) decides whether a stage has gone stale, and a
 * healthy→stale or stale→healthy transition sends one push.
 *
 * Stages:
 * - harvest   — hourly harvest succeeded within HARVEST_STALE_MS
 * - sweep     — reconciliation sweep succeeded within SWEEP_STALE_MS and has
 *               not failed SWEEP_MAX_FAILURES times in a row
 * - webhook   — every activity the harvester has seen for WEBHOOK_GRACE_MS has
 *               a webhook job (catches a dead or unsubscribed webhook)
 * - integrity — no Strava-only session stays flagged for INTEGRITY_STALE_MS
 *
 * @module applications/fitness/StravaSyncHealth
 */

import { composeStravaSyncPush } from '#domains/fitness/notifications/stravaSyncPush.mjs';

const HOUR = 60 * 60 * 1000;
const HARVEST_STALE_MS = 3 * HOUR;
const SWEEP_STALE_MS = 3 * HOUR;
const SWEEP_MAX_FAILURES = 3;
const WEBHOOK_GRACE_MS = HOUR;
const WEBHOOK_LOOKBACK_MS = 48 * HOUR;
const WEBHOOK_FORGET_MS = 7 * 24 * HOUR;
const INTEGRITY_STALE_MS = 24 * HOUR;
const STAGES = ['harvest', 'sweep', 'webhook', 'integrity'];

const emptyStage = () => ({ lastSuccessAt: null, lastFailureAt: null, consecutiveFailures: 0, lastError: null });

export class StravaSyncHealth {
  #store;
  #sendPush;
  #hasWebhookJob;
  #now;
  #timezone;
  #logger;
  #state;

  /**
   * @param {Object} deps
   * @param {{load: Function, save: Function}} deps.store - ISyncHealthStore
   * @param {Function} deps.sendPush - async ({title, message, data}) => void
   * @param {Function} deps.hasWebhookJob - (activityId: string) => boolean
   * @param {Function} [deps.now] - () => Date
   * @param {string} [deps.timezone]
   * @param {Object} [deps.logger]
   */
  constructor({ store, sendPush, hasWebhookJob, now = () => new Date(), timezone = null, logger = console }) {
    if (!store?.load || !store?.save) throw new TypeError('StravaSyncHealth requires store with load() and save()');
    this.#store = store;
    this.#sendPush = sendPush || (async () => {});
    this.#hasWebhookJob = hasWebhookJob || (() => true);
    this.#now = now;
    this.#timezone = timezone;
    this.#logger = logger;
    this.#state = this.#hydrate(store.load());
  }

  #hydrate(saved) {
    const s = saved && typeof saved === 'object' ? saved : {};
    return {
      startedAt: s.startedAt || this.#now().toISOString(),
      harvest: { ...emptyStage(), ...(s.harvest || {}) },
      sweep: { ...emptyStage(), ...(s.sweep || {}), unresolved: s.sweep?.unresolved || [] },
      webhook: { seen: s.webhook?.seen || {} },
      integrity: { flagged: s.integrity?.flagged || {} },
      dropped: s.dropped || {},
      alerts: s.alerts || {},
    };
  }

  #persist() {
    try { this.#store.save(this.#state); } catch (err) {
      this.#logger.warn?.('strava.sync_health.save_failed', { error: err?.message });
    }
  }

  #record(stage, ok, error) {
    const rec = this.#state[stage];
    const at = this.#now().toISOString();
    if (ok) {
      rec.lastSuccessAt = at;
      rec.consecutiveFailures = 0;
    } else {
      rec.lastFailureAt = at;
      rec.consecutiveFailures += 1;
      rec.lastError = error ? String(error).slice(0, 300) : rec.lastError;
    }
  }

  /**
   * @param {{ok: boolean, error?: string, activities?: Array<{id, name?, startDate?}>}} result
   */
  recordHarvest({ ok, error = null, activities = [] } = {}) {
    this.#record('harvest', ok, error);
    const now = this.#now().getTime();
    for (const a of activities) {
      const id = String(a?.id ?? '');
      const started = Date.parse(a?.startDate ?? '');
      if (!id || !Number.isFinite(started) || now - started > WEBHOOK_LOOKBACK_MS) continue;
      if (!this.#state.webhook.seen[id]) {
        this.#state.webhook.seen[id] = { name: a.name || null, firstSeenAt: new Date(now).toISOString() };
      }
    }
    this.#persist();
  }

  /**
   * @param {{ok: boolean, error?: string, flagged?: string[], unresolved?: Object[]}} result
   */
  recordSweep({ ok, error = null, flagged = [], unresolved = [] } = {}) {
    this.#record('sweep', ok, error);
    if (ok || flagged.length) {
      const at = this.#now().toISOString();
      const next = {};
      for (const id of flagged) next[id] = this.#state.integrity.flagged[id] || at;
      this.#state.integrity.flagged = next;
      this.#state.sweep.unresolved = unresolved;
    }
    this.#persist();
  }

  /** Count a webhook event type that no handler took ("activity/delete"). */
  recordDropped(kind) {
    const key = String(kind || 'unknown');
    this.#state.dropped[key] = (this.#state.dropped[key] || 0) + 1;
    this.#persist();
  }

  #missingWebhooks(nowMs) {
    const missing = [];
    for (const [id, entry] of Object.entries(this.#state.webhook.seen)) {
      const age = nowMs - Date.parse(entry.firstSeenAt);
      if (this.#hasWebhookJob(id) || age > WEBHOOK_FORGET_MS) {
        delete this.#state.webhook.seen[id];
        continue;
      }
      if (age >= WEBHOOK_GRACE_MS) missing.push({ activityId: id, name: entry.name });
    }
    return missing;
  }

  /** Current verdict per stage, without side effects beyond pruning. */
  status() {
    const nowMs = this.#now().getTime();
    const base = (rec) => Date.parse(rec.lastSuccessAt || this.#state.startedAt);
    const { harvest, sweep } = this.#state;
    const missing = this.#missingWebhooks(nowMs);
    const stuck = Object.entries(this.#state.integrity.flagged)
      .filter(([, since]) => nowMs - Date.parse(since) >= INTEGRITY_STALE_MS)
      .map(([sessionId]) => sessionId);
    return {
      harvest: { stale: nowMs - base(harvest) > HARVEST_STALE_MS, ...harvest },
      sweep: {
        stale: sweep.consecutiveFailures >= SWEEP_MAX_FAILURES || nowMs - base(sweep) > SWEEP_STALE_MS,
        ...sweep,
      },
      webhook: { stale: missing.length > 0, missing },
      integrity: { stale: stuck.length > 0, stuck, flagged: Object.keys(this.#state.integrity.flagged) },
    };
  }

  /** Evaluate every stage; push once per healthy↔stale transition. */
  async evaluate() {
    const status = this.status();
    const now = this.#now().toISOString();
    for (const stage of STAGES) {
      const current = status[stage].stale ? 'stale' : 'healthy';
      const previous = this.#state.alerts[stage] || 'healthy';
      if (current === previous) continue;
      this.#state.alerts[stage] = current;
      const push = composeStravaSyncPush({
        stage,
        status: current === 'stale' ? 'stale' : 'recovered',
        lastSuccessAt: this.#state[stage]?.lastSuccessAt ?? null,
        error: this.#state[stage]?.lastError ?? null,
        activityNames: status.webhook.missing.map(m => m.name),
        count: stage === 'integrity' ? status.integrity.stuck.length : status.webhook.missing.length,
        now,
        timezone: this.#timezone,
      });
      this.#logger[current === 'stale' ? 'warn' : 'info']?.('strava.sync_health.transition', { stage, from: previous, to: current });
      try {
        await this.#sendPush(push);
      } catch (err) {
        this.#logger.warn?.('strava.sync_health.push_failed', { stage, error: err?.message });
      }
    }
    this.#persist();
    return status;
  }

  /** For GET /api/v1/fitness/strava/health. */
  report() {
    return { startedAt: this.#state.startedAt, stages: this.status(), dropped: { ...this.#state.dropped }, alerts: { ...this.#state.alerts } };
  }
}

export default StravaSyncHealth;
