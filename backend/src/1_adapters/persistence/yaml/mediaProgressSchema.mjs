// backend/src/1_adapters/persistence/yaml/mediaProgressSchema.mjs

/**
 * Schema constants for MediaProgress persistence.
 * Defines canonical format after P0 migration and legacy fields for validation.
 */

/**
 * Canonical fields in the migrated schema.
 * These are the only fields that should exist after P0 migration.
 * @type {readonly string[]}
 */
export const CANONICAL_FIELDS = Object.freeze([
  'playhead',
  'duration',
  'percent',
  'playCount',
  'lastPlayed',
  'watchTime',
  'bookmark'
]);

/**
 * Legacy fields that should have been migrated.
 * Presence of these fields indicates incomplete migration.
 * @type {readonly string[]}
 */
export const LEGACY_FIELDS = Object.freeze([
  'seconds',
  'mediaDuration',
  'time',
  'title',
  'parent',
  'grandparent'
]);

/**
 * Mapping from legacy field names to their canonical equivalents.
 * Used for migration and understanding field transformations.
 * @type {Readonly<Record<string, string>>}
 */
export const LEGACY_TO_CANONICAL = Object.freeze({
  seconds: 'playhead',
  mediaDuration: 'duration',
  time: 'lastPlayed'
});

/**
 * Serialize a MediaProgress domain entity to a plain object for persistence.
 * This is the adapter-layer responsibility (not domain entity's concern).
 * @param {import('#domains/content/entities/MediaProgress.mjs').MediaProgress} entity
 * @returns {{ itemId: string, playhead: number, duration: number, percent: number, playCount: number, lastPlayed: string|null, watchTime: number, bookmark?: Object }}
 */
export function serializeMediaProgress(entity) {
  const json = {
    itemId: entity.itemId,
    playhead: entity.playhead,
    duration: entity.duration,
    percent: entity.percent,
    playCount: entity.playCount,
    lastPlayed: entity.lastPlayed,
    watchTime: entity.watchTime
  };
  if (entity.bookmark) json.bookmark = entity.bookmark;
  return json;
}

/**
 * Validate that a data object contains only canonical fields.
 * @param {Object} data - Plain object to validate
 * @returns {{ valid: boolean, legacyFields: string[] }} Validation result
 */
export function validateCanonicalSchema(data) {
  if (!data || typeof data !== 'object') {
    return { valid: true, legacyFields: [] };
  }

  const foundLegacyFields = Object.keys(data).filter(
    key => LEGACY_FIELDS.includes(key)
  );

  return {
    valid: foundLegacyFields.length === 0,
    legacyFields: foundLegacyFields
  };
}
