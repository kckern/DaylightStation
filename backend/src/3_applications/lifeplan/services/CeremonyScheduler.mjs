/**
 * CeremonyScheduler - checks a user's plan for due ceremonies and sends
 * notification intents. Invoked from an HOURLY scheduled task registered at
 * the composition root (see 'lifeplan:ceremony-check' in app.mjs); each
 * ceremony is gated to its household-local delivery hour, so it is stateless —
 * a missed hour (server down) simply skips that day's nudge.
 */

const CEREMONY_TIMING = {
  unit_intention: 'start_of_unit',
  unit_capture: 'end_of_unit',
  cycle_retro: 'end_of_cycle',
  phase_review: 'end_of_phase',
  season_alignment: 'end_of_season',
  era_vision: 'end_of_era',
};

const CEREMONY_CADENCE_MAP = {
  unit_intention: 'unit',
  unit_capture: 'unit',
  cycle_retro: 'cycle',
  phase_review: 'phase',
  season_alignment: 'season',
  era_vision: 'era',
};

// Ceremonies with a completed UI flow default to enabled; the rest require an
// explicit plan.ceremonies[type].enabled = true.
const DEFAULT_ENABLED = ['unit_intention', 'unit_capture', 'cycle_retro', 'phase_review'];

// Household-local hour (0-23) each ceremony's nudge is delivered at, unless
// overridden by plan.ceremonies[type].at ('HH:00'). The hourly scheduled task
// only matches each ceremony's hour once per day, so day-level "due" ceremonies
// are nudged exactly once (audit A-2.2).
const DEFAULT_DELIVERY_HOUR = {
  unit_intention: 7,
  unit_capture: 20,
  cycle_retro: 17,
  phase_review: 17,
  season_alignment: 17,
  era_vision: 17,
};

const DEFAULT_TZ = 'UTC';

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
    const sent = [];

    for (const [type, timing] of Object.entries(CEREMONY_TIMING)) {
      const config = plan.ceremonies?.[type];
      const enabled = config?.enabled ?? DEFAULT_ENABLED.includes(type);
      if (!enabled) continue;

      // Hour gate: only nudge at the ceremony's household-local delivery hour
      // ('09:00' parseInt → 9; missing/invalid `at` → per-type default).
      const atHour = Number.parseInt(config?.at, 10);
      const deliveryHour = Number.isFinite(atHour) ? atHour : DEFAULT_DELIVERY_HOUR[type] ?? 7;
      if (this.#localHour(now) !== deliveryHour) continue;

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
      });

      const delivered = Array.isArray(results) && results.some(r => r.delivered);
      sent.push({ type, periodId, delivered });
      this.#logger?.info?.('lifeplan.ceremony.notified', { username, type, periodId, delivered });
    }

    return sent;
  }
}
