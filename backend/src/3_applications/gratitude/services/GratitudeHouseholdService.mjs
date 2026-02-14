/**
 * GratitudeHouseholdService
 *
 * Application layer service for household-related gratitude concerns:
 * timezone resolution, category validation, display name resolution,
 * and household user aggregation.
 *
 * Extracted from the gratitude API router to keep HTTP-layer code
 * focused on req/res handling only.
 *
 * @module applications/gratitude/services
 */

import { nowTs24 } from '#system/utils/index.mjs';

export class GratitudeHouseholdService {
  #configService;
  #gratitudeService;

  /**
   * @param {Object} deps
   * @param {Object} deps.configService - ConfigService for household data
   * @param {Object} deps.gratitudeService - GratitudeService for category validation
   */
  constructor({ configService, gratitudeService }) {
    if (!configService) {
      throw new Error('GratitudeHouseholdService requires configService');
    }
    if (!gratitudeService) {
      throw new Error('GratitudeHouseholdService requires gratitudeService');
    }
    this.#configService = configService;
    this.#gratitudeService = gratitudeService;
  }

  /**
   * Get household timezone
   * @param {string} householdId
   * @returns {string} Timezone string (defaults to 'UTC')
   */
  getTimezone(householdId) {
    return this.#configService.getHouseholdTimezone?.(householdId) || 'UTC';
  }

  /**
   * Generate timestamp in household's timezone
   * @param {string} householdId
   * @returns {string} Formatted timestamp
   */
  generateTimestamp(householdId) {
    const timezone = this.getTimezone(householdId);
    if (timezone && timezone !== 'UTC') {
      return new Date().toLocaleString('en-US', { timeZone: timezone });
    }
    return nowTs24();
  }

  /**
   * Validate category parameter
   * @param {string} category - Raw category string
   * @returns {string|null} Lowercase category if valid, null otherwise
   */
  validateCategory(category) {
    const cat = String(category || '').toLowerCase();
    return this.#gratitudeService.isValidCategory(cat) ? cat : null;
  }

  /**
   * Resolve display name for a user
   * @param {string} userId
   * @returns {string} Display name
   */
  resolveDisplayName(userId) {
    if (!userId) return 'Unknown';
    const profile = this.#configService.getUserProfile?.(userId);
    return profile?.group_label
      || profile?.display_name
      || profile?.name
      || userId.charAt(0).toUpperCase() + userId.slice(1);
  }

  /**
   * Get household users from config
   * @param {string} householdId
   * @returns {Array<{id: string, name: string, group_label: string|null}>}
   */
  getHouseholdUsers(householdId) {
    const usernames = this.#configService.getHouseholdUsers?.(householdId) || [];
    return usernames.map(username => {
      const profile = this.#configService.getUserProfile?.(username);
      return {
        id: username,
        name: profile?.display_name || profile?.name ||
          username.charAt(0).toUpperCase() + username.slice(1),
        group_label: profile?.group_label || null
      };
    });
  }
}
