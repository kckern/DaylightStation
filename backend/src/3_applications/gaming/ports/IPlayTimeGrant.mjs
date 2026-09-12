/**
 * How much time a session is allowed, and on whose behalf.
 *
 * This is the boundary that keeps currency out of the meter. The economy answers
 * "this session may play N milliseconds, for user U, against grant G"; gaming
 * burns it and reports what was actually played. Coins, game tokens, same-day
 * expiry and weekday-versus-weekend pricing all live on the far side of this
 * line, so a pricing experiment can never become a change to the arithmetic that
 * bills a child.
 *
 * `grantedMs: null` means UNLIMITED — an admin- or parent-attributed session.
 * That is a grant with no ceiling, not a bypass of the mechanism.
 */
export class IPlayTimeGrant {
  /**
   * @param {Object} _session
   * @returns {Promise<{grantedMs: number|null, grantRef: string|null}|null>}
   *   null when no grant exists, which must NOT be read as unlimited.
   */
  async forSession(_session) { throw new Error('IPlayTimeGrant.forSession must be implemented'); }
}
