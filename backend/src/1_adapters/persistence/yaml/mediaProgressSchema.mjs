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
