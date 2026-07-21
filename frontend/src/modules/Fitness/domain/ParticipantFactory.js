/**
 * ParticipantFactory
 * 
 * Factory for creating Participant domain entities from various data sources.
 * This centralizes all the logic for:
 * - Resolving device-to-user mappings
 * - Determining active/inactive status
 * - Computing zone information
 * - Resolving display labels
 * 
 * UI components should NEVER perform these operations directly.
 * See: docs/ops/fix-fitness-user-consistency.md
 * 
 * @module Fitness/domain/ParticipantFactory
 */

import { createEmptyParticipant, validateParticipant } from './Participant.js';
import { lookupZoneProgress } from './zoneProgressIndex.js';

/**
 * Default inactive timeout (ms) - device considered inactive after this period without readings
 */
const DEFAULT_INACTIVE_TIMEOUT = 60000;

/**
 * Create a Participant from a roster entry and associated device data.
 * This is the SINGLE SOURCE OF TRUTH for participant creation.
 * 
 * @param {Object} rosterEntry - Entry from participantRoster
 * @param {Object} [options] - Additional options
 * @param {Array} [options.devices] - Array of raw device objects to match against
 * @param {Array} [options.zoneConfig] - Zone configuration for zone lookup
 * @param {number} [options.inactiveTimeout] - Timeout for inactive determination
 * @param {Function} [options.getDisplayLabel] - Function to resolve display labels
 * @param {Map<string, Object>} [options.zoneProgressIndex] - From buildZoneProgressIndex(); resolves zoneProgress by stable ID
 * @returns {import('./Participant.js').Participant}
 */
export const fromRosterEntry = (rosterEntry, options = {}) => {
  if (!rosterEntry) {
    return createEmptyParticipant();
  }

  const {
    devices = [],
    zoneConfig = [],
    inactiveTimeout = DEFAULT_INACTIVE_TIMEOUT,
    getDisplayLabel,
    zoneProgressIndex = null
  } = options;

  // Find matching raw device (for timestamp info)
  const rawDevice = devices.find(d => 
    d && rosterEntry.hrDeviceId && String(d.deviceId) === String(rosterEntry.hrDeviceId)
  );

  // Determine active status - roster entry is authoritative
  const isActive = determineActiveStatus(rosterEntry, rawDevice, inactiveTimeout);

  // Resolve zone info
  const { zoneId, zoneColor } = resolveZoneInfo(rosterEntry, zoneConfig);

  // Generate canonical ID
  const id = rosterEntry.id || 
             rosterEntry.profileId || 
             rosterEntry.hrDeviceId || 
             `participant-${rosterEntry.name || 'unknown'}`;

  // Resolve display label
  const displayLabel = typeof getDisplayLabel === 'function'
    ? getDisplayLabel(rosterEntry.name, { userId: id })
    : (rosterEntry.displayLabel || rosterEntry.name || 'Participant');

  // Resolve zone progress by STABLE ID first. Looking this up by display name
  // is what broke the sidebar sort on 2026-07-21 — see zoneProgressIndex.js.
  const progressEntry = zoneProgressIndex
    ? lookupZoneProgress(zoneProgressIndex, {
        profileId: rosterEntry.profileId || id,
        id,
        name: rosterEntry.name,
        displayLabel,
        deviceId: rosterEntry.hrDeviceId
      })
    : null;

  return {
    id,
    name: rosterEntry.name || '',
    displayLabel,
    profileId: rosterEntry.profileId || rosterEntry.id || null,
    deviceId: rosterEntry.hrDeviceId || (rawDevice?.deviceId) || null,
    heartRate: Number.isFinite(rosterEntry.heartRate) && rosterEntry.heartRate > 0
      ? rosterEntry.heartRate
      : (rawDevice?.heartRate > 0 ? rawDevice.heartRate : null),
    isActive,
    zoneId,
    zoneColor,
    // Live (non-hysteresis) zone — what the cards render and what sortByZoneRank
    // ranks on. Falls back to the committed zone when the roster has no raw value.
    rawZoneId: rosterEntry.rawZoneId ? String(rosterEntry.rawZoneId).toLowerCase() : zoneId,
    rawZoneColor: rosterEntry.rawZoneColor || zoneColor,
    // null (not 0) on a miss, so a later task's diagnostic can tell a miss from a real 0.
    zoneProgress: Number.isFinite(progressEntry?.progress) ? progressEntry.progress : null,
    isGuest: Boolean(rosterEntry.isGuest),
    timestamp: rawDevice?.timestamp || Date.now(),
    lastSeen: rawDevice?.lastSeen || Date.now(),
    metadata: rosterEntry.metadata || null,
    // Preserve type for backward compatibility with device-based code
    type: 'heart_rate',
    hrInactive: rosterEntry.hrInactive ?? false
  };
};

/**
 * Determine if a participant is currently active.
 * 
 * Priority:
 * 1. Roster entry's explicit isActive flag (set by DeviceManager/ActivityMonitor)
 * 2. Device lastSeen timestamp check
 * 3. Default to true (assume active until proven otherwise)
 * 
 * @param {Object} rosterEntry - Roster entry
 * @param {Object|null} rawDevice - Raw device data
 * @param {number} inactiveTimeout - Timeout in ms
 * @returns {boolean}
 */
