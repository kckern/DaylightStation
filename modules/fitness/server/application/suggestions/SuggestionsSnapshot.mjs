// backend/src/3_applications/fitness/suggestions/SuggestionsSnapshot.mjs

/**
 * SuggestionsSnapshot — the suggestions grid computed once and served as-is.
 *
 * Building the grid walks recent shows and the library through Plex, which
 * answers one request at a time: ~100 calls, 2-5s on a quiet Plex and 20s+ on
 * a busy one (measured 2026-10-01). The home screen asked for it every five
 * minutes, and nothing it depends on changes that often. What changes the grid
 * is a workout (a resume point moves, a next episode comes up) and the day
 * turning (discovery picks are per day). So the grid is built:
 *
 *   - at boot (preload), so the first visitor does not pay for it;
 *   - at local midnight;
 *   - once a workout settles: every session save marks it stale and pushes a
 *     single rebuild back by `settleMs`, so a workout saving every few seconds
 *     causes one rebuild after its last save, not one per save.
 *
 * A request for a stale grid waits for the rebuild rather than serving the old
 * one — after a workout the old Resume / Next Up cards are exactly wrong.
 *
 * Same `getSuggestions` interface as FitnessSuggestionService, so the router
 * does not know it is talking to a snapshot.
 */
export class SuggestionsSnapshot {
  #service;
  #now;
  #setTimer;
  #clearTimer;
  #settleMs;
  #logger;
  #entries = new Map(); // key -> { params, result, builtAt, day, stale, building }
  #settleTimer = null;
  #midnightTimer = null;

  /**
   * @param {Object} deps
   * @param {{ getSuggestions: Function, resolveSlots: Function }} deps.service
   * @param {Function} deps.setTimer - (fn, ms) => handle; composition passes setTimeout
   * @param {Function} deps.clearTimer
   * @param {Function} [deps.now] - () => Date
   * @param {number} [deps.settleMs] - quiet period after the last session save
   */
  constructor({ service, setTimer, clearTimer, now = () => new Date(), settleMs = 2 * 60_000, logger = console }) {
    this.#service = service;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
    this.#now = now;
    this.#settleMs = settleMs;
    this.#logger = logger;
  }

  async getSuggestions(params = {}) {
    const key = this.#keyOf(params);
    const entry = this.#entries.get(key);
    if (entry?.result && !entry.stale && entry.day === this.#today()) {
      return entry.result;
    }
    return this.#build(key, params, entry ? (entry.stale ? 'stale' : 'day-rollover') : 'first-request');
  }

  /** Build the default grid in the background (boot) and arm the midnight rebuild. */
  preload(params = {}) {
    this.#armMidnight();
    this.#build(this.#keyOf(params), params, 'preload').catch(() => {});
  }

  /**
   * Something the grid depends on changed. Marks every grid stale and
   * schedules one rebuild after `settleMs` of quiet.
   */
  invalidate(reason) {
    for (const entry of this.#entries.values()) entry.stale = true;
    if (this.#settleTimer) this.#clearTimer(this.#settleTimer);
    this.#settleTimer = this.#setTimer(() => {
      this.#settleTimer = null;
      this.#rebuildAll(reason);
    }, this.#settleMs);
    this.#settleTimer?.unref?.();
    this.#logger.debug?.('fitness.suggestions.snapshot.invalidated', { reason, entries: this.#entries.size });
  }

  #rebuildAll(reason) {
    for (const [key, entry] of this.#entries) {
      if (entry.stale || entry.day !== this.#today()) {
        this.#build(key, entry.params, reason).catch(() => {});
      }
    }
  }

  #build(key, params, reason) {
    const existing = this.#entries.get(key);
    if (existing?.building) return existing.building;

    const entry = existing || { params, result: null, builtAt: null, day: null, stale: true, building: null };
    this.#entries.set(key, entry);
    // A save landing mid-build re-marks the entry stale; only a build that
    // STARTED after the last invalidation may clear it.
    entry.stale = false;
    const startedAt = Date.now();
    const day = this.#today();
    entry.building = this.#service.getSuggestions(params).then(
      (result) => {
        entry.building = null;
        entry.result = result;
        entry.builtAt = this.#now().toISOString();
        entry.day = day;
        this.#logger.info?.('fitness.suggestions.snapshot.built', {
          reason, key, ms: Date.now() - startedAt,
          cards: Array.isArray(result?.suggestions) ? result.suggestions.length : null,
        });
        return result;
      },
      (err) => {
        entry.building = null;
        entry.stale = true;
        this.#logger.warn?.('fitness.suggestions.snapshot.build-failed', { reason, key, error: err?.message });
        // Better a grid from before the failure than an error on the home screen.
        if (entry.result) return entry.result;
        throw err;
      },
    );
    return entry.building;
  }

  #armMidnight() {
    if (this.#midnightTimer) this.#clearTimer(this.#midnightTimer);
    const now = this.#now();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 1, 0);
    this.#midnightTimer = this.#setTimer(() => {
      this.#midnightTimer = null;
      this.#rebuildAll('day-rollover');
      this.#armMidnight();
    }, next.getTime() - now.getTime());
    this.#midnightTimer?.unref?.();
  }

  #keyOf({ gridSize, householdId } = {}) {
    return `${householdId ?? ''}:${this.#service.resolveSlots(gridSize, householdId)}`;
  }

  #today() {
    const d = this.#now();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}
