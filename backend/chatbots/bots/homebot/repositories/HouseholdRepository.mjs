/**
 * Household Repository
 * @module homebot/repositories/HouseholdRepository
 * 
 * Provides access to household member data from ConfigService.
 */

import { configService } from '../../../../lib/config/ConfigService.mjs';
import { createLogger } from '../../../_lib/logging/index.mjs';

/**
 * Household Repository
 * Wraps ConfigService for household member lookups.
 */
export class HouseholdRepository {
  #householdId;
  #logger;

  /**
   * @param {Object} [options]
   * @param {string} [options.householdId] - Override household ID
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(options = {}) {
    this.#householdId = options.householdId || null;
    this.#logger = options.logger || createLogger({ source: 'repository', app: 'homebot' });
  }

  /**
   * Get the effective household ID
   * @returns {string}
   */
  #getHouseholdId() {
    return this.#householdId || configService.getDefaultHouseholdId();
  }

  /**
   * Get all household members with display names
   * @returns {Array<{username: string, displayName: string}>}
   */
  async getHouseholdMembers() {
    const hid = this.#getHouseholdId();
    const usernames = configService.getHouseholdUsers(hid);
    
    this.#logger.debug('household.getMembers', { householdId: hid, count: usernames.length });
    
    return usernames.map(username => {
      const profile = configService.getUserProfile(username);
      return {
        username,
        displayName: profile?.display_name || profile?.name || this.#formatUsername(username),
      };
    });
  }

  /**
   * Get a single member by username
   * @param {string} username
   * @returns {Object|null} Member object with username and displayName
   */
  async getMemberByUsername(username) {
    const profile = configService.getUserProfile(username);
    if (!profile) {
      return { username, displayName: this.#formatUsername(username) };
    }
    return {
      username,
      displayName: profile.display_name || profile.name || this.#formatUsername(username),
    };
  }

  /**
   * Format a username as a display name (fallback)
   * @private
   * @param {string} username
   * @returns {string}
   */
  #formatUsername(username) {
    if (!username) return 'Unknown';
    // Capitalize first letter
    return username.charAt(0).toUpperCase() + username.slice(1);
  }
}

export default HouseholdRepository;
