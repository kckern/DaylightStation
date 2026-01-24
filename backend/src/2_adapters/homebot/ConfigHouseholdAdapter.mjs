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

  async getMembers(householdId) {
    const config = this.#configService.getHouseholdConfig(householdId);
    const users = config?.users || {};

    return Object.entries(users).map(([userId, userData]) => ({
      userId,
      displayName: userData.display_name || userData.name || userId,
      group: userData.group || null
    }));
  }

  async getMemberDisplayName(householdId, userId) {
    const config = this.#configService.getHouseholdConfig(householdId);
    const user = config?.users?.[userId];
    return user?.display_name || user?.name || userId;
  }

  async getTimezone(householdId) {
    const config = this.#configService.getHouseholdConfig(householdId);
    return config?.timezone || 'America/Los_Angeles';
  }

  async resolveHouseholdId(conversationId) {
    if (this.#userResolver) {
      const username = await this.#userResolver.resolveUsername(conversationId);
      if (username) {
        return this.#configService.getHouseholdIdForUser(username);
      }
    }
    // Fallback to default household
    return this.#configService.getDefaultHouseholdId();
  }
}

export default ConfigHouseholdAdapter;
