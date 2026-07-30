/**
 * The interface every household "do this now" surface plugs into so
 * `DoNowService` can dispatch a learner somewhere — a TV, the garage fitness
 * kiosk, the piano, a printer — without knowing anything about how any
 * individual surface actually works (spec §3).
 *
 * A surface answers four questions: is a given dispatch payload well-formed
 * (`validateAction`, called both at curriculum catalog-load time and again at
 * dispatch time), is anyone using it right now (`occupancy`, best-effort and
 * fail-closed — `unknown` is always a legal answer and the policy engine
 * treats it as possibly-occupied, never clobbered), how do we actually send
 * someone there (`dispatch`), and what do we call it in a sentence a human
 * reads (`label` — approval notifications and agenda/slip wording).
 *
 * `occupancy` and `dispatch` are read speculatively and destructively
 * respectively by `DoNowService`: `occupancy` may be probed any time the
 * service considers a request (including ones that end up denied), while
 * `dispatch` is only ever called once the policy engine has already decided
 * `dispatch` — approval/occupancy are the caller's concern, not this
 * method's.
 *
 * @interface IDoNowSurface
 */
export class IDoNowSurface {
  /** Stable id from the closed v1 surface registry, e.g. 'garage-fitness'. */
  get id() {
    throw new Error('IDoNowSurface.id must be implemented');
  }

  /**
   * Validate a dispatch payload — used both at curriculum catalog load
   * (`launch:` blocks) and at dispatch call time. Must not throw.
   *
   * @param {*} raw - The surface-specific action payload.
   * @returns {string[]} Empty when valid; one message per problem otherwise.
   */
  // eslint-disable-next-line no-unused-vars
  validateAction(raw) {
    throw new Error('IDoNowSurface.validateAction must be implemented');
  }

  /**
   * Best-effort occupancy read. `unknown` is always a legal answer — an
   * adapter that cannot tell whether the surface is in use should return
   * `unknown` rather than guessing `idle`; the policy engine fails closed on
   * `unknown` (never clobbers a possibly-busy surface).
   *
   * `DoNowService` calls this as `adapter.occupancy({ action })`, passing the
   * SAME action that is (or would be) dispatched — a multi-target surface
   * (e.g. `playback-hub`'s color/group targets) can scope its busy-check to
   * just the action's target instead of treating the whole surface as one
   * unit. `action` may be `undefined` (a probe with nothing to scope to
   * yet); adapters that have no notion of sub-targets are free to ignore it
   * entirely — this is an additive, opt-in parameter, not a required one.
   *
   * @param {{action?: *}} [args]
   * @returns {Promise<{state: 'idle'|'active'|'unknown', occupantId: string|null}>}
   */
  // eslint-disable-next-line no-unused-vars
  occupancy(args) {
    throw new Error('IDoNowSurface.occupancy must be implemented');
  }

  /**
   * Hand the learner off to this surface. Only called once the policy engine
   * has already decided `dispatch`.
   *
   * @param {{action: *, learnerId: string|null, requestedBy?: string}} args
   * @returns {Promise<{dispatched: boolean, detail?: *}>}
   */
  // eslint-disable-next-line no-unused-vars
  dispatch({ action, learnerId, requestedBy }) {
    throw new Error('IDoNowSurface.dispatch must be implemented');
  }

  /**
   * A human sentence naming this surface for a given action — used in
   * approval notifications and agenda/slip wording, e.g. "Dance video in the
   * garage".
   *
   * @param {*} action
   * @returns {string}
   */
  // eslint-disable-next-line no-unused-vars
  label(action) {
    throw new Error('IDoNowSurface.label must be implemented');
  }
}

export function isDoNowSurface(obj) {
  return Boolean(obj)
    && typeof obj.id === 'string'
    && typeof obj.validateAction === 'function'
    && typeof obj.occupancy === 'function'
    && typeof obj.dispatch === 'function'
    && typeof obj.label === 'function';
}

export default IDoNowSurface;