export const determineActiveStatus = (rosterEntry, rawDevice, inactiveTimeout = DEFAULT_INACTIVE_TIMEOUT) => {
  // Roster entry is authoritative (set by DeviceManager)
  if (rosterEntry?.isActive !== undefined) {
    return rosterEntry.isActive;
  }

  // Fallback to timestamp check
  const lastSeen = rawDevice?.lastSeen ?? rawDevice?.timestamp;
  if (Number.isFinite(lastSeen) && lastSeen > 0) {
    return (Date.now() - lastSeen) <= inactiveTimeout;
  }

  // Default to active if no data
  return true;
};

/**
 * Resolve zone information from roster entry and zone config.
 * 
 * @param {Object} rosterEntry - Roster entry with zoneId/zoneColor
 * @param {Array} zoneConfig - Zone configuration array
 * @returns {{ zoneId: string|null, zoneColor: string|null }}
 */
export const resolveZoneInfo = (rosterEntry, zoneConfig = []) => {
  // Prefer roster entry's zone info (already computed by session logic)
  if (rosterEntry?.zoneId) {
    const normalizedId = String(rosterEntry.zoneId).toLowerCase();
    const zoneColor = rosterEntry.zoneColor || lookupZoneColor(normalizedId, zoneConfig);
    return { zoneId: normalizedId, zoneColor };
  }

  // No zone info available
  return { zoneId: null, zoneColor: null };
};

/**
 * Look up zone color from zone configuration.
 * 
 * @param {string} zoneId - Zone ID to look up
 * @param {Array} zoneConfig - Zone configuration array
 * @returns {string|null}
 */
export const lookupZoneColor = (zoneId, zoneConfig = []) => {
  if (!zoneId || !Array.isArray(zoneConfig)) return null;
  
  const normalizedId = String(zoneId).toLowerCase();
  const zone = zoneConfig.find(z => z && String(z.id).toLowerCase() === normalizedId);
  return zone?.color || null;
};

/**
 * Create multiple Participants from a roster array.
 * 
 * @param {Array} roster - Array of roster entries
 * @param {Object} options - Options passed to fromRosterEntry
 * @returns {import('./Participant.js').Participant[]}
 */
export const fromRoster = (roster, options = {}) => {
  if (!Array.isArray(roster)) return [];
  
  return roster
    .filter(entry => entry && (entry.hrDeviceId || Number.isFinite(entry.heartRate)))
    .map(entry => fromRosterEntry(entry, options));
};

/**
 * Canonical zone ranking, coolest → hottest.
 *
 * SSOT: previously duplicated as CONFIG.zone.rankMap in FitnessUsers.jsx.
 * Import this instead of redeclaring it.
 */
export const ZONE_RANK_MAP = Object.freeze({ cool: 0, active: 1, warm: 2, hot: 3, fire: 4 });

/**
 * Rank a participant by their LIVE zone.
 *
 * Deliberately prefers `rawZoneId` over the committed `zoneId`: the committed
 * zone is hysteresis-smoothed for governance stability, and using it here would
 * desync sort order from the card color and progress bar, which both render
 * live state. Hysteresis remains in force for governance decisions only.
 */
const rankOf = (participant, zoneRankMap) => {
  const zoneId = participant?.rawZoneId || participant?.zoneId || null;
  if (!zoneId) return -1;
  return zoneRankMap[String(zoneId).toLowerCase()] ?? -1;
};

/**
 * THE sort for heart-rate participants. Order: live zone rank desc →
 * progress-within-zone desc → active before inactive → id asc (determinism).
 *
 * Progress is only meaningful as a tiebreaker WITHIN a zone, since each user
 * has their own BPM ranges.
 *
 * @param {import('./Participant.js').Participant[]} participants
 * @param {Object} [zoneRankMap] - defaults to ZONE_RANK_MAP
 * @returns {import('./Participant.js').Participant[]} a new sorted array
 */
export const sortByZoneRank = (participants, zoneRankMap = ZONE_RANK_MAP) => {
  if (!Array.isArray(participants)) return [];

  return [...participants].sort((a, b) => {
    const aRank = rankOf(a, zoneRankMap);
    const bRank = rankOf(b, zoneRankMap);
    if (bRank !== aRank) return bRank - aRank;

    const aProgress = Number.isFinite(a?.zoneProgress) ? a.zoneProgress : 0;
    const bProgress = Number.isFinite(b?.zoneProgress) ? b.zoneProgress : 0;
    if (bProgress !== aProgress) return bProgress - aProgress;

    if (a?.isActive && !b?.isActive) return -1;
    if (!a?.isActive && b?.isActive) return 1;

    return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
  });
};

/**
 * Validate a batch of participants (for debugging).
 * 
 * @param {any[]} participants - Array to validate
 * @returns {{ valid: boolean, errors: Array<{ index: number, errors: string[] }> }}
 */
export const validateParticipants = (participants) => {
  if (!Array.isArray(participants)) {
    return { valid: false, errors: [{ index: -1, errors: ['Input must be an array'] }] };
  }

  const errors = [];
  participants.forEach((p, index) => {
    const result = validateParticipant(p);
    if (!result.valid) {
      errors.push({ index, errors: result.errors });
    }
  });

  return { valid: errors.length === 0, errors };
};

export default {
  fromRosterEntry,
  fromRoster,
  determineActiveStatus,
  resolveZoneInfo,
  lookupZoneColor,
  sortByZoneRank,
  ZONE_RANK_MAP,
  validateParticipants
};
