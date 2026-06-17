/**
 * Pure governance-bypass decision used by FitnessPlayer.
 *
 * FitnessPlayer derives `effectiveGovernanceState` from the GovernanceEngine
 * snapshot (the SSoT for lock decisions). Governance is bypassed — the
 * engine's lock is ignored and playback proceeds — when ANY of the following
 * hold:
 *
 *  - `nogovernProp`  : the session-sticky `?nogovern` URL param (component prop).
 *                      Disables governance for the whole player session.
 *  - `bypassActive`  : a runtime grant set when an in-player fingerprint unlock
 *                      matches `governance_bypass`. Cleared when the next item
 *                      starts (see FitnessPlayer), so it only releases the
 *                      currently-playing lock.
 *  - `itemNogovern`  : the currently-playing queue item was tagged
 *                      `nogovern: true` by FitnessShow after a granted
 *                      `governance_bypass` unlock (completes the T4.2 seam).
 *
 * Extracted as a pure function so the decision can be unit-tested without
 * rendering the (heavy) FitnessPlayer component.
 *
 * @param {{ nogovernProp?: boolean, bypassActive?: boolean, itemNogovern?: boolean }} flags
 * @returns {boolean} true when governance should be bypassed for the current item.
 */
export function shouldBypassGovernance({ nogovernProp = false, bypassActive = false, itemNogovern = false } = {}) {
  return Boolean(nogovernProp || bypassActive || itemNogovern);
}

export default shouldBypassGovernance;
