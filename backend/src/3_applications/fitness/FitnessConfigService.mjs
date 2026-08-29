// backend/src/3_applications/fitness/FitnessConfigService.mjs
/**
 * FitnessConfigService - Normalizes fitness configuration access
 *
 * Consumes a semantic configuration projection, providing
 * a clean interface for API layer consumption and household member extraction.
 * Provider-backed playlist enrichment belongs to the content catalog adapter.
 */
const TIMELAPSE_DEFAULTS = Object.freeze({
  enabled: true, speedup: 10, output_fps: 10, capture_interval_ms: 1000,
  resolution: [1920, 1080], crf: 26, pip: { enabled: true, size: [480, 270] },
  title_bar: true, stat_strip: true, archive_frames: false,
});

export function normalizeFitnessConfig(raw, householdId) {
  if (!raw) return null;
  const governance = raw.governance || {};
  const plex = raw.plex || {};
  const timelapse = raw.timelapse || {};
  return {
    householdId,
    contentSource: raw.content_source || 'plex',
    musicPlaylists: plex.music_playlists || [],
    governance: { ...governance, usage_threshold_seconds: governance.usage_threshold_seconds ?? 300 },
    governedLabels: governance.governed_labels?.length ? governance.governed_labels : plex.governed_labels || [],
    governedTypes: governance.governed_types?.length ? governance.governed_types : plex.governed_types || ['show', 'movie'],
    progressClassification: raw.progressClassification || {},
    users: raw.users || {},
    timelapse: {
      ...TIMELAPSE_DEFAULTS,
      ...timelapse,
      resolution: timelapse.resolution || TIMELAPSE_DEFAULTS.resolution,
      pip: { ...TIMELAPSE_DEFAULTS.pip, ...(timelapse.pip || {}) },
    },
  };
}

export function fitnessSuggestionPolicy(raw = {}) {
  const value = raw.suggestions || {};
  const provider = raw.plex || {};
  return {
    slots: value.grid_size || 8,
    lookbackDays: value.lookback_days ?? 10,
    excludedCollectionIds: value.exclude_collections || [],
    favorites: value.favorites || [],
    discoveryLapsedDays: value.discovery_lapsed_days ?? 30,
    discoveryLapsedWeight: value.discovery_lapsed_weight ?? 0.7,
    discoveryExcludedShowIds: value.discovery_exclude_shows || [],
    discoveryExcludedLabels: value.discovery_exclude_labels || [],
    minimumDurationSeconds: value.discovery_min_duration_seconds ?? 600,
    memorableLookbackDays: value.memorable_lookback_days ?? 90,
    memorableMax: value.memorable_max ?? 2,
    memorablePoolSize: value.memorable_pool_size ?? 10,
    governedLabels: provider.governed_labels || [],
    warmupTitlePatterns: provider.warmup_title_patterns || [],
    warmupDescriptionTags: provider.warmup_description_tags || [],
    deprioritizedLabels: provider.deprioritized_labels || [],
    resumableLabels: provider.resumable_labels || ['Resumable'],
  };
}

export class FitnessConfigService {
  constructor({ configProjection, logger = console }) {
    if (!configProjection?.publicConfig || !configProjection?.raw) throw new Error('FitnessConfigService requires configProjection');
    this.configProjection = configProjection;
    this.logger = logger;
  }

  /**
   * Load raw fitness config for a household (unmodified YAML)
   * @param {string} [householdId] - Household ID (uses default if not provided)
   * @returns {Object|null} Raw config or null if not found
   */
  getPublicConfig(householdId) {
    const hid = this.configProjection.resolveHouseholdId(householdId);
    const householdConfig = this.configProjection.publicConfig(hid);

    if (!householdConfig) {
      // The adapter projection owns the physical-path compatibility hint.
      this.logger.error?.('fitness.config.not-found', {
        householdId: hid,
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
    const hid = this.configProjection.resolveHouseholdId(householdId);
    return normalizeFitnessConfig(this.configProjection.raw(hid), hid);
  }

  /**
   * Extract household member names from fitness config.
   * Used as transcription hints for voice memo processing.
   *
   * @param {string} [householdId] - Household ID (uses default if not provided)
   * @returns {string[]} Unique member names
   */
  getHouseholdMemberNames(householdId) {
    const users = this.configProjection.raw(householdId)?.users;
    if (!users) return [];
    return [...new Set([
      ...(users.primary || []).map((user) => typeof user === 'string' ? user : user.name),
      ...(users.family || []).map((user) => user.name),
    ])];
  }

  /** Provider-neutral policy projection used by cycle-game use cases. */
  getCycleGameConfig(householdId) {
    return this.configProjection.raw(householdId)?.cycle_game || {};
  }

  /** Decide whether a client may write shared fitness sessions. */
  mayWriteSession(householdId, userAgent = '') {
    const whitelist = this.configProjection.raw(householdId)?.session_write_whitelist;
    return !Array.isArray(whitelist) || whitelist.length === 0
      || whitelist.some((pattern) => String(userAgent).includes(pattern));
  }

  getProgressClassification(householdId) { return this.configProjection.raw(householdId)?.progressClassification || {}; }
  getSuggestionPolicy(householdId) { return fitnessSuggestionPolicy(this.configProjection.raw(householdId) || {}); }
  getMenuMusicVolume(householdId) { return this.configProjection.raw(householdId)?.menu_music?.volume ?? 0.05; }
  getAccessPolicy(householdId) { return { users: this.configProjection.raw(householdId)?.users || {} }; }
}
