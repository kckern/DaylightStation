/**
 * DoNow dispatch policy — pure domain logic.
 * Implements occupancy-aware dispatching with parental override support.
 * No I/O, no clock, no external dependencies.
 */

export const DECISIONS = Object.freeze(['dispatch', 'pending_approval', 'denied']);

/**
 * Decide whether to dispatch immediately, pend for approval, or deny.
 * Implements spec §3 decision table with force override.
 *
 * @param {Object} param
 * @param {Object} param.occupancy - Surface occupancy { state: 'idle'|'active'|'unknown', occupantId: string|null }
 * @param {string} param.learnerId - Who this dispatch is FOR (may be null)
 * @param {string|undefined} param.force - undefined or 'never_ask' (deny instead of pending)
 * @returns {'dispatch'|'pending_approval'|'denied'}
 */
export function decideDispatch({ occupancy, learnerId, force }) {
  if (occupancy.state === 'idle') {
    return 'dispatch';
  }

  if (occupancy.state === 'active') {
    if (learnerId != null && occupancy.occupantId === learnerId) {
      return 'dispatch';
    }
    // Different occupant or null (including null learner + null occupant)
    return force === 'never_ask' ? 'denied' : 'pending_approval';
  }

  // unknown state — fail closed
  return force === 'never_ask' ? 'denied' : 'pending_approval';
}

/**
 * Re-check occupancy at approval time.
 * Implements spec §4 decision table: occupancy may change between initial request
 * and parental approval, so we re-check against the PENDING RECORD's occupant.
 *
 * @param {Object} param
 * @param {Object} param.occupancy - Current surface occupancy { state: 'idle'|'active'|'unknown', occupantId: string|null }
 * @param {string} param.learnerId - Who the unit is FOR
 * @param {string|null} param.pendingOccupant - Who was using the surface when the parent was asked (from pending record)
 * @param {boolean} param.repended - Whether this request has already re-pended once
 * @returns {'dispatch'|'repend'|'denied'}
 */
export function decideOnApprove({ occupancy, learnerId, pendingOccupant, repended }) {
  if (occupancy.state === 'idle') {
    return 'dispatch';
  }

  if (occupancy.state === 'active') {
    // Same learner (the one the unit is FOR) → always safe
    if (learnerId != null && occupancy.occupantId === learnerId) {
      return 'dispatch';
    }
    // Same occupant as when the parent was asked → dispatch (approved for this exact person)
    if (pendingOccupant != null && occupancy.occupantId === pendingOccupant) {
      return 'dispatch';
    }
    // Different occupant → re-pend once (name the new occupant to the parent)
    return repended ? 'denied' : 'repend';
  }

  // unknown state — re-pend once, then deny
  return repended ? 'denied' : 'repend';
}
