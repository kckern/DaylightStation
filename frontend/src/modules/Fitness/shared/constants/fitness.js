/**
 * Fitness Constants
 * 
 * Shared constants for the Fitness module (shell and apps).
 * These provide a single source of truth for zone definitions,
 * thresholds, and other fitness-specific values.
 */

// =============================================================================
// HEART RATE ZONES
// =============================================================================

/**
 * Zone IDs in order of intensity (lowest to highest)
 */
export const ZONE_IDS = ['rest', 'cool', 'active', 'warm', 'hot', 'fire'];

/**
 * Zone definitions with metadata
 * Percentages are relative to max heart rate
 */
export const ZONES = {
  rest: {
    id: 'rest',
    name: 'Rest',
    label: 'Resting',
    minPercent: 0,
    maxPercent: 50,
    intensity: 0,
    color: 'gray',
    cssVar: '--zone-rest',
    hex: '#888888'
  },
  cool: {
    id: 'cool',
    name: 'Cool',
    label: 'Very Light',
    minPercent: 50,
    maxPercent: 60,
    intensity: 1,
    color: 'blue',
    cssVar: '--zone-cool',
    hex: '#6ab8ff'
  },
  active: {
    id: 'active',
    name: 'Active',
    label: 'Light',
    minPercent: 60,
    maxPercent: 70,
    intensity: 2,
    color: 'green',
    cssVar: '--zone-active',
    hex: '#51cf66'
  },
  warm: {
    id: 'warm',
    name: 'Warm',
    label: 'Moderate',
    minPercent: 70,
    maxPercent: 80,
    intensity: 3,
    color: 'yellow',
    cssVar: '--zone-warm',
    hex: '#ffd43b'
  },
  hot: {
    id: 'hot',
    name: 'Hot',
    label: 'Hard',
    minPercent: 80,
    maxPercent: 90,
    intensity: 4,
    color: 'orange',
    cssVar: '--zone-hot',
    hex: '#ff922b'
  },
  fire: {
    id: 'fire',
    name: 'Fire',
    label: 'Maximum',
    minPercent: 90,
    maxPercent: 100,
    intensity: 5,
    color: 'red',
    cssVar: '--zone-fire',
    hex: '#ff6b6b'
  }
};

/**
 * Zone color hex values (for direct use in JS)
 */
export const ZONE_COLORS = {
  rest: '#888888',
  gray: '#888888',
  cool: '#6ab8ff',
  blue: '#6ab8ff',
  active: '#51cf66',
  green: '#51cf66',
  warm: '#ffd43b',
  yellow: '#ffd43b',
  hot: '#ff922b',
  orange: '#ff922b',
  fire: '#ff6b6b',
  red: '#ff6b6b'
};

/**
 * Get zone color by ID or color name
 * @param {string} zoneOrColor - Zone ID or color name
 * @param {string} [fallback] - Fallback color (default: gray)
 * @returns {string} Hex color value
 */
export const getZoneColor = (zoneOrColor, fallback = '#888888') => {
  if (!zoneOrColor) return fallback;
  const key = String(zoneOrColor).toLowerCase();
  return ZONE_COLORS[key] || fallback;
};

/**
 * Get zone by heart rate percentage
 * @param {number} percent - Heart rate as percentage of max
 * @returns {Object} Zone definition
 */
export const getZoneByPercent = (percent) => {
  if (percent == null || !Number.isFinite(percent)) {
    return ZONES.rest;
  }

  for (const zoneId of [...ZONE_IDS].reverse()) {
    const zone = ZONES[zoneId];
    if (percent >= zone.minPercent) {
      return zone;
    }
  }

  return ZONES.rest;
};

/**
 * Get zone by BPM given max heart rate
 * @param {number} bpm - Current heart rate in BPM
 * @param {number} maxHr - Maximum heart rate
 * @returns {Object} Zone definition
 */
export const getZoneByBpm = (bpm, maxHr = 190) => {
  if (!Number.isFinite(bpm) || !Number.isFinite(maxHr) || maxHr <= 0) {
    return ZONES.rest;
  }
  const percent = (bpm / maxHr) * 100;
  return getZoneByPercent(percent);
};

// =============================================================================
// GOVERNANCE STATUS
// =============================================================================

