/**
 * CeremonyScheduler - checks a user's plan for due ceremonies and sends
 * notification intents. Invoked from an HOURLY scheduled task registered at
 * the composition root (see 'lifeplan:ceremony-check' in app.mjs); each
 * ceremony is gated to its household-local delivery hour, so it is stateless —
 * a missed hour (server down) simply skips that day's nudge.
 */

import { CEREMONY_TIMING, CEREMONY_CADENCE_MAP, DEFAULT_ENABLED } from '#domains/lifeplan/services/CeremonyDueResolver.mjs';

// Ceremonies with a completed UI flow default to enabled; the rest require an
// explicit plan.ceremonies[type].enabled = true. (DEFAULT_ENABLED is the
// shared SSOT, imported above from CeremonyDueResolver.)

// Household-local hour (0-23) each ceremony's nudge is delivered at, unless
// overridden by plan.ceremonies[type].at ('HH:00'). The hourly scheduled task
// only matches each ceremony's hour once per day, so day-level "due" ceremonies
// are nudged exactly once (audit A-2.2).
// DST caveat: on spring-forward days a local hour may not exist (at: '02:00'
// skips that day); on fall-back days an hour repeats (at: '01:00' could
// double-send). The defaults 7/17/20 are unaffected.
const DEFAULT_DELIVERY_HOUR = {
  unit_intention: 7,
  unit_capture: 20,
  cycle_retro: 17,
  phase_review: 17,
  season_alignment: 17,
  era_vision: 17,
};

const DEFAULT_TZ = 'UTC';

// Notification titles for ceremony nudges. Intentionally distinct from
// CeremonyDueResolver.CEREMONY_TITLES (the terse dashboard-card labels): a
// push/Telegram title reads better slightly more descriptive ("Monthly
// review", "Weekly retrospective") than the compact card label ("Phase
// review", "Weekly retro"). Two surfaces, two appropriate copies — not a
// stale duplicate. The dueness LOGIC is the shared SSOT (via the resolver's
// CEREMONY_TIMING/CADENCE_MAP/DEFAULT_ENABLED), not the presentational titles.
const TITLES = {
  unit_intention: 'Set your intentions',
  unit_capture: 'Capture your day',
  cycle_retro: 'Weekly retrospective',
  phase_review: 'Monthly review',
  season_alignment: 'Season alignment',
  era_vision: 'Era vision',
};

export class CeremonyScheduler {
  #notificationService;
  #lifePlanStore;
  #ceremonyRecordStore;
  #cadenceService;
  #clock;
  #logger;
  #hourFormatter;

  constructor({ notificationService, lifePlanStore, ceremonyRecordStore, cadenceService, timezone, clock, logger }) {
    this.#notificationService = notificationService;
    this.#lifePlanStore = lifePlanStore;
    this.#ceremonyRecordStore = ceremonyRecordStore;
    this.#cadenceService = cadenceService;
    this.#clock = clock;
    this.#logger = logger;
    // Fail-fast probe: an unrecognized timezone falls back to UTC here rather
    // than throwing on first use (same guard as CadenceService). Cached — one
    // formatter per scheduler, not per check.
    try {
      this.#hourFormatter = this.#buildHourFormatter(timezone || DEFAULT_TZ);
    } catch {
      this.#hourFormatter = this.#buildHourFormatter(DEFAULT_TZ);
    }
  }

  #buildHourFormatter(timeZone) {
    return new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' });
  }

  #localHour(date) {
    return Number(this.#hourFormatter.format(date));
  }

  /**
   * Check all ceremony types for one user; send a notification intent for each
   * that is due, enabled, and not yet completed this period.
   * @param {string} username
   * @returns {Promise<Array<{type: string, periodId: string, delivered: boolean}>>}
   */
  async checkAndNotify(username) {
    const plan = this.#lifePlanStore.load(username);
    if (!plan) return [];

    const cadenceConfig = plan.cadence || {};
    const now = this.#clock?.now?.() || new Date();
    const cadencePosition = this.#cadenceService.resolve(cadenceConfig, now);
    const localHourNow = this.#localHour(now);
    const sent = [];

    for (const [type, timing] of Object.entries(CEREMONY_TIMING)) {
      const config = plan.ceremonies?.[type];
      const enabled = config?.enabled ?? DEFAULT_ENABLED.includes(type);
      if (!enabled) continue;

      // Hour gate: only nudge at the ceremony's household-local delivery hour
      // ('09:00' parseInt → 9; missing, unparseable, or out-of-range `at`
      // (e.g. '25:00') → per-type default, so a bad override can never make a
      // ceremony permanently undeliverable).
      const atHour = Number.parseInt(config?.at, 10);
      const deliveryHour = Number.isFinite(atHour) && atHour >= 0 && atHour <= 23
        ? atHour
        : DEFAULT_DELIVERY_HOUR[type] ?? 7;
      if (localHourNow !== deliveryHour) continue;

      const periodId = cadencePosition?.[CEREMONY_CADENCE_MAP[type]]?.periodId;
      if (!periodId) continue;

      if (this.#ceremonyRecordStore.hasRecord(username, type, periodId)) continue;

      const latest = this.#ceremonyRecordStore.getLatestRecord?.(username, type);
      const lastDate = latest?.completedAt || latest?.completed_at || null;
      if (!this.#cadenceService.isCeremonyDue(timing, cadenceConfig, now, lastDate)) continue;

      const label = type.replace(/_/g, ' ');
      const results = await this.#notificationService.send({
        title: TITLES[type] || `Time for ${label}`,
        body: `Your ${label} ceremony is due.`,
        category: 'ceremony',
        urgency: 'normal',
        actions: [{ label: 'Begin', action: 'open', data: { url: `/life/ceremony/${type}` } }],
        metadata: { username, ceremony: type, periodId },
        dedupeKey: `ceremony:${type}:${periodId}`,
      });

      const delivered = Array.isArray(results) && results.some(r => r.delivered);
      sent.push({ type, periodId, delivered });
      this.#logger?.info?.('lifeplan.ceremony.notified', { username, type, periodId, delivered });
    }

    return sent;
  }
}
