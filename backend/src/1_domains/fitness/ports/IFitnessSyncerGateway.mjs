/**
 * IFitnessSyncerGateway - Port interface for FitnessSyncer integration
 *
 * Defines the contract for adapters that harvest fitness activities
 * from FitnessSyncer (third-party service for Garmin data).
 *
 * Implementations handle OAuth token management, activity fetching,
 * source ID resolution, and circuit breaker cooldown.
 */

/**
 * @typedef {Object} ActivityOptions
 * @property {number} [daysBack=30] - Number of days to fetch activities
 * @property {string} [sourceKey='GarminWellness'] - Provider key for source
 * @property {number} [limit=100] - Max items per page
 */

/**
 * @typedef {Object} Activity
 * @property {string} id - Activity ID
 * @property {string} date - Activity timestamp
 * @property {string} type - Activity type (e.g., 'Running', 'Steps')
 * @property {number} [duration] - Duration in seconds
 * @property {number} [calories] - Calories burned
 * @property {number} [distance] - Distance in meters
 * @property {number} [avgHeartrate] - Average heart rate
 * @property {number} [maxHeartrate] - Maximum heart rate
 * @property {number} [steps] - Step count (for Steps type)
 */

/**
 * @typedef {Object} CooldownStatus
 * @property {boolean} inCooldown - Whether circuit breaker is open
 * @property {number} [remainingMs] - Milliseconds until cooldown ends
 * @property {number} [remainingMins] - Minutes until cooldown ends
 */

/**
 * Port interface for FitnessSyncer gateway
 */
export const IFitnessSyncerGateway = {
  /**
   * Required methods that implementations must provide
   */
  requiredMethods: [
    'getAccessToken',
    'getActivities',
    'getSourceId',
    'setSourceId',
    'isInCooldown'
  ],

  /**
   * Validate that an implementation provides all required methods
   * @param {Object} implementation - Object to validate
   * @returns {boolean} true if valid
   * @throws {Error} if missing required methods
   */
  validate(implementation) {
    for (const method of this.requiredMethods) {
      if (typeof implementation[method] !== 'function') {
        throw new Error(`IFitnessSyncerGateway: missing required method '${method}'`);
      }
    }
    return true;
  }
};

/**
 * Check if an object implements IFitnessSyncerGateway (non-throwing)
 * @param {Object} obj - Object to validate
 * @returns {boolean}
 */
export function isFitnessSyncerGateway(obj) {
  if (!obj || typeof obj !== 'object') return false;

  return IFitnessSyncerGateway.requiredMethods.every(
    method => typeof obj[method] === 'function'
  );
}

/**
 * Assert that object implements IFitnessSyncerGateway
 * @template T
 * @param {T} gateway - Gateway implementation
 * @returns {T}
 * @throws {Error} if gateway doesn't implement IFitnessSyncerGateway
 */
export function assertFitnessSyncerGateway(gateway) {
  if (!isFitnessSyncerGateway(gateway)) {
    throw new Error('Object does not implement IFitnessSyncerGateway interface');
  }
  return gateway;
}

export default IFitnessSyncerGateway;
