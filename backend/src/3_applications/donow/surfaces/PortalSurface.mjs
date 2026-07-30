/**
 * PortalSurface — the DoNow adapter for the school Portal tablet (spec §5,
 * surface id `portal`).
 *
 * Dispatch is a thin generalization of the existing `PortalDispatch`
 * mechanism (`backend/src/3_applications/school/PortalDispatch.mjs`): the
 * SAME `school` WS topic, the SAME `school.launch` envelope shape
 * (`{ type: 'school.launch', learnerId, target }`). PortalDispatch itself
 * becomes a consumer of this surface rather than a parallel path — this
 * class does not replace it, it is the generalized entry point the spec
 * calls for.
 *
 * Occupancy (spec §5.1 "portal"): the backend's own truth about who is
 * mid-quiz — `SchoolService`'s in-memory session map, read through the
 * read-only `activeSittings()` projection (`{userId, lastActiveAt}[]`, never
 * the session objects themselves). Newest `lastActiveAt` within `freshMs`
 * (spec: 10 minutes) → `active` with THAT user as occupant; otherwise
 * `idle`. Silence past the window is idle, not unknown — the session store
 * is authoritative for on-screen work, not a heartbeat that can go dark.
 */
export class PortalSurface {
  #eventBus;
  #schoolActivity;
  #freshMs;
  #now;
  #logger;

  /**
   * @param {Object} config
   * @param {{broadcast: Function}} [config.eventBus] - optional; absent means no target is listening
   * @param {{activeSittings: Function}} [config.schoolActivity] - SchoolService-shaped; optional
   * @param {number} [config.freshMs=600000] - Freshness window (spec §5.1: 10 minutes)
   * @param {Function} [config.now] - `() => number` epoch ms, overridable for tests
   * @param {Object} [config.logger]
   */
  constructor({
    eventBus = null, schoolActivity = null, freshMs = 10 * 60_000, now = () => Date.now(), logger = console,
  } = {}) {
    this.#eventBus = eventBus;
    this.#schoolActivity = schoolActivity;
    this.#freshMs = freshMs;
    this.#now = now;
    this.#logger = logger;
  }

  get id() { return 'portal'; }

  /**
   * @param {{target: {kind: 'bank', bankId: string, unitId: string, sessionId: string}
   *               | {kind: 'program', program: string}}} raw
   * @returns {string[]}
   */
  validateAction(raw) {
    if (!raw || typeof raw !== 'object') return ['action must be an object'];
    const { target } = raw;
    if (!target || typeof target !== 'object') return ['action.target is required'];
    if (target.kind === 'bank') {
      const errors = [];
      if (!target.bankId) errors.push('target.bankId is required for kind=bank');
      if (!target.unitId) errors.push('target.unitId is required for kind=bank');
      if (!target.sessionId) errors.push('target.sessionId is required for kind=bank');
      return errors;
    }
    if (target.kind === 'program') {
      return target.program ? [] : ['target.program is required for kind=program'];
    }
    return [`target.kind must be bank|program, got: ${target.kind}`];
  }

  /** @returns {Promise<{state: 'idle'|'active'|'unknown', occupantId: string|null}>} */
  async occupancy() {
    if (!this.#schoolActivity) return { state: 'unknown', occupantId: null };
    let sittings;
    try {
      sittings = await this.#schoolActivity.activeSittings();
    } catch (err) {
      this.#logger.warn?.('donow.portal.occupancy-failed', { error: err?.message || String(err) });
      return { state: 'unknown', occupantId: null };
    }
    if (!Array.isArray(sittings) || sittings.length === 0) {
      return { state: 'idle', occupantId: null };
    }
    // Newest sitting only — that is the one whose freshness decides the answer.
    const newest = sittings.reduce((a, b) => (Number(b.lastActiveAt) > Number(a.lastActiveAt) ? b : a));
    const fresh = this.#now() - Number(newest.lastActiveAt) <= this.#freshMs;
    return fresh
      ? { state: 'active', occupantId: newest.userId ?? null }
      : { state: 'idle', occupantId: null };
  }

  /** @returns {Promise<{dispatched: boolean}>} */
  async dispatch({ action, learnerId }) {
    if (!this.#eventBus) {
      this.#logger.warn?.('donow.portal.no-bus', { learnerId, target: action?.target });
      return { dispatched: false };
    }
    try {
      this.#eventBus.broadcast('school', { type: 'school.launch', learnerId, target: action.target });
    } catch (err) {
      this.#logger.warn?.('donow.portal.dispatch-failed', { learnerId, error: err?.message || String(err) });
      return { dispatched: false };
    }
    return { dispatched: true };
  }

  /** @param {*} action */
  label(action) {
    const target = action?.target;
    if (target?.kind === 'program') return `${target.program} on the Portal`;
    return 'A quiz on the Portal';
  }
}

export default PortalSurface;
