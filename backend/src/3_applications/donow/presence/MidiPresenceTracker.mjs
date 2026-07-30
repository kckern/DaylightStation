/**
 * MidiPresenceTracker — soft occupancy for the piano kiosk (spec §5.1
 * "piano-kiosk").
 *
 * Source: the `midi` eventBus topic the piano bridge broadcasts on
 * (`session_start` / `note_on` / `session_end`). ANY payload on that topic
 * — regardless of which of those event names it carries — refreshes
 * `lastSeen`; the bridge emits continuously while anyone plays, so treating
 * every message as "activity" (rather than parsing out which event it is)
 * is both simpler and matches the rule: a `session_end` still counts as
 * evidence someone was just there, it doesn't force an immediate idle.
 *
 * Freshness: active iff activity arrived within `ttlMs` (default 5 min).
 * Silence beyond the TTL → idle. This is also how a missed `session_end`
 * self-heals — BLE flaps drop the bridge routinely in this house, and a
 * wedged "active" forever is the named failure this TTL exists to prevent.
 *
 * Silence with NO activity ever observed also reads as idle (not unknown):
 * unlike the garage-fitness kiosk, there is no "the surface itself might be
 * dark" ambiguity here — no MIDI ever seen just means nobody has played.
 */
export class MidiPresenceTracker {
  #clock;
  #ttlMs;
  #lastSeenAt = null;
  #unsubscribe;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.eventBus - `{ subscribe(topic, handler): unsubscribe }`.
   * @param {Function} [config.clock] - `() => Date`, overridable for tests.
   * @param {number} [config.ttlMs=300000] - Freshness window (spec §5.1: 5 minutes).
   * @param {Object} [config.logger]
   */
  constructor({ eventBus, clock = () => new Date(), ttlMs = 5 * 60_000, logger } = {}) {
    if (!eventBus || typeof eventBus.subscribe !== 'function') {
      throw new Error('MidiPresenceTracker requires eventBus');
    }
    this.#clock = clock;
    this.#ttlMs = ttlMs;
    this.#logger = logger || null;
    this.#unsubscribe = eventBus.subscribe('midi', (payload) => this.#onMidiEvent(payload));
  }

  #onMidiEvent(payload) {
    this.#lastSeenAt = this.#nowMs();
    this.#logger?.debug?.('donow.presence.midi.activity', { event: payload?.event });
  }

  /** @returns {{state: 'idle'|'active', occupantId: null}} */
  occupancy() {
    if (this.#lastSeenAt == null) {
      return { state: 'idle', occupantId: null };
    }
    const fresh = this.#nowMs() - this.#lastSeenAt <= this.#ttlMs;
    return { state: fresh ? 'active' : 'idle', occupantId: null };
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

export default MidiPresenceTracker;
