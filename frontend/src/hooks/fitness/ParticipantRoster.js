/**
 * ParticipantRoster - Manages participant roster computation
 * 
 * Extracted from FitnessSession as part of Phase 4 decomposition.
 * This module handles:
 * - Building roster from devices and user mappings
 * - Tracking historical participants
 * - Guest/member resolution
 * - Zone information integration
 * 
 * @see /docs/notes/fitness-architecture-review.md Phase 4
 */

import { slugifyId, resolveDisplayLabel } from './types.js';
import { ParticipantStatus } from '../../modules/Fitness/domain/types.js';

/**
 * @typedef {Object} RosterEntry
 * @property {string} name - Participant name
 * @property {string} displayLabel - Display label
 * @property {string|null} groupLabel - Group label
 * @property {string} profileId - Profile ID for avatar/data lookup
 * @property {string|null} baseUserName - Base user for guests
 * @property {boolean} isGuest - Whether this is a guest
 * @property {string} hrDeviceId - Heart rate device ID
 * @property {number|null} heartRate - Current heart rate
 * @property {string|null} zoneId - Current zone ID
 * @property {string|null} zoneColor - Current zone color
 * @property {string|null} avatarUrl - Avatar URL
 * @property {import('../../modules/Fitness/domain/types.js').ParticipantStatusValue} [status] - Activity status (from ActivityMonitor)
 * @property {boolean} isActive - SINGLE SOURCE OF TRUTH: true if device is broadcasting (no inactiveSince)
 * @property {number|null} inactiveSince - Timestamp when device went inactive (from DeviceManager)
 */

/**
 * ParticipantRoster class - manages roster computation and tracking
 */
export class ParticipantRoster {
  constructor() {
    // Historical participant tracking
    this._historicalParticipants = new Set();
    
    // Cached roster
    this._cachedRoster = null;
    this._cacheVersion = 0;
    
    // External references (set via configure)
    this._deviceManager = null;
    this._userManager = null;
    this._treasureBox = null;
    this._activityMonitor = null;
    this._timeline = null;
  }

  /**
   * Configure external dependencies
   * @param {Object} config
   * @param {Object} config.deviceManager
   * @param {Object} config.userManager
   * @param {Object} [config.treasureBox]
   * @param {Object} [config.activityMonitor]
   * @param {Object} [config.timeline]
   */
  configure(config = {}) {
    if (config.deviceManager) this._deviceManager = config.deviceManager;
    if (config.userManager) this._userManager = config.userManager;
    if (config.treasureBox !== undefined) this._treasureBox = config.treasureBox;
    if (config.activityMonitor !== undefined) this._activityMonitor = config.activityMonitor;
    if (config.timeline !== undefined) this._timeline = config.timeline;
    this._invalidateCache();
  }

  /**
   * Reset roster state
   */
  reset() {
    this._historicalParticipants.clear();
    this._invalidateCache();
    
    // Clear external references to force reconfiguration
    // This prevents using stale managers after a session reset
    this._deviceManager = null;
    this._userManager = null;
    this._treasureBox = null;
    this._activityMonitor = null;
    this._timeline = null;
  }

  /**
   * Invalidate cached roster
   */
  _invalidateCache() {
    this._cachedRoster = null;
    this._cacheVersion++;
  }

  /**
   * Build and return current roster.
   * This computes the roster from current device/user state.
   * 
   * @returns {RosterEntry[]}
   */
  getRoster() {
    if (!this._deviceManager || !this._userManager) {
      return [];
    }

    const roster = [];
    const heartRateDevices = this._deviceManager.getAllDevices().filter(d => d.type === 'heart_rate');
    
    // Build zone lookup from TreasureBox
    const zoneLookup = this._buildZoneLookup();

    heartRateDevices.forEach((device) => {
      const entry = this._buildRosterEntry(device, zoneLookup);
      if (entry) {
        roster.push(entry);
        // Track historical participant
        const slug = slugifyId(entry.name);
        if (slug) this._historicalParticipants.add(slug);
      }
    });

    return roster;
  }

  /**
   * Get active participants (currently broadcasting)
   * @returns {RosterEntry[]}
   */
  getActive() {
    const roster = this.getRoster();
    if (!this._activityMonitor) return roster;
    
    return roster.filter(entry => {
      const slug = slugifyId(entry.name);
      return this._activityMonitor.isActive(slug);
    });
  }

  /**
   * Get inactive participants (in session but not broadcasting)
   * @returns {RosterEntry[]}
   */
  getInactive() {
    const roster = this.getRoster();
    if (!this._activityMonitor) return [];
    
    return roster.filter(entry => {
      const slug = slugifyId(entry.name);
      return this._activityMonitor.isInDropout(slug);
    });
  }

  /**
   * Get all roster entries with status enrichment
   * @returns {RosterEntry[]}
   */
  getAllWithStatus() {
    const roster = this.getRoster();
    if (!this._activityMonitor) return roster;
    
    return roster.map(entry => {
      const slug = slugifyId(entry.name);
      return {
        ...entry,
        status: this._activityMonitor.getStatus(slug)
      };
    });
  }

