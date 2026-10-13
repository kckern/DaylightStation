/**
 * IZoneLedController - Port interface for ambient LED zone control
 *
 * Controls ambient lighting based on workout zone state.
 * Implementations handle rate limiting, circuit breaking, and scene activation.
 */

export class IZoneLedController {
  /**
   * Activate a scene for the current zone state
   * @param {Object} params
   * @param {Array<{zoneId: string, isActive: boolean}>} params.zones - Zone data for all participants
   * @param {boolean} params.sessionEnded - Whether the session has ended
   * @param {string} params.householdId - Household ID
   * @returns {Promise<{ok: boolean, scene?: string, skipped?: boolean, reason?: string, error?: string}>}
   */
  async syncZone(_params) { throw new Error('IZoneLedController.syncZone not implemented'); }

  /**
   * Get current controller status
   * @param {string} householdId
   * @returns {{enabled: boolean, scenes?: Object, state: Object}}
   */
  getStatus(_householdId) { throw new Error('IZoneLedController.getStatus not implemented'); }

  /**
   * Get metrics for observability
   * @returns {Object} Metrics data
   */
  getMetrics() { throw new Error('IZoneLedController.getMetrics not implemented'); }

  /**
   * Reset controller state (e.g., after circuit breaker trip)
   * @returns {void}
   */
  reset() { throw new Error('IZoneLedController.reset not implemented'); }
}

export default IZoneLedController;
