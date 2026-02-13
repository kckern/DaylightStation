/**
 * UserIdentityService - platform-agnostic identity resolution
 * @module domains/messaging/services/UserIdentityService
 *
 * Resolves platform-specific user IDs to system usernames and vice versa.
 * Receives identity mappings as plain data — no I/O, no ConfigService dependency.
 */

export class UserIdentityService {
  #mappings;

  /**
   * @param {Object} identityMappings - Map of platform → { platformId: username }
   * @example
   * new UserIdentityService({
   *   telegram: { '575596036': 'kckern' },
   *   discord: { '987654321': 'kckern' },
   * })
   */
  constructor(identityMappings = {}) {
    this.#mappings = identityMappings;
  }

  /**
   * Resolve a platform user ID to a system username
   * @param {string} platform - Platform name ('telegram', 'discord', etc.)
   * @param {string|number} platformId - Platform-specific user identifier
   * @returns {string|null} System username or null
   */
  resolveUsername(platform, platformId) {
    if (!platform || platformId == null) return null;
    return this.#mappings[platform]?.[String(platformId)] ?? null;
  }

  /**
   * Resolve a system username to a platform user ID (reverse lookup)
   * @param {string} platform - Platform name
   * @param {string} username - System username
   * @returns {string|null} Platform user ID or null
   */
  resolvePlatformId(platform, username) {
    if (!platform || !username) return null;
    const platformMappings = this.#mappings[platform];
    if (!platformMappings) return null;
    for (const [platformId, user] of Object.entries(platformMappings)) {
      if (user === username) return platformId;
    }
    return null;
  }

  /**
   * Check if a platform user is known
   * @param {string} platform - Platform name
   * @param {string|number} platformId - Platform-specific user identifier
   * @returns {boolean}
   */
  isKnownUser(platform, platformId) {
    return this.resolveUsername(platform, platformId) !== null;
  }
}

export default UserIdentityService;
