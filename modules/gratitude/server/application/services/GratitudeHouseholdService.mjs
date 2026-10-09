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

import { HouseholdUserProjection } from '../../../../../capabilities/household-identity/server/public.mjs';
import { nowTs24 } from '#system/utils/index.mjs';

export class GratitudeHouseholdService {
  #householdDirectory;
  #identity;
  #gratitudeService;

  /**
   * @param {Object} deps
   * @param {Object} deps.householdDirectory - Household and user projection
   * @param {Object} deps.gratitudeService - GratitudeService for category validation
   */
  constructor({ householdDirectory, gratitudeService }) {
    if (!householdDirectory) {
      throw new Error('GratitudeHouseholdService requires householdDirectory');
    }
    if (!gratitudeService) {
      throw new Error('GratitudeHouseholdService requires gratitudeService');
    }
    this.#householdDirectory = householdDirectory;
    this.#identity = new HouseholdUserProjection({householdDirectory});
    this.#gratitudeService = gratitudeService;
  }

  /**
   * Get household timezone
   * @param {string} householdId
   * @returns {string} Timezone string (defaults to 'UTC')
   */
  getTimezone(householdId) {
    return this.#householdDirectory.timezone?.(householdId) || 'UTC';
  }

  getDefaultHouseholdId() {
    return this.#householdDirectory.defaultHouseholdId();
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

  resolveDisplayName(userId) { return this.#identity.resolveDisplayName(userId); }
  getHouseholdUsers(householdId) { return this.#identity.getHouseholdUsers(householdId); }

}
