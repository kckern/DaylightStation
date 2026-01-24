// backend/src/3_applications/homebot/ports/IHouseholdRepository.mjs

/**
 * Port interface for household data access
 * @interface IHouseholdRepository
 */
export const IHouseholdRepository = {
  /**
   * Get household members
   * @param {string} householdId
   * @returns {Promise<Array<{userId: string, displayName: string, group?: string}>>}
   */
  async getMembers(householdId) {},

  /**
   * Get display name for a user
   * @param {string} householdId
   * @param {string} userId
   * @returns {Promise<string>}
   */
  async getMemberDisplayName(householdId, userId) {},

  /**
   * Get household timezone
   * @param {string} householdId
   * @returns {Promise<string>}
   */
  async getTimezone(householdId) {},

  /**
   * Resolve household ID from conversation ID
   * @param {string} conversationId
   * @returns {Promise<string|null>}
   */
  async resolveHouseholdId(conversationId) {}
};

/**
 * Validate object implements IHouseholdRepository
 * @param {Object} obj
 * @returns {boolean}
 */
export function isHouseholdRepository(obj) {
  return (
    obj &&
    typeof obj.getMembers === 'function' &&
    typeof obj.getMemberDisplayName === 'function' &&
    typeof obj.getTimezone === 'function'
  );
}
