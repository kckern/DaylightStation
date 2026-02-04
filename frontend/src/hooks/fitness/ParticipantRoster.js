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

import { resolveDisplayLabel } from './types.js';
import { ParticipantStatus } from '../../modules/Fitness/domain/types.js';
import getLogger from '../../lib/logging/Logger.js';

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

    // Determine if we should prefer group labels (2+ ACTIVE participants)
    // Only count devices that are currently broadcasting:
    // 1. Not marked as inactive (no inactiveSince)
    // 2. Has actual HR data (heartRate > 0) - filters out pre-populated devices with no data
    const activeHeartRateDevices = heartRateDevices.filter(d =>
      !d.inactiveSince && Number.isFinite(d.heartRate) && d.heartRate > 0
    );
    const preferGroupLabels = activeHeartRateDevices.length > 1;

    // DEBUG: Log device count and preferGroupLabels decision
    getLogger().debug('participant.roster.build', {
      heartRateDeviceCount: heartRateDevices.length,
      activeHeartRateDeviceCount: activeHeartRateDevices.length,
      preferGroupLabels,
      deviceIds: heartRateDevices.map(d => String(d.id || d.deviceId)),
      activeDeviceIds: activeHeartRateDevices.map(d => String(d.id || d.deviceId))
    });

    heartRateDevices.forEach((device) => {
      const entry = this._buildRosterEntry(device, zoneLookup, { preferGroupLabels });
      if (entry) {
        roster.push(entry);
        // Track historical participant by ID
        if (entry.id) this._historicalParticipants.add(entry.id);
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
      return this._activityMonitor.isActive(entry.id);
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
      return this._activityMonitor.isInDropout(entry.id);
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
      return {
        ...entry,
        status: this._activityMonitor.getStatus(entry.id)
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
        if (id) participants.add(id);
      });
    }
    
    return Array.from(participants);
  }

  /**
   * Get full roster including inactive participants from ledger
   * This reconciles device roster with ledger assignments to include
   * participants whose devices are offline but assignment is still active.
   * 
   * @returns {RosterEntry[]}
   * @see /docs/reviews/guest-assignment-service-audit.md Issue #4
   */
  getFullRoster() {
    const deviceRoster = this.getRoster(); // Current behavior - active devices only
    const deviceIds = new Set(deviceRoster.map(e => e.hrDeviceId));
    
    // Add ledger entries for devices not currently broadcasting
    const ledgerEntries = this._userManager?.assignmentLedger?.snapshot?.() || [];
    ledgerEntries.forEach(entry => {
      if (!entry.deviceId || deviceIds.has(entry.deviceId)) return;
      
      // Create "inactive" roster entry from ledger
      const ghostEntry = {
        name: entry.occupantName || entry.metadata?.name || 'Unknown',
        displayLabel: entry.occupantName || entry.metadata?.name || 'Unknown',
        groupLabel: null,
        profileId: entry.metadata?.profileId || entry.occupantId,
        id: entry.metadata?.profileId || entry.occupantId,
        baseUserName: entry.metadata?.baseUserName || null,
        isGuest: (entry.occupantType || 'guest') === 'guest',
        hrDeviceId: entry.deviceId,
        heartRate: null,
        zoneId: null,
        zoneColor: null,
        avatarUrl: null,
        status: ParticipantStatus.REMOVED,
        isActive: false,
        inactiveSince: entry.updatedAt || null,
        _source: 'ledger' // For debugging
      };
      deviceRoster.push(ghostEntry);
    });
    
    return deviceRoster;
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
    // Direct lookup by id, profileId, or hrDeviceId
    return roster.find(entry => {
      return entry.id === nameOrId || entry.profileId === nameOrId || entry.hrDeviceId === nameOrId || entry.name === nameOrId;
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
      if (!entry) return;
      // Phase 4: Use trackingId (entityId with userId fallback) as primary key
      const trackingId = entry.trackingId || entry.userId || entry.entityId;
      if (!trackingId) return;

      zoneLookup.set(trackingId, {
        zoneId: entry.zoneId ? String(entry.zoneId).toLowerCase() : null,
        color: entry.color || null
      });
    });

    return zoneLookup;
  }

  _buildRosterEntry(device, zoneLookup, options = {}) {
    if (!device || device.id == null) return null;

    const { preferGroupLabels = false } = options;
    const deviceId = String(device.id);
    const heartRate = Number.isFinite(device.heartRate) ? Math.round(device.heartRate) : null;

    // Resolve participant name from guest assignment or user mapping
    const guestEntry = this._userManager?.assignmentLedger?.get?.(deviceId) || null;
    const ledgerName = guestEntry?.occupantName || guestEntry?.metadata?.name || null;
    const mappedUser = this._userManager.resolveUserForDevice(deviceId);
    const participantName = ledgerName || mappedUser?.name;

    if (!participantName) return null;

    // Use the actual user ID - must be explicitly set
    const userId = mappedUser?.id || guestEntry?.occupantId || guestEntry?.metadata?.profileId;
    if (!userId) {
      getLogger().warn('participant.roster.missing_user_id', { participantName });
    }

    // Phase 4: Get entityId from ledger for entity-aware tracking
    const entityId = guestEntry?.entityId || null;

    // Phase 4: Calculate trackingId for zone lookup (matches TreasureBox key scheme)
    const trackingId = entityId || userId;

    // For grace period transfers: include timelineUserId so chart reads original user's data
    // (Note: The Transfer Path approach moves data, but this provides a fallback or metadata-driven path)
    const timelineUserId = guestEntry?.metadata?.timelineUserId || null;

    // Phase 4: Use trackingId for zone lookup (matches TreasureBox key scheme)
    const zoneInfo = zoneLookup.get(trackingId) || null;

    // Phase 5: Get entity-specific data (start time) if available
    // Use registry start time if available, otherwise guestEntry update time
    const registryStartTime = entityId ? this._session?.entityRegistry?.get?.(entityId)?.startTime : null;
    let entityStartTime = registryStartTime || guestEntry?.updatedAt || null;
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

    const isGuest = guestEntry
      ? (guestEntry.occupantType === 'guest')
      : (mappedUser ? mappedUser.source === 'Guest' : true);

    const baseUserName = isGuest
      ? (guestEntry?.metadata?.baseUserName || guestEntry?.metadata?.base_user_name || null)
      : participantName;

    // For primary users, prefer group labels only when multiple participants are present
    // For guests, never use group labels (they don't have them)
    const shouldPreferGroupLabel = !isGuest && preferGroupLabels;
    const groupLabel = isGuest ? null : mappedUser?.groupLabel;

    const displayLabel = resolveDisplayLabel({
      name: participantName,
      groupLabel,
      preferGroupLabel: shouldPreferGroupLabel
    });

    // Log display label resolution for debugging participant count transitions
    if (groupLabel && !isGuest) {
      getLogger().debug('participant.roster.display_label_resolved', {
        userId,
        name: participantName,
        groupLabel,
        displayLabel,
        preferGroupLabels,
        shouldPreferGroupLabel
      });
    }

    // Get status from ActivityMonitor if available
    const status = this._activityMonitor 
      ? this._activityMonitor.getStatus(userId)
      : ParticipantStatus.ACTIVE;

    // SINGLE SOURCE OF TRUTH: isActive comes directly from DeviceManager's inactiveSince
    // This is the authoritative field that ALL consumers should use for avatar visibility
    const isActive = !device.inactiveSince;
    
    // (Consolidated above)

    const rosterEntry = {
      name: participantName,
      displayLabel,
      groupLabel: isGuest ? null : mappedUser?.groupLabel || null,
      profileId: userId,
      id: userId,
      entityId, // Phase 5: Session entity ID for entity-aware tracking
      timelineUserId, // Grace period transfer: ID of user whose series to display
      entityStartTime, // Phase 5: When this entity started (for session duration display)
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

    return rosterEntry;
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