/**
 * Governance status levels
 */
export const GOVERNANCE_STATUS = {
  GREEN: 'green',
  YELLOW: 'yellow',
  RED: 'red',
  GRAY: 'gray',
  INIT: 'init',
  IDLE: 'idle',
  OFF: 'off'
};

/**
 * Governance status priority (for comparison)
 * Higher number = higher priority/severity
 */
export const GOVERNANCE_PRIORITY = {
  off: 0,
  idle: 1,
  init: 2,
  green: 3,
  yellow: 4,
  red: 5
};

/**
 * Compare two governance statuses
 * @param {string} a - First status
 * @param {string} b - Second status
 * @returns {number} Negative if a < b, positive if a > b, 0 if equal
 */
export const compareGovernanceStatus = (a, b) => {
  const priorityA = GOVERNANCE_PRIORITY[String(a).toLowerCase()] ?? 0;
  const priorityB = GOVERNANCE_PRIORITY[String(b).toLowerCase()] ?? 0;
  return priorityA - priorityB;
};

// =============================================================================
// TIMING DEFAULTS
// =============================================================================

/**
 * Default timing values (in milliseconds unless noted)
 */
export const TIMING = {
  // Countdowns
  CHALLENGE_COUNTDOWN_DEFAULT: 30000,    // 30 seconds
  GRACE_PERIOD_DEFAULT: 30000,           // 30 seconds
  AUTO_ACCEPT_DELAY: 5000,               // 5 seconds
  
  // Animation speeds
  STRIPE_ANIMATION_FAST: 500,            // ms
  STRIPE_ANIMATION_NORMAL: 2000,         // ms
  STRIPE_ANIMATION_SLOW: 5000,           // ms
  
  // Update intervals
  TIMER_UPDATE_INTERVAL: 1000,           // 1 second
  PROGRESS_UPDATE_INTERVAL: 100,         // 100ms (smooth progress)
  
  // Debounce/throttle
  VOLUME_DEBOUNCE: 50,
  SEEK_DEBOUNCE: 100
};

// =============================================================================
// TREASURE BOX
// =============================================================================

/**
 * Treasure box coin colors mapped to zones
 */
export const TREASURE_COIN_COLORS = {
  red: '#ff6b6b',
  orange: '#ff922b',
  yellow: '#ffd43b',
  green: '#51cf66',
  blue: '#6ab8ff'
};

/**
 * Coin color rank (for sorting by intensity)
 */
export const COIN_COLOR_RANK = {
  red: 500,      // fire
  orange: 400,   // hot
  yellow: 300,   // warm
  green: 200,    // active
  blue: 100      // cool
};

/**
 * Get coin color rank
 * @param {string} color - Color name or hex
 * @returns {number} Rank (higher = more intense)
 */
export const getCoinColorRank = (color) => {
  if (!color) return 0;
  const key = String(color).toLowerCase();
  
  // Check direct match
  if (COIN_COLOR_RANK[key] != null) {
    return COIN_COLOR_RANK[key];
  }
  
  // Check hex match
  if (key.includes('ff6b6b')) return 500;
  if (key.includes('ff922b')) return 400;
  if (key.includes('ffd43b')) return 300;
  if (key.includes('51cf66')) return 200;
  if (key.includes('6ab8ff')) return 100;
  
  return 0;
};

// =============================================================================
// LAYOUT
// =============================================================================

/**
 * Sidebar size modes
 */
export const SIDEBAR_SIZE_MODE = {
  COMPACT: 'compact',
  NORMAL: 'normal',
  EXPANDED: 'expanded'
};

/**
 * Player modes
 */
export const PLAYER_MODE = {
  NORMAL: 'normal',
  FULLSCREEN: 'fullscreen',
  PIP: 'pip'
};

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  ZONE_IDS,
  ZONES,
  ZONE_COLORS,
  getZoneColor,
  getZoneByPercent,
  getZoneByBpm,
  GOVERNANCE_STATUS,
  GOVERNANCE_PRIORITY,
  compareGovernanceStatus,
  TIMING,
  TREASURE_COIN_COLORS,
  COIN_COLOR_RANK,
  getCoinColorRank,
  SIDEBAR_SIZE_MODE,
  PLAYER_MODE
};
