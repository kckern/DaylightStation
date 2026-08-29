/**
 * FitnessPresenceTracker — soft occupancy for the garage fitness kiosk
 * (spec §5.1 "garage-fitness").
 *
 * Source: the backend's own log-ingest stream of `fitness-profile` events
 * (the same `sessionActive`/`rosterSize` signals the deploy gate greps —
 * `FitnessApp.jsx` emits them every ~30s whenever the app is up).
 *
 * Discovery note (bounded, per Task 7 brief): `backend/src/0_system/logging/
 * ingestion.mjs` does NOT re-broadcast incoming frontend log events on the
 * realtime transport, and does not expose any per-event hook/callback registry of its
 * own (`ingestFrontendLogs` -> `dispatcher.dispatch(normalized)`, which fans
 * out to registered *transports*, not topic subscribers). So this tracker
 * takes the brief's documented fallback: it has NO realtime-transport dependency at
 * all and instead exposes `observe(logEvent)`, fed a normalized log event
 * (the same shape `ingestFrontendLogs` builds: `{ event, data, ... }`).
 * Composition (Task 13) wires a one-line tap into `ingestFrontendLogs` —
 * call `tracker.observe(normalized)` for every ingested event — so this
 * class never needs to know how events reach it.
 *
 * Freshness: `sessionActive:true` within `freshMs` (default 3 min) →
 * active (occupantId null — the roster is a headcount, not an identity).
 * `sessionActive:false` within freshMs → idle. Silence beyond freshMs →
 * **unknown** (fail closed) — a silent always-on kiosk means the surface
 * itself has gone dark, which should involve a grown-up rather than being
 * quietly treated as idle.
 */
export class FitnessPresenceTracker {
  #clock;
  #freshMs;
  #lastActive = null;
  #lastSeenAt = null;
  #logger;

  /**
   * @param {Object} config
   * @param {Function} [config.clock] - `() => Date`, overridable for tests.
   * @param {number} [config.freshMs=180000] - Freshness window (spec §5.1: 3 minutes).
   * @param {Object} [config.logger]
   */
  constructor({ clock = () => new Date(), freshMs = 3 * 60_000, logger } = {}) {
    this.#clock = clock;
    this.#freshMs = freshMs;
    this.#logger = logger || null;
  }

  /**
   * Feed one normalized log event. Ignores anything that isn't a
   * `fitness-profile` event carrying a boolean `sessionActive` — a
   * `deviceCount`-only flap (a stray HR strap advertising) must NOT move
   * presence, only an actual session-active reading does.
   * @param {{event?: string, data?: {sessionActive?: boolean}}} logEvent
   */
  observe(logEvent) {
    if (!logEvent || logEvent.event !== 'fitness-profile') return;
    const sessionActive = logEvent.data?.sessionActive;
    if (typeof sessionActive !== 'boolean') return;
    this.#lastActive = sessionActive;
    this.#lastSeenAt = this.#nowMs();
    this.#logger?.debug?.('donow.presence.fitness.observed', { sessionActive });
  }

  /** @returns {{state: 'active'|'idle'|'unknown', occupantId: null}} */
  occupancy() {
    if (this.#lastSeenAt == null) {
      return { state: 'unknown', occupantId: null };
    }
    const fresh = this.#nowMs() - this.#lastSeenAt <= this.#freshMs;
    if (!fresh) {
      return { state: 'unknown', occupantId: null };
    }
    return { state: this.#lastActive ? 'active' : 'idle', occupantId: null };
  }

  /** No-op — this tracker holds no subscription to release. */
  stop() {}

  #nowMs() {
    const now = this.#clock();
    return now instanceof Date ? now.getTime() : Number(now);
  }
}

export default FitnessPresenceTracker;
