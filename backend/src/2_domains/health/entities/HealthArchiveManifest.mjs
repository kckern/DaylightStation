/**
 * HealthArchiveManifest Entity
 *
 * Represents a per-user, per-category manifest file (manifest.yml) that tracks
 * the ingestion state of a user's health archive (e.g. scans, notes, weight).
 *
 * One manifest is written per ingested category. It captures source locations,
 * schema versions, record counts, and the last successful sync timestamp so
 * downstream consumers can reason about freshness and provenance.
 *
 * F4-B: the per-user category vocabulary used to live here as a fixed enum
 * (`VALID_CATEGORIES`). It now lives in playbook config under
 * `archive.custom_categories`. Code holds the BUILT-IN categories
 * (`BUILT_IN_CATEGORIES`) as a floor — they always work. Callers (the
 * orchestrator / CLI) merge the floor with per-user extras and pass the
 * union into the constructor as `validCategories`.
 *
 * @module domains/health/entities
 */

/**
 * The six categories the codebase has historical knowledge of. Acts as the
 * floor — every user gets these without playbook config. Adding to this set
 * is a code change with cross-cutting test impact; users add categories
 * per-playbook via `archive.custom_categories` instead.
 */
export const BUILT_IN_CATEGORIES = Object.freeze([
  'nutrition-history',
  'scans',
  'notes',
  'playbook',
  'weight',
  'workouts',
]);

/**
 * Backwards-compatible alias for the floor set. Pre-F4-B callers imported
 * `VALID_CATEGORIES`. Keep both names exported so external consumers don't
 * silently break — but new code should prefer `BUILT_IN_CATEGORIES`.
 */
export const VALID_CATEGORIES = new Set(BUILT_IN_CATEGORIES);

export class HealthArchiveManifest {
  /**
   * @param {Object} data
   * @param {string} data.userId - Owning user identifier (e.g. 'test-user')
   * @param {string} data.category - A built-in category (one of
   *   nutrition-history, scans, notes, playbook, weight, workouts) OR any
   *   category declared in `validCategories`.
   * @param {string|null} [data.lastSync] - ISO timestamp of last successful sync
   * @param {Array<Object>} [data.sourceLocations] - Source paths and per-source metadata
   * @param {Object} [data.schemaVersions] - Map of sub-archive name to schema version
   * @param {Object} [data.recordCounts] - Aggregate counts and date range for this archive
   * @param {Iterable<string>} [data.validCategories] - Optional category
   *   whitelist override. Defaults to the built-in floor. Callers (the
   *   ingestion orchestrator / CLI) pass the union of `BUILT_IN_CATEGORIES`
   *   and the user's `archive.custom_categories` keys.
   */
  constructor({
    userId,
    category,
    lastSync,
    sourceLocations = [],
    schemaVersions = {},
    recordCounts = {},
    validCategories,
  }) {
    if (!userId) throw new Error('HealthArchiveManifest requires userId');
    const allowed = validCategories ? new Set(validCategories) : VALID_CATEGORIES;
    if (!allowed.has(category)) {
      throw new Error(`HealthArchiveManifest: invalid category "${category}"`);
    }
    this.userId = userId;
    this.category = category;
    this.lastSync = lastSync || null;
    this.sourceLocations = sourceLocations;
    this.schemaVersions = schemaVersions;
    this.recordCounts = recordCounts;
  }

  /**
   * Convert to a YAML-shaped plain object for persistence to manifest.yml.
   * Uses snake_case keys to match on-disk YAML conventions.
   * @returns {Object}
   */
  serialize() {
    return {
      manifest_version: 1,
      user_id: this.userId,
      category: this.category,
      last_sync: this.lastSync,
      source_locations: this.sourceLocations,
      schema_versions: this.schemaVersions,
      record_counts: this.recordCounts,
    };
  }

  /**
   * Whole days since the last successful sync.
   * Returns Infinity if the manifest has never been synced.
   * @returns {number}
   */
  stalenessDays() {
    if (!this.lastSync) return Infinity;
    return Math.floor((Date.now() - new Date(this.lastSync).getTime()) / 86400000);
  }
}

export default HealthArchiveManifest;
