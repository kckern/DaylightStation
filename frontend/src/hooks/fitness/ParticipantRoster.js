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
    this._zoneProfileStore = null;
  }

  /**
   * Configure external dependencies
   * @param {Object} config
   * @param {Object} config.deviceManager
   * @param {Object} config.userManager
   * @param {Object} [config.treasureBox]
   * @param {Object} [config.activityMonitor]
   * @param {Object} [config.timeline]
   * @param {Object} [config.zoneProfileStore]
   */
  configure(config = {}) {
    if (config.deviceManager) this._deviceManager = config.deviceManager;
    if (config.userManager) this._userManager = config.userManager;
    if (config.treasureBox !== undefined) this._treasureBox = config.treasureBox;
    if (config.activityMonitor !== undefined) this._activityMonitor = config.activityMonitor;
    if (config.timeline !== undefined) this._timeline = config.timeline;
    if (config.zoneProfileStore !== undefined) this._zoneProfileStore = config.zoneProfileStore;
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
    this._zoneProfileStore = null;
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

    const heartRateDevices = this._deviceManager.getAllDevices().filter(d => d.type === 'heart_rate');

    // Zone lookup (TreasureBox baseline + ZoneProfileStore committed zones)
    const zoneLookup = this._buildZoneLookup();

    // Group devices by their user UUID. Devices with no mapped user and no
    // ledger assignment are emitted under a synthetic per-device key so they
    // still render as anonymous-rider cards.
    const devicesByUserId = new Map(); // userId → Device[]
    const anonymousDevices = [];       // no user, no ledger

    for (const device of heartRateDevices) {
      const deviceId = String(device.id || device.deviceId);
      const mappedUser = this._userManager.resolveUserForDevice(deviceId);
      const ledgerEntry = this._userManager?.assignmentLedger?.get?.(deviceId) || null;
      const ledgerName = ledgerEntry?.occupantName || ledgerEntry?.metadata?.name || null;

      if (mappedUser?.id) {
        const bucket = devicesByUserId.get(mappedUser.id);
        if (bucket) bucket.push(device);
        else devicesByUserId.set(mappedUser.id, [device]);
      } else if (ledgerName) {
        // Guest/ledger assignment — keyed by device ID (ledger is always 1:1).
        devicesByUserId.set(`ledger:${deviceId}`, [device]);
      } else {
        // Truly anonymous — no user, no ledger. Preserve current drop-anon
        // behavior (_buildRosterEntry returns null when no participantName).
        anonymousDevices.push(device);
      }
    }

    // preferGroupLabels must reflect USER presence, not DEVICE count.
    // Count unique users with at least one active (broadcasting) device.
    let presentUserCount = 0;
    for (const devices of devicesByUserId.values()) {
      if (devices.some(d => !d.inactiveSince)) presentUserCount += 1;
    }
    const preferGroupLabels = presentUserCount > 1;

    getLogger().debug('participant.roster.build', {
      heartRateDeviceCount: heartRateDevices.length,
      userCount: devicesByUserId.size,
      presentUserCount,
      anonymousDeviceCount: anonymousDevices.length,
      preferGroupLabels,
    });

    const roster = [];

    // Emit one entry per user UUID (or per ledger device).
    for (const [, devices] of devicesByUserId) {
      // Primary device: first active, else first owned. Drives legacy
      // entry.hrDeviceId and entry.isActive / entry.inactiveSince.
      const active = devices.filter(d => !d.inactiveSince);
      const primary = active.length > 0 ? active[0] : devices[0];
      const entry = this._buildRosterEntry(primary, zoneLookup, {
        preferGroupLabels,
        ownedDevices: devices,
      });
      if (entry) {
        roster.push(entry);
        if (entry.id) this._historicalParticipants.add(entry.id);
      }
    }

    // Emit truly-anonymous device entries unchanged (will be dropped inside
    // _buildRosterEntry because no participantName resolves — preserves the
    // previous contract explicitly).
    for (const device of anonymousDevices) {
      const entry = this._buildRosterEntry(device, zoneLookup, { preferGroupLabels });
      if (entry) {
        roster.push(entry);
        if (entry.id) this._historicalParticipants.add(entry.id);
      }
    }

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
   * Canonical participant state for governance and other consumers.
   * Returns active participant IDs and their zone map in a single call.
   * Consumers should use this instead of reading getRoster() and re-extracting.
   *
   * @returns {{ participants: string[], zoneMap: Object<string, string>, totalCount: number }}
   */
  getActiveParticipantState() {
    const roster = this.getRoster();
    const participants = [];
    const zoneMap = {};

    for (const entry of roster) {
      if (!entry.isActive) continue;
      const id = entry.id || entry.profileId;
      if (!id) continue;
      participants.push(id);
      const zoneId = entry.zoneId;
      if (zoneId) {
        zoneMap[id] = typeof zoneId === 'string' ? zoneId.toLowerCase() : String(zoneId).toLowerCase();
      }
    }

    return { participants, zoneMap, totalCount: participants.length };
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
    const deviceIds = new Set(deviceRoster.flatMap(e => e.hrDeviceIds || [e.hrDeviceId].filter(Boolean)));
    
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
        hrDeviceIds: [String(entry.deviceId)], // Ghost entries only have one known device
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

    // Start with TreasureBox as baseline (raw zone data)
    if (this._treasureBox && typeof this._treasureBox.getUserZoneSnapshot === 'function') {
      const zoneSnapshot = this._treasureBox.getUserZoneSnapshot();
      (zoneSnapshot || []).forEach((entry) => {
        if (!entry) return;
        const trackingId = entry.trackingId || entry.userId || entry.entityId;
        if (!trackingId) return;
        zoneLookup.set(trackingId, {
          zoneId: entry.zoneId ? String(entry.zoneId).toLowerCase() : null,
          color: entry.color || null
        });
      });
    }

    // Override with ZoneProfileStore committed zones (hysteresis-aware)
    // Preserve raw zone for real-time UI (cards, LEDs) while committed zone
    // is used for governance decisions and historical persistence.
    if (this._zoneProfileStore && typeof this._zoneProfileStore.getZoneState === 'function') {
      for (const [trackingId] of zoneLookup) {
        const committed = this._zoneProfileStore.getZoneState(trackingId);
        if (committed?.zoneId) {
          const baseline = zoneLookup.get(trackingId);
          const rawZoneId = baseline?.zoneId || null;
          const rawZoneColor = baseline?.color || null;
          zoneLookup.set(trackingId, {
            zoneId: String(committed.zoneId).toLowerCase(),
            color: committed.zoneColor || rawZoneColor || null,
            rawZoneId,
            rawZoneColor
          });
        }
      }
    }

    return zoneLookup;
  }

  _buildRosterEntry(device, zoneLookup, options = {}) {
    if (!device || device.id == null) return null;

    const { preferGroupLabels = false, ownedDevices = null } = options;
    const deviceId = String(device.id);
    // HR aggregation: when the user owns multiple devices, UserManager's
    // updateFromDevice has already applied min-HR arbitration and written
    // the result to user.currentData.heartRate. Prefer that value; fall back
    // to the primary device's raw reading for the single-device path.
    let rawHeartRate = Number.isFinite(device.heartRate) ? Math.round(device.heartRate) : null;

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

    // Prefer the user's aggregated HR (min-HR arbitration across owned
    // devices). Fall back to the primary device's raw reading.
    const aggregatedHR = Number.isFinite(mappedUser?.currentData?.heartRate)
      ? Math.round(mappedUser.currentData.heartRate)
      : null;
    const resolvedHeartRate = aggregatedHR != null ? aggregatedHR : rawHeartRate;

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

    // SINGLE SOURCE OF TRUTH: isActive is true when ANY owned device is
    // broadcasting. The `primary` device passed in by getRoster is already
    // chosen to be an active one when possible, so !device.inactiveSince
    // captures that — but for safety, also scan ownedDevices explicitly
    // when the group-by-user path supplies them.
    const isActive = Array.isArray(ownedDevices) && ownedDevices.length > 0
      ? ownedDevices.some(d => !d.inactiveSince)
      : !device.inactiveSince;
    // inactiveSince: pick the most-recent inactiveSince when ALL devices are
    // inactive, else null (i.e. isActive=true means no inactiveSince).
    let resolvedInactiveSince = device.inactiveSince || null;
    if (Array.isArray(ownedDevices) && ownedDevices.length > 0 && !isActive) {
      resolvedInactiveSince = ownedDevices
        .map(d => d.inactiveSince)
        .filter(ts => ts != null)
        .reduce((max, ts) => (ts > max ? ts : max), 0) || null;
    } else if (Array.isArray(ownedDevices) && ownedDevices.length > 0 && isActive) {
      resolvedInactiveSince = null;
    }
    
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
      hrDeviceId: deviceId, // Primary device (first active, else first owned) — legacy singular key
      // Full device list. Prefer the authoritative source (user's hrDeviceIds
      // Set from UserManager). Fall back to the ownedDevices array the caller
      // passed in (covers the rare case of a user hydrated without the Set).
      // Final fallback: just the primary device ID.
      hrDeviceIds: mappedUser?.hrDeviceIds && mappedUser.hrDeviceIds.size > 0
        ? [...mappedUser.hrDeviceIds].map(String)
        : (Array.isArray(ownedDevices) && ownedDevices.length > 0
            ? ownedDevices.map(d => String(d.id || d.deviceId))
            : [String(deviceId)]),
      heartRate: resolvedHeartRate,
      zoneId: zoneInfo?.zoneId || null,
      zoneColor: zoneInfo?.color || null,
      rawZoneId: zoneInfo?.rawZoneId || zoneInfo?.zoneId || null,
      rawZoneColor: zoneInfo?.rawZoneColor || zoneInfo?.color || null,
      avatarUrl: isGuest ? null : mappedUser?.avatarUrl || null,
      status,
      isActive, // SINGLE SOURCE OF TRUTH for avatar visibility
      inactiveSince: resolvedInactiveSince, // Null when any owned device is active; else latest inactiveSince across all owned devices
      hrInactive: mappedUser?.currentData?.hrInactive ?? true
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
