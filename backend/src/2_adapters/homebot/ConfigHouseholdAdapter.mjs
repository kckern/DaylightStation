// backend/src/2_adapters/homebot/ConfigHouseholdAdapter.mjs

/**
 * Adapter implementing IHouseholdRepository using ConfigService
 */
export class ConfigHouseholdAdapter {
  #configService;
  #userResolver;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.configService - ConfigService instance
   * @param {Object} [config.userResolver] - UserResolver for conversation ID mapping
   * @param {Object} [config.logger]
   */
  constructor(config) {
    if (!config.configService) {
      throw new Error('ConfigHouseholdAdapter requires configService');
    }
    this.#configService = config.configService;
    this.#userResolver = config.userResolver;
    this.#logger = config.logger || console;
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

  async resolveHouseholdId(conversationId) {
    if (this.#userResolver) {
      const username = await this.#userResolver.resolveUsername(conversationId);
      if (username) {
        return this.#configService.getUserHouseholdId(username);
      }
    }
    // Fallback to default household
    return this.#configService.getDefaultHouseholdId();
  }
}

export default ConfigHouseholdAdapter;
