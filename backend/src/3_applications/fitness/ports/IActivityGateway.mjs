/**
 * IActivityGateway - Port interface for an external fitness activity provider
 *
 * Defines the contract the fitness enrichment + reconciliation use cases rely
 * on to read and update activities on a third-party activity platform (Strava
 * is the current implementation, via StravaClientAdapter). Keeping this port in
 * the application layer lets the use cases stay provider-agnostic — they depend
 * on this interface, not on a concrete adapter.
 *
 * Methods (as exercised by the use cases):
 *   - getActivity(activityId)                  → Promise<Activity|null>
 *   - updateActivity(activityId, payload)      → Promise<void>  (payload: { name?, description? })
 *   - hasAccessToken()                         → boolean
 *   - refreshToken(refreshToken)               → Promise<void>
 *   - getActivityStreams(activityId, keys[])   → Promise<Streams|null>  (e.g. ['heartrate'])
 *
 * ActivityReconciliationService uses getActivity + updateActivity.
 * FitnessActivityEnrichmentService uses all five.
 */

/**
 * Port interface for an external activity provider gateway.
 */
export const IActivityGateway = {
  /**
   * Required methods that implementations must provide.
   */
  requiredMethods: [
    'getActivity',
    'updateActivity',
    'hasAccessToken',
    'refreshToken',
    'getActivityStreams',
  ],

  /**
   * Validate that an implementation provides all required methods.
   * @param {Object} implementation - Object to validate
   * @returns {boolean} true if valid
   * @throws {Error} if missing required methods
   */
  validate(implementation) {
    for (const method of this.requiredMethods) {
      if (typeof implementation[method] !== 'function') {
        throw new Error(`IActivityGateway: missing required method '${method}'`);
      }
    }
    return true;
  },
};

/**
 * Check if an object implements IActivityGateway (non-throwing).
 * @param {Object} obj - Object to validate
 * @returns {boolean}
 */
export function isActivityGateway(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return IActivityGateway.requiredMethods.every(
    method => typeof obj[method] === 'function'
  );
}

export default IActivityGateway;
