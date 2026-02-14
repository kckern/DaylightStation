// backend/src/3_applications/fitness/FitnessConfigService.mjs
/**
 * FitnessConfigService - Normalizes fitness configuration access
 *
 * Encapsulates Plex-specific config structure knowledge, providing
 * a clean interface for API layer consumption. Also handles
 * playlist enrichment and household member extraction.
 */
export class FitnessConfigService {
  constructor({ userDataService, configService, logger = console }) {
    this.userDataService = userDataService;
    this.configService = configService;
    this.logger = logger;
  }

  /**
   * Load raw fitness config for a household (unmodified YAML)
   * @param {string} [householdId] - Household ID (uses default if not provided)
   * @returns {Object|null} Raw config or null if not found
   */
  loadRawConfig(householdId) {
    const hid = householdId || this.configService.getDefaultHouseholdId();
    const householdConfig = this.configService.getHouseholdAppConfig(hid, 'fitness');

    if (!householdConfig) {
      this.logger.error?.('fitness.config.not-found', {
        householdId: hid,
        expectedPath: `household[-${hid}]/config/fitness.yml`
      });
      return null;
    }

    return householdConfig;
  }

  /**
   * Load and normalize fitness config for a household
   * @param {string} [householdId] - Household ID (uses default if not provided)
   * @returns {Object|null} Normalized config or null if not found
   */
  getNormalizedConfig(householdId) {
    const hid = householdId || this.configService.getDefaultHouseholdId();
    const raw = this.configService.getHouseholdAppConfig(hid, 'fitness');

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

  /**
   * Enrich music playlists with thumbnails from a content adapter.
   *
   * Playlists that already have a thumbnail are skipped. For others,
   * attempts to resolve a thumbnail via the adapter's getThumbnail method.
   * Failures are silently swallowed (playlist kept as-is).
   *
   * @param {Array<Object>} playlists - Playlist objects (must have .id)
   * @param {Object} adapter - Content adapter with getThumbnail(id) method
   * @returns {Promise<Array<Object>>} Enriched playlists
   */
  async enrichPlaylistThumbnails(playlists, adapter) {
    if (!Array.isArray(playlists) || playlists.length === 0) return playlists;
    if (!adapter?.getThumbnail) return playlists;

    return Promise.all(
      playlists.map(async (playlist) => {
        if (playlist.thumb || playlist.thumbnail || !playlist.id) {
          return playlist;
        }
        try {
          const thumb = await adapter.getThumbnail(playlist.id);
          return { ...playlist, thumb };
        } catch {
          return playlist;
        }
      })
    );
  }

  /**
   * Extract household member names from fitness config.
   * Used as transcription hints for voice memo processing.
   *
   * @param {string} [householdId] - Household ID (uses default if not provided)
   * @returns {string[]} Unique member names
   */
  getHouseholdMemberNames(householdId) {
    const fitnessConfig = this.loadRawConfig(householdId);
    if (!fitnessConfig?.users) return [];

    const members = [];
    if (Array.isArray(fitnessConfig.users.primary)) {
      members.push(...fitnessConfig.users.primary.map(u => typeof u === 'string' ? u : u.name));
    }
    if (Array.isArray(fitnessConfig.users.family)) {
      members.push(...fitnessConfig.users.family.map(u => u.name));
    }

    return [...new Set(members)];
  }
}
