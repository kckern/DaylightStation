// backend/src/2_adapters/homebot/ConfigHouseholdAdapter.mjs

import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * ConfigHouseholdAdapter
 *
 * Repository adapter implementing IHouseholdRepository using ConfigService.
 *
 * Note: This adapter uses ConfigService for data access (household lookups),
 * not for adapter configuration. This is appropriate because household data
 * is stored in ConfigService. The adapter has no static configuration needs.
 *
 * @module adapters/homebot/ConfigHouseholdAdapter
 */
export class ConfigHouseholdAdapter {
  #configService;
  #userResolver;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.configService - ConfigService for household data lookups
   * @param {Object} [deps.userResolver] - UserResolver for conversation ID mapping
   * @param {Object} [deps.logger]
   */
  constructor(deps) {
    if (!deps.configService) {
      throw new InfrastructureError('ConfigHouseholdAdapter requires configService', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'configService'
      });
    }
    this.#configService = deps.configService;
    this.#userResolver = deps.userResolver;
    this.#logger = deps.logger || console;
  }

  async getMembers(householdId = null) {
    const hid = householdId ?? this.#configService.getDefaultHouseholdId();
    const users = this.#configService.getHouseholdUsers(hid) || [];

    // Handle array format from ConfigService - look up profiles for display names
    return users.map((user) => {
      const userId = typeof user === 'string' ? user : (user.username || user.userId || user.name);
      const profile = this.#configService.getUserProfile(userId);

      // Match legacy pattern: separate displayName and groupLabel
      const displayName = profile?.display_name || profile?.name || this.#formatUsername(userId);
      const groupLabel = profile?.group_label || null;

      return {
        userId,
        displayName,
        groupLabel,
        group: profile?.group || null
      };
    });
  }

  /**
   * Format a username as a display name (fallback)
   * @private
   */
  #formatUsername(username) {
    if (!username) return 'Unknown';
    return username.charAt(0).toUpperCase() + username.slice(1);
  }

  async getMemberDisplayName(householdId = null, userId) {
    const profile = this.#configService.getUserProfile(userId);
    // Prefer group_label (e.g., "Dad"), then display_name, then formatted username
    return profile?.group_label
      || profile?.display_name
      || profile?.name
      || this.#formatUsername(userId);
  }

  async getTimezone(householdId = null) {
    const hid = householdId ?? this.#configService.getDefaultHouseholdId();
    return this.#configService.getHouseholdTimezone(hid);
  }

  /**
   * Get the default household ID
   * @returns {string}
   */
  getHouseholdId() {
    return this.#configService.getDefaultHouseholdId();
  }

  /**
   * Resolve household ID from conversation context
   * Note: This method requires platform and platformUserId to resolve users.
   * For simple lookups, use getHouseholdId() which returns the default.
   * @param {string} conversationId - Conversation ID (for logging/fallback only)
   * @param {string} [platform] - Platform name ('telegram', etc.)
   * @param {string} [platformUserId] - Platform-specific user ID
   * @returns {Promise<string>} Household ID
   */
  async resolveHouseholdId(conversationId, platform = null, platformUserId = null) {
    if (this.#userResolver && platform && platformUserId) {
      const username = this.#userResolver.resolveUser(platform, platformUserId);
      if (username) {
        return this.#configService.getUserHouseholdId(username);
      }
    }
    // Fallback to default household
    return this.#configService.getDefaultHouseholdId();
  }
}

export default ConfigHouseholdAdapter;
