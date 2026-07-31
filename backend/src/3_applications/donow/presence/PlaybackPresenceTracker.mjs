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
 * IMPORTANT: `playback.log` is a GLOBAL topic — every Player surface in the
 * house (living room, the piano kiosk's video lessons, the garage fitness
 * player) POSTs to the same `/api/v1/play/log` route and lands on this one
 * topic. Per the discovery in the Task 7 fix-up report, the broadcast
 * payload (`{ contentId, type, assetId, percent, playhead, storagePath,
 * timestamp }`) carries NO device/screen/surface identifier today — there
 * is nothing in it composition could match a specific surface against.
 * Callers therefore MUST supply a `match` predicate scoped to their own
 * surface (see the constructor doc); the default `() => true` exists only
 * for tests/back-compat and, left at default in composition, WOULD make the
 * living room look busy whenever the piano or fitness player is merely
 * playing a video elsewhere (the spec's named failure: fails toward
 * nagging).
 *
 * Freshness: a MATCHING event within `freshMs` (default 2 min) → playing
 * recently. Silence (or only non-matching events) beyond freshMs → not
 * playing recently.
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
  #match;
  #lastSeenAt = null;
  #unsubscribe;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.eventBus - `{ subscribe(topic, handler): unsubscribe }`.
   * @param {Function} [config.clock] - `() => Date`, overridable for tests.
   * @param {number} [config.freshMs=120000] - Freshness window (spec §5.1: 2 minutes).
   * @param {Function} [config.match] - `(payload) => boolean`; only matching
   *   payloads refresh recency. Defaults to `() => true` (accept everything)
   *   because `playback.log` today carries no field a caller could match a
   *   specific surface against (see class doc) — composition should pass a
   *   real predicate once/if the publisher gains a discriminating field.
   * @param {Object} [config.logger]
   */
  constructor({
    eventBus, clock = () => new Date(), freshMs = 2 * 60_000, match = () => true, logger,
  } = {}) {
    if (!eventBus || typeof eventBus.subscribe !== 'function') {
      throw new Error('PlaybackPresenceTracker requires eventBus');
    }
    this.#clock = clock;
    this.#freshMs = freshMs;
    this.#match = typeof match === 'function' ? match : () => true;
    this.#logger = logger || null;
    this.#unsubscribe = eventBus.subscribe('playback.log', (payload) => this.#onPlaybackLog(payload));
  }

  #onPlaybackLog(payload) {
    if (!this.#match(payload)) return;
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
