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

/**
 * The governance state everyone downstream of a bypass must read.
 *
 * A bypass is decided by FitnessPlayer (it owns the three inputs above) but is
 * APPLIED in one place: FitnessContext, which publishes the result as its
 * `governanceState`. The engine itself is never told, so its own snapshot keeps
 * saying `videoLocked: true`; any consumer that reads the engine snapshot
 * instead of this one re-imposes the lock the adult just released.
 *
 * 2026-11-20: a child's Danny Go was unlocked with a `governance_bypass`
 * fingerprint. FitnessPlayer applied the bypass to its own copy of the state,
 * but the unattended playback-budget meter (FitnessContext) still read the raw
 * engine snapshot, saw `videoLocked: true` (canPlay false, status `held`), and
 * paused the video within 3 ms of every play press — 14 presses, no cover, no
 * way forward.
 *
 * Lock-driven side channels (audioDuck / challenge / deadline) are nulled too,
 * so nothing keeps acting on a released lock. With no bypass the input object is
 * returned unchanged (same identity).
 *
 * @param {object|null|undefined} state  GovernanceEngine snapshot
 * @param {boolean} bypassed
 * @returns {object|null|undefined}
 */
export function applyGovernanceBypass(state, bypassed) {
  if (!bypassed) return state;
  return {
    ...(state || {}),
    videoLocked: false,
    isGoverned: false,
    status: 'unlocked',
    audioDuck: null,
    challenge: null,
    deadline: null
  };
}

export default shouldBypassGovernance;