  /**
   * Get historical participant IDs (all who have been in session)
   * @returns {string[]}
   */
  getHistoricalParticipants() {
    const participants = new Set(this._historicalParticipants);
    
    // Also check timeline for historical data
    if (this._timeline?.getAllParticipantIds) {
      const timelineIds = this._timeline.getAllParticipantIds();
      timelineIds.forEach((id) => {
        const normalized = this._normalizeSlug(id);
        if (normalized) participants.add(normalized);
      });
    }
    
    return Array.from(participants);
  }

  /**
   * Check if roster is empty
   * @returns {boolean}
   */
  isEmpty() {
    return this.getRoster().length === 0;
  }

  /**
   * Get roster size
   * @returns {number}
   */
  size() {
    return this.getRoster().length;
  }

  /**
   * Find participant by name or ID
   * @param {string} nameOrId 
   * @returns {RosterEntry|null}
   */
  findParticipant(nameOrId) {
    const roster = this.getRoster();
    const slug = slugifyId(nameOrId);
    return roster.find(entry => {
      const entrySlug = slugifyId(entry.name);
      return entrySlug === slug || entry.profileId === nameOrId || entry.hrDeviceId === nameOrId;
    }) || null;
  }

  // Private helpers

  _buildZoneLookup() {
    const zoneLookup = new Map();
    
    if (!this._treasureBox) return zoneLookup;
    
    const zoneSnapshot = typeof this._treasureBox.getUserZoneSnapshot === 'function'
      ? this._treasureBox.getUserZoneSnapshot()
      : [];
    
    zoneSnapshot.forEach((entry) => {
      if (!entry || !entry.user) return;
      const key = slugifyId(entry.user);
      if (!key) return;
      zoneLookup.set(key, {
        zoneId: entry.zoneId ? String(entry.zoneId).toLowerCase() : null,
        color: entry.color || null
      });
    });
    
    return zoneLookup;
  }

  _buildRosterEntry(device, zoneLookup) {
    if (!device || device.id == null) return null;
    
    const deviceId = String(device.id);
    const heartRate = Number.isFinite(device.heartRate) ? Math.round(device.heartRate) : null;
    
    // Resolve participant name from guest assignment or user mapping
    const guestEntry = this._userManager?.assignmentLedger?.get?.(deviceId) || null;
    const ledgerName = guestEntry?.occupantName || guestEntry?.metadata?.name || null;
    const mappedUser = this._userManager.resolveUserForDevice(deviceId);
    const participantName = ledgerName || mappedUser?.name;
    
    if (!participantName) return null;

    const key = slugifyId(participantName);
    const zoneInfo = zoneLookup.get(key) || null;
    const fallbackZoneId = mappedUser?.currentData?.zone || null;
    const fallbackZoneColor = mappedUser?.currentData?.color || null;

    // Resolve heart rate from user if device doesn't have it
    let resolvedHeartRate = heartRate;
    if (mappedUser?.currentData && Number.isFinite(mappedUser.currentData.heartRate)) {
      const candidateHr = Math.round(mappedUser.currentData.heartRate);
      if (candidateHr > 0) {
        resolvedHeartRate = candidateHr;
      }
    }

    const isGuest = (guestEntry?.occupantType || 'guest') === 'guest';
    const baseUserName = isGuest
      ? (guestEntry?.metadata?.baseUserName || guestEntry?.metadata?.base_user_name || null)
      : participantName;
    
    const displayLabel = resolveDisplayLabel({
      name: participantName,
      groupLabel: isGuest ? null : mappedUser?.groupLabel,
      preferGroupLabel: !isGuest
    });

    // Get status from ActivityMonitor if available
    const status = this._activityMonitor 
      ? this._activityMonitor.getStatus(key)
      : ParticipantStatus.ACTIVE;

    // SINGLE SOURCE OF TRUTH: isActive comes directly from DeviceManager's inactiveSince
    // This is the authoritative field that ALL consumers should use for avatar visibility
    const isActive = !device.inactiveSince;

    return {
      name: participantName,
      displayLabel,
      groupLabel: isGuest ? null : mappedUser?.groupLabel || null,
      profileId: mappedUser?.id || key,
      baseUserName,
      isGuest,
      hrDeviceId: deviceId,
      heartRate: resolvedHeartRate,
      zoneId: zoneInfo?.zoneId || fallbackZoneId || null,
      zoneColor: zoneInfo?.color || fallbackZoneColor || null,
      avatarUrl: isGuest ? null : mappedUser?.avatarUrl || null,
      status,
      isActive, // SINGLE SOURCE OF TRUTH for avatar visibility
      inactiveSince: device.inactiveSince || null // Pass through for debugging
    };
  }

  _normalizeSlug(slug) {
    if (typeof slug !== 'string') return null;
    const normalized = slug.trim();
    return normalized || null;
  }
}

/**
 * Create a ParticipantRoster instance
 * @returns {ParticipantRoster}
 */
export const createParticipantRoster = () => new ParticipantRoster();

export default ParticipantRoster;
