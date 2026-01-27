/**
 * User Resolver
 * @module infrastructure/users/UserResolver
 *
 * Resolves platform-specific user identifiers to system usernames
 * using household-scoped identity mappings from ConfigService.
 */

import { createLogger } from '../logging/logger.mjs';

/**
 * Resolves platform users to system usernames
 */
export class UserResolver {
  #configService;
  #logger;

  /**
   * @param {Object} configService - ConfigService instance
   * @param {Object} [options]
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(configService, options = {}) {
    this.#configService = configService;
    this.#logger = options.logger || createLogger({ source: 'user-resolver', app: 'chatbots' });
  }

  /**
   * Resolve a platform user ID to a system username
   *
   * @param {string} platform - Platform name ('telegram', 'discord', etc.)
   * @param {string} platformUserId - Platform-specific user identifier
   * @param {string} [householdId] - Optional household override, defaults to default household
   * @returns {string|null} - System username or null if not found
   */
  resolveUser(platform, platformUserId, householdId = null) {
    if (!platform || !platformUserId) return null;

    const hid = householdId ?? this.#configService.getDefaultHouseholdId();
    const chatbotsConfig = this.#configService.getHouseholdAppConfig(hid, 'chatbots');

    const username = chatbotsConfig?.identity_mappings?.[platform]?.[String(platformUserId)] ?? null;

    if (!username) {
      this.#logger.debug?.('userResolver.notFound', { platform, platformUserId, householdId: hid });
    }

    return username;
  }

  /**
   * Check if a platform user is known
   *
   * @param {string} platform - Platform name
   * @param {string} platformUserId - Platform-specific user identifier
   * @param {string} [householdId] - Optional household override
   * @returns {boolean}
   */
  isKnownUser(platform, platformUserId, householdId = null) {
    return this.resolveUser(platform, platformUserId, householdId) !== null;
  }
}

export default UserResolver;
