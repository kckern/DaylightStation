// backend/src/3_applications/fitness/FitnessConfigService.mjs
/**
 * FitnessConfigService - Normalizes fitness configuration access
 *
 * Encapsulates Plex-specific config structure knowledge, providing
 * a clean interface for API layer consumption.
 */
export class FitnessConfigService {
  constructor({ userDataService, configService }) {
    this.userDataService = userDataService;
    this.configService = configService;
  }

  /**
   * Load and normalize fitness config for a household
   * @param {string} [householdId] - Household ID (uses default if not provided)
   * @returns {Object|null} Normalized config or null if not found
   */
  getNormalizedConfig(householdId) {
    const hid = householdId || this.configService.getDefaultHouseholdId();
    const raw = this.userDataService.readHouseholdAppData(hid, 'fitness', 'config');

    if (!raw) return null;

    // Normalize: extract values from both governance and plex sections
    const governance = raw.governance || {};
    const plex = raw.plex || {};

    return {
      raw,
      householdId: hid,
      contentSource: raw.content_source || 'plex',
      musicPlaylists: plex.music_playlists || [],
      governedLabels: governance.governed_labels?.length
        ? governance.governed_labels
        : plex.governed_labels || [],
      governedTypes: governance.governed_types?.length
        ? governance.governed_types
        : plex.governed_types || ['show', 'movie'],
      progressClassification: raw.progressClassification || {},
      users: raw.users || {}
    };
  }
}
