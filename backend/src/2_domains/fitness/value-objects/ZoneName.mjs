/**
 * ZoneName Value Object
 * @module fitness/domain/value-objects/ZoneName
 *
 * Defines heart rate zone names with priority and color constants.
 * Zones represent intensity levels: cool < active < warm < hot < fire
 */

/**
 * @enum {string}
 */
export const ZoneName = Object.freeze({
  COOL: 'cool',
  ACTIVE: 'active',
  WARM: 'warm',
  HOT: 'hot',
  FIRE: 'fire',
});

/**
 * All valid zone names in priority order
 * @type {string[]}
 */
export const ZONE_NAMES = Object.freeze([
  ZoneName.COOL,
  ZoneName.ACTIVE,
  ZoneName.WARM,
  ZoneName.HOT,
  ZoneName.FIRE,
]);

/**
 * Zone priorities (higher = more intense)
 * @type {Object.<string, number>}
 */
export const ZONE_PRIORITY = Object.freeze({
  [ZoneName.COOL]: 0,
  [ZoneName.ACTIVE]: 1,
  [ZoneName.WARM]: 2,
  [ZoneName.HOT]: 3,
  [ZoneName.FIRE]: 4,
});

/**
 * Zone colors (for UI display)
 * @type {Object.<string, string>}
 */
export const ZONE_COLORS = Object.freeze({
  [ZoneName.COOL]: '#3498db',   // blue
  [ZoneName.ACTIVE]: '#2ecc71', // green
  [ZoneName.WARM]: '#f1c40f',   // yellow
  [ZoneName.HOT]: '#e67e22',    // orange
  [ZoneName.FIRE]: '#e74c3c',   // red
});

/**
 * Check if a value is a valid zone name
 * @param {string} name
 * @returns {boolean}
 */
export function isValidZoneName(name) {
  return ZONE_NAMES.includes(name);
}

/**
 * Get priority for a zone name
 * @param {string} name
 * @returns {number} Priority (0-4) or -1 if invalid
 */
export function zonePriority(name) {
  const priority = ZONE_PRIORITY[name];
  return priority !== undefined ? priority : -1;
}

/**
 * Get color for a zone name
 * @param {string} name
 * @returns {string|null} Hex color or null if invalid
 */
export function zoneColor(name) {
  return ZONE_COLORS[name] || null;
}

/**
 * Compare two zones by priority (for sorting)
 * @param {string} a - First zone name
 * @param {string} b - Second zone name
 * @returns {number} Negative if a < b, positive if a > b, 0 if equal
 */
export function compareZones(a, b) {
  return zonePriority(a) - zonePriority(b);
}

export default ZoneName;
