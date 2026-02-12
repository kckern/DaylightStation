/**
 * User Resolver
 * @module infrastructure/users/UserResolver
 *
 * @deprecated Use UserIdentityService from 2_domains/messaging/services/ instead.
 * This wrapper exists for backward compatibility during migration.
 */

import { createLogger } from '../logging/logger.mjs';

/**
 * Resolves platform users to system usernames
 * @deprecated Use UserIdentityService instead
 */
export class UserResolver {
  #configService;
  #userIdentityService;
  #logger;

  /**
   * @param {Object} configService - ConfigService instance
   * @param {Object} [options]
   * @param {Object} [options.logger] - Logger instance
   * @param {Object} [options.userIdentityService] - Domain identity service (preferred)
   */
  constructor(configService, options = {}) {
    this.#configService = configService;
    this.#userIdentityService = options.userIdentityService || null;
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

    // Prefer domain service if injected
    if (this.#userIdentityService) {
      return this.#userIdentityService.resolveUsername(platform, platformUserId);
    }

    // Legacy fallback
    const username = this.#configService.resolveUsername(platform, platformUserId);

    if (!username) {
      this.#logger.debug?.('userResolver.notFound', { platform, platformUserId });
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
