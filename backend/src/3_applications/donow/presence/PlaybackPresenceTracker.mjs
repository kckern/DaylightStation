/**
 * PlaybackPresenceTracker — the "is something actually playing" half of
 * living-room-tv soft occupancy (spec §5.1 "livingroom-tv").
 *
 * Source: the `playback.log` eventBus topic — the SAME topic
 * `WakeAndLoadService#armPlaybackWatchdog` subscribes to (verified by grep:
 * `backend/src/3_applications/devices/services/WakeAndLoadService.mjs`),
 * broadcast by `backend/src/4_api/v1/routers/play.mjs` on every progress
 * report from a playing Player surface. Since that endpoint only reports
 * progress while media is actively playing (not paused/menu), any event
 * arriving on the topic IS the "playing" signal — there's no separate
 * field to branch on.
 *
 * Freshness: an event within `freshMs` (default 2 min) → playing recently.
 * Silence beyond freshMs → not playing recently.
 *
 * This tracker deliberately does NOT expose `occupancy()`. Per spec §5.1,
 * living-room-tv occupancy is a three-step rule (TV power off → idle; power
 * on + recent playback.log → active; power on + no recent frames → idle)
 * that also needs the HA TV-power sensor. Composing those two signals is
 * the living-room surface adapter's job (Task 8) — this class only ever
 * answers the playback half via `playingRecently()`.
 */
export class PlaybackPresenceTracker {
  #clock;
  #freshMs;
  #lastSeenAt = null;
  #unsubscribe;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.eventBus - `{ subscribe(topic, handler): unsubscribe }`.
   * @param {Function} [config.clock] - `() => Date`, overridable for tests.
   * @param {number} [config.freshMs=120000] - Freshness window (spec §5.1: 2 minutes).
   * @param {Object} [config.logger]
   */
  constructor({ eventBus, clock = () => new Date(), freshMs = 2 * 60_000, logger } = {}) {
    if (!eventBus || typeof eventBus.subscribe !== 'function') {
      throw new Error('PlaybackPresenceTracker requires eventBus');
    }
    this.#clock = clock;
    this.#freshMs = freshMs;
    this.#logger = logger || null;
    this.#unsubscribe = eventBus.subscribe('playback.log', (payload) => this.#onPlaybackLog(payload));
  }

  #onPlaybackLog(payload) {
    this.#lastSeenAt = this.#nowMs();
    this.#logger?.debug?.('donow.presence.playback.observed', { contentId: payload?.contentId });
  }

  /** @returns {boolean} Whether a playback.log frame arrived within freshMs. */
  playingRecently() {
    if (this.#lastSeenAt == null) return false;
    return this.#nowMs() - this.#lastSeenAt <= this.#freshMs;
  }

  /** Unsubscribe from the eventBus. Safe to call more than once. */
  stop() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  #nowMs() {
    const now = this.#clock();
    return now instanceof Date ? now.getTime() : Number(now);
  }
}

export default PlaybackPresenceTracker;
