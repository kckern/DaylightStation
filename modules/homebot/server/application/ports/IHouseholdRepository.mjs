// backend/src/3_applications/homebot/ports/IHouseholdRepository.mjs

/**
 * Port interface for household data access
 * @interface IHouseholdRepository
 */
export class IHouseholdRepository {
  /**
   * Get household members
   * @param {string} householdId
   * @returns {Promise<Array<{userId: string, displayName: string, group?: string}>>}
   */
  async getMembers(_householdId) { throw new Error('IHouseholdRepository.getMembers not implemented'); }

  /**
   * Get display name for a user
   * @param {string} householdId
   * @param {string} userId
   * @returns {Promise<string>}
   */
  async getMemberDisplayName(_householdId, _userId) { throw new Error('IHouseholdRepository.getMemberDisplayName not implemented'); }

  /**
   * Get household timezone
   * @param {string} householdId
   * @returns {Promise<string>}
   */
  async getTimezone(_householdId) { throw new Error('IHouseholdRepository.getTimezone not implemented'); }

  /**
   * Resolve household ID from conversation ID
   * @param {string} conversationId
   * @returns {Promise<string|null>}
   */
  async resolveHouseholdId(_conversationId) { throw new Error('IHouseholdRepository.resolveHouseholdId not implemented'); }
}

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
