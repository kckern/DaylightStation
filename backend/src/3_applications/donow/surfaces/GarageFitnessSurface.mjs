/**
 * GarageFitnessSurface — the DoNow adapter for the garage fitness kiosk
 * (spec §5, surface id `garage-fitness`).
 *
 * This surface has ZERO remote reachability today (spec §5) — dispatch
 * broadcasts a NEW `fitness.launch` message on the `fitness` eventBus topic,
 * which a frontend `useFitnessLaunch` hook (mirror of the existing
 * `useSchoolLaunch`) is expected to pick up and navigate FitnessApp to
 * `/fitness/play/:episodeId`. That hook is out of scope for this adapter —
 * this class only ever broadcasts.
 *
 * Occupancy delegates entirely to the injected `FitnessPresenceTracker`
 * (`presence.occupancy()`), which already encodes the fresh/idle/unknown
 * rule from spec §5.1 (`sessionActive` within 3 minutes → active/idle;
 * silence beyond that → unknown, fail closed — a dark always-on kiosk
 * should involve a grown-up).
 */
export class GarageFitnessSurface {
  #eventBus;
  #presence;
  #logger;

  /**
   * @param {Object} config
   * @param {{broadcast: Function}} [config.eventBus] - optional; absent means no target is listening
   * @param {{occupancy: Function}} [config.presence] - FitnessPresenceTracker-shaped; optional
   * @param {Object} [config.logger]
   */
  constructor({ eventBus = null, presence = null, logger = console } = {}) {
    this.#eventBus = eventBus;
    this.#presence = presence;
    this.#logger = logger;
  }

  get id() { return 'garage-fitness'; }

  /** @param {{episodeId: string}} raw */
  validateAction(raw) {
    if (!raw || typeof raw !== 'object') return ['action must be an object'];
    if (typeof raw.episodeId !== 'string' || raw.episodeId.length === 0) return ['action.episodeId is required'];
    return [];
  }

  /** @returns {Promise<{state: 'idle'|'active'|'unknown', occupantId: null}>} */
  async occupancy() {
    if (!this.#presence) return { state: 'unknown', occupantId: null };
    try {
      return this.#presence.occupancy();
    } catch (err) {
      this.#logger.warn?.('donow.garage-fitness.occupancy-failed', { error: err?.message || String(err) });
      return { state: 'unknown', occupantId: null };
    }
  }

  /** @returns {Promise<{dispatched: boolean}>} */
  async dispatch({ action, learnerId }) {
    if (!this.#eventBus) {
      this.#logger.warn?.('donow.garage-fitness.no-bus', { learnerId, episodeId: action?.episodeId });
      return { dispatched: false };
    }
    try {
      this.#eventBus.broadcast('fitness', { type: 'fitness.launch', learnerId, episodeId: action.episodeId });
    } catch (err) {
      this.#logger.warn?.('donow.garage-fitness.dispatch-failed', { error: err?.message || String(err) });
      return { dispatched: false };
    }
    return { dispatched: true };
  }

  // Article-free, lowercase noun phrase: `DoNowService`'s own templates
  // ("The {label} is busy...") own the leading article — a label that
  // supplied its own ("The garage fitness kiosk") produced "The The garage
  // fitness kiosk is busy right now." on a child's slip (spec review finding).
  label() { return 'garage fitness kiosk'; }
}

export default GarageFitnessSurface;
