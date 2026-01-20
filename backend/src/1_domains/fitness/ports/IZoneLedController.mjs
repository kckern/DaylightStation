/**
 * IZoneLedController - Port interface for ambient LED zone control
 *
 * Controls ambient lighting based on workout zone state.
 * Implementations handle rate limiting, circuit breaking, and scene activation.
 */

export const IZoneLedController = {
  /**
   * Activate a scene for the current zone state
   * @param {Object} params
   * @param {Array<{zoneId: string, isActive: boolean}>} params.zones - Zone data for all participants
   * @param {boolean} params.sessionEnded - Whether the session has ended
   * @param {string} params.householdId - Household ID
   * @returns {Promise<{ok: boolean, scene?: string, skipped?: boolean, reason?: string, error?: string}>}
   */
  async syncZone(params) {},

  /**
   * Get current controller status
   * @param {string} householdId
   * @returns {{enabled: boolean, scenes?: Object, state: Object}}
   */
  getStatus(householdId) {},

  /**
   * Get metrics for observability
   * @returns {Object} Metrics data
   */
  getMetrics() {},

  /**
   * Reset controller state (e.g., after circuit breaker trip)
   * @returns {void}
   */
  reset() {}
};

export default IZoneLedController;
