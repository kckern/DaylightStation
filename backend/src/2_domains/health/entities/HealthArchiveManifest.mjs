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
 * @module domains/health/entities
 */

export const VALID_CATEGORIES = new Set([
  'nutrition-history',
  'scans',
  'notes',
  'playbook',
  'weight',
  'workouts',
]);

export class HealthArchiveManifest {
  /**
   * @param {Object} data
   * @param {string} data.userId - Owning user identifier (e.g. 'kckern')
   * @param {string} data.category - One of: nutrition-history, scans, notes, playbook, weight, workouts
   * @param {string|null} [data.lastSync] - ISO timestamp of last successful sync
   * @param {Array<Object>} [data.sourceLocations] - Source paths and per-source metadata
   * @param {Object} [data.schemaVersions] - Map of sub-archive name to schema version
   * @param {Object} [data.recordCounts] - Aggregate counts and date range for this archive
   */
  constructor({
    userId,
    category,
    lastSync,
    sourceLocations = [],
    schemaVersions = {},
    recordCounts = {},
  }) {
    if (!userId) throw new Error('HealthArchiveManifest requires userId');
    if (!VALID_CATEGORIES.has(category)) {
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
