import { formatSessionId, ensureSeriesCapacity, deepClone, resolveDisplayLabel } from './types.js';
import { DeviceManager } from './DeviceManager.js';
import { UserManager } from './UserManager.js';
import { GovernanceEngine } from './GovernanceEngine.js';
import { FitnessTreasureBox } from './TreasureBox.js';
import { VoiceMemoManager } from './VoiceMemoManager.js';
import { FitnessTimeline } from './FitnessTimeline.js';
import { DaylightAPI } from '../../lib/api.mjs';
import { ZoneProfileStore } from './ZoneProfileStore.js';
import { EventJournal } from './EventJournal.js';
import { ActivityMonitor } from '../../modules/Fitness/domain/ActivityMonitor.js';
import { SessionEntityRegistry } from './SessionEntity.js';
import { DeviceEventRouter } from './DeviceEventRouter.js';
import moment from 'moment-timezone';
import getLogger from '../../lib/logging/Logger.js';

// Phase 4: Extracted modules for decomposed session management
import { SessionLifecycle } from './SessionLifecycle.js';
import { MetricsRecorder } from './MetricsRecorder.js';
import { ParticipantRoster } from './ParticipantRoster.js';
import { TimelineRecorder } from './TimelineRecorder.js';
import { PersistenceManager } from './PersistenceManager.js';

// -------------------- Timeout Configuration --------------------
const FITNESS_TIMEOUTS = {
  inactive: 60000,
  remove: 180000,
  rpmZero: 3000,
  emptySession: 60000 // 6A: Time (ms) with empty roster before auto-ending session
};

// Soft guardrail to prevent oversized payloads
const MAX_SERIALIZED_SERIES_POINTS = 200000;

const ZONE_SYMBOL_MAP = {
  cool: 'c',
  active: 'a',
  warm: 'w',
  hot: 'h'
};

/**
 * Format a unix-ms timestamp into a human-readable string in a specific timezone.
 *
 * @param {number} unixMs
 * @param {string} timezone
 * @returns {string|null}
 */
const toReadable = (unixMs, timezone) => {
  if (!Number.isFinite(unixMs)) return null;
  const tz = timezone || moment.tz.guess() || 'UTC';
  return moment(unixMs).tz(tz).format('YYYY-MM-DD h:mm:ss a');
};

/**
 * Resolve the timezone used for persistence.
 * @returns {string}
 */
const resolvePersistTimezone = () => {
  const intl = Intl?.DateTimeFormat?.()?.resolvedOptions?.()?.timeZone;
  return intl || moment.tz.guess() || 'UTC';
};

/**
 * Derive the numeric session id used in v2 payloads.
 * @param {string|null} sessionId
 * @returns {string|null}
 */
const deriveNumericSessionId = (sessionId) => {
  if (!sessionId) return null;
  const raw = String(sessionId).trim();
  if (!raw) return null;
  return raw.startsWith('fs_') ? raw.slice(3) : raw;
};

/**
 * Derive YYYY-MM-DD from a numeric session id (YYYYMMDDHHmmss).
 * @param {string|null} numericSessionId
 * @returns {string|null}
 */
const deriveSessionDate = (numericSessionId) => {
  if (!numericSessionId || numericSessionId.length < 8) return null;
  const y = numericSessionId.slice(0, 4);
  const m = numericSessionId.slice(4, 6);
  const d = numericSessionId.slice(6, 8);
  if (!y || !m || !d) return null;
  return `${y}-${m}-${d}`;
};

/**
 * Convert roster + assignment snapshots into a keyed participant object.
 * @param {Array<any>} roster
 * @param {Array<any>} deviceAssignments
 * @returns {Record<string, {display_name?: string, hr_device?: string, is_primary?: boolean, is_guest?: boolean, base_user?: string}>}
 */
const buildParticipantsForPersist = (roster, deviceAssignments) => {
  const participants = {};

  const assignmentBySlug = new Map();
  if (Array.isArray(deviceAssignments)) {
    deviceAssignments.forEach((entry) => {
      // Use occupantId (new) or occupantSlug (legacy) as key
      const key = entry?.occupantId || entry?.occupantSlug;
      if (!key) return;
      assignmentBySlug.set(String(key), entry);
    });
  }

  const safeRoster = Array.isArray(roster) ? roster : [];
  safeRoster.forEach((entry, idx) => {
    if (!entry || typeof entry !== 'object') return;
    const name = typeof entry.name === 'string' ? entry.name : null;
    // Use explicit ID from roster entry
    const participantId = entry.id || entry.profileId || entry.hrDeviceId || `anon-${idx}`;
    if (!participantId) return;

    const assignment = assignmentBySlug.get(participantId) || null;
    const hrDevice = entry.hrDeviceId ?? assignment?.deviceId ?? null;

    participants[participantId] = {
      ...(name ? { display_name: name } : {}),
      ...(hrDevice != null ? { hr_device: String(hrDevice) } : {}),
      ...(entry.isPrimary === true ? { is_primary: true } : {}),
      ...(entry.isGuest === true ? { is_guest: true } : {}),
      ...(entry.baseUserName ? { base_user: String(entry.baseUserName) } : {})
    };
  });

  return participants;
};

/**
 * Normalize numeric values for persistence.
 * - Cumulative series (beats/rotations): round to 1 decimal to avoid float noise
 * - HR/RPM/Power series: round to nearest integer
 *
 * @param {string} key
 * @param {unknown} value
 * @returns {number|null|unknown}
 */
const roundValue = (key, value) => {
  if (value == null) return null;
  if (typeof value !== 'number') return value;
  if (!Number.isFinite(value)) return null;

  const k = String(key || '').toLowerCase();

  // Cumulative series
  if (k.includes('beats') || k.includes('rotations')) {
    return Math.round(value * 10) / 10;
  }

  // Integer metrics
  if (k.includes('heart_rate') || k.includes(':hr') || k.includes('rpm') || k.includes('power')) {
    return Math.round(value);
  }

  return value;
};

export const setFitnessTimeouts = ({ inactive, remove, rpmZero, emptySession } = {}) => {
  if (typeof inactive === 'number' && !Number.isNaN(inactive)) FITNESS_TIMEOUTS.inactive = inactive;
  if (typeof remove === 'number' && !Number.isNaN(remove)) FITNESS_TIMEOUTS.remove = remove;
  if (typeof rpmZero === 'number' && !Number.isNaN(rpmZero)) FITNESS_TIMEOUTS.rpmZero = rpmZero;
  if (typeof emptySession === 'number' && !Number.isNaN(emptySession)) FITNESS_TIMEOUTS.emptySession = emptySession;
};

export const getFitnessTimeouts = () => ({ ...FITNESS_TIMEOUTS });

/**
 * Convert legacy v1 series keys to the compact v2-style keys.
 *
 * Examples:
 * - user:alan:heart_rate   -> alan:hr
 * - user:alan:zone_id      -> alan:zone
 * - user:alan:heart_beats  -> alan:beats
 * - user:alan:coins_total  -> alan:coins
 * - device:7138:rpm        -> bike:7138:rpm
 * - device:device_7138:rpm -> bike:7138:rpm
 * - device:device_28676:heart_rate -> device:28676:heart_rate
 *
 * @param {string} key
 * @returns {string}
 */
const mapSeriesKeyForPersist = (key) => {
  if (!key || typeof key !== 'string') return key;
  const parts = key.split(':');
  if (parts.length < 2) return key;

  const kind = parts[0];

  if (kind === 'user' && parts.length >= 3) {
    const slug = parts[1];
    const metric = parts.slice(2).join(':');
    const mappedMetric = (() => {
      if (metric === 'heart_rate') return 'hr';
      if (metric === 'zone_id') return 'zone';
      if (metric === 'heart_beats') return 'beats';
      if (metric === 'coins_total') return 'coins';
      return metric;
    })();
    return `${slug}:${mappedMetric}`;
  }

  if (kind === 'device' && parts.length >= 3) {
    const rawId = parts[1];
    const id = rawId && rawId.startsWith('device_') ? rawId.slice('device_'.length) : rawId;
    const metric = parts.slice(2).join(':');

    // Equipment metrics use bike:* namespace in persisted data.
    if (metric === 'rpm' || metric === 'rotations' || metric === 'power' || metric === 'distance') {
      return `bike:${id}:${metric}`;
    }

    // Keep wearable metrics as device:* but fix double-prefix bug.
    return `device:${id}:${metric}`;
  }

  return key;
};

/**
 * Map and copy a series dictionary for persistence.
 * @param {Record<string, unknown>} series
 * @returns {Record<string, unknown>}
 */
const mapSeriesKeysForPersist = (series = {}) => {
  const mapped = {};
  if (!series || typeof series !== 'object') return mapped;
  Object.entries(series).forEach(([key, value]) => {
    const nextKey = mapSeriesKeyForPersist(key);
    mapped[nextKey] = value;
  });
  return mapped;
};

/**
 * Strip runtime/UI fields from roster entries before persistence.
 * @param {unknown[]} roster
 * @returns {Array<{name?: string, profileId?: string, hrDeviceId?: string, isPrimary?: boolean, isGuest?: boolean, baseUserName?: string|null}>}
 */
const sanitizeRosterForPersist = (roster) => {
  if (!Array.isArray(roster)) return [];
  return roster
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const name = typeof entry.name === 'string' ? entry.name : null;
      const profileId = entry.profileId != null ? String(entry.profileId) : null;
      const hrDeviceId = entry.hrDeviceId != null ? String(entry.hrDeviceId) : null;
      const isPrimary = entry.isPrimary === true;
      const isGuest = entry.isGuest === true;
      const baseUserName = entry.baseUserName != null ? String(entry.baseUserName) : null;
      if (!name && !profileId && !hrDeviceId) return null;
      return {
        ...(name ? { name } : {}),
        ...(profileId ? { profileId } : {}),
        ...(hrDeviceId ? { hrDeviceId } : {}),
        ...(isPrimary ? { isPrimary } : {}),
        ...(isGuest ? { isGuest } : {}),
        ...(baseUserName ? { baseUserName } : {})
      };
    })
    .filter(Boolean);
};

export class FitnessSession {
  constructor(getTimeoutsFn = getFitnessTimeouts) {
    this._getTimeouts = getTimeoutsFn;
    this.sessionId = null;
    this.startTime = null;
    this.endTime = null;
    this.lastActivityTime = null;
    this.activeDeviceIds = new Set();
    this.eventLog = [];
    this._saveTriggered = false;
    
    // Track users whose data was transferred to another identity (should be excluded from charts)
    this._transferredUsers = new Set();
    this._transferVersion = 0; // Incremented on each transfer to trigger re-renders
    
    // Sub-managers
    this.deviceManager = new DeviceManager();
    this.userManager = new UserManager();
    this.governanceEngine = new GovernanceEngine(this);  // Pass session reference
    this.voiceMemoManager = new VoiceMemoManager(this);
    this.zoneProfileStore = new ZoneProfileStore();
    this.eventJournal = new EventJournal();
    this.treasureBox = null; // Instantiated on start
    
    // Session Entity Registry - tracks participation segments per device assignment
    // Each device assignment creates a new entity with fresh metrics (coins, start time)
    // @see /docs/design/guest-switch-session-transition.md
    this.entityRegistry = new SessionEntityRegistry();
    
    // Activity Monitor - single source of truth for participant status (Phase 2)
    this.activityMonitor = new ActivityMonitor();
    
    // Phase 4: Extracted modules for cleaner separation of concerns
    // These provide focused interfaces while FitnessSession maintains backward compatibility
    this._lifecycle = new SessionLifecycle({
      autosaveIntervalMs: 15000,
      tickIntervalMs: 5000,
      emptySessionTimeoutMs: FITNESS_TIMEOUTS.emptySession
    });
    this._metricsRecorder = new MetricsRecorder({ intervalMs: 5000 });
    this._participantRoster = new ParticipantRoster();
    
    // Phase 5: TimelineRecorder - single responsibility for timeline tick recording
    // Owns: device metrics collection, user metrics, cumulative tracking, dropout detection
    this._timelineRecorder = new TimelineRecorder({ intervalMs: 5000 });
    this._timelineRecorder.setLogCallback((eventName, data) => this._log(eventName, data));
    
    // Phase 5: PersistenceManager - single responsibility for session persistence
    // Owns: validation, encoding, API calls
    this._persistenceManager = new PersistenceManager();
    this._persistenceManager.setLogCallback((eventName, data) => this._log(eventName, data));
    this._persistenceManager.setSeriesLengthValidator((timebase, series) => 
      FitnessTimeline.validateSeriesLengths(timebase, series)
    );

    // Pre-session buffer to avoid ghost sessions from spurious single pings
    this._preSessionBuffer = [];
    this._bufferThresholdMet = false;
    this._preSessionThreshold = 3; // Require N valid HR samples before starting
    this._lastPreSessionLogAt = 0;
    
    // Configure lifecycle callbacks
    this._lifecycle.setCallbacks({
      onTick: (timestamp) => this._collectTimelineTick({ timestamp }),
      onAutosave: () => this._autosave()
    });
    
    this._userCollectionsCache = null;
    this._deviceOwnershipCache = null;
    this._guestCandidatesCache = null;
    this._userZoneProfilesCache = null;
    
    // Device Event Router - central dispatcher for device data payloads
    this._deviceRouter = new DeviceEventRouter();
    this._deviceRouter.setDeviceManager(this.deviceManager);

    // ZoneProfileStore sync scheduling (avoid blocking + queue buildup)
    this._zoneProfileSyncPending = false;
    this._zoneProfileSyncLastScheduledAt = 0;
    this._zoneProfileSyncMinIntervalMs = 1000;
    
    // Legacy: these are now managed by MetricsRecorder but kept for backward compatibility
    // TODO: Remove after full migration to MetricsRecorder
    this._cumulativeBeats = new Map();
    this._cumulativeRotations = new Map();
    
    // Note: Dropout detection now uses ActivityMonitor.getPreviousTickActive() (Priority 6)
    // The _lastTickActiveHR Set has been removed

    // Timer state (legacy - now delegated to SessionLifecycle)
    // Still needed because _collectTimelineTick/_maybeAutosave haven't been fully migrated
    this._autosaveIntervalMs = 15000;
    this._lastAutosaveAt = 0;
    this._autosaveTimer = null;
    this._tickTimer = null;
    this._tickIntervalMs = 5000;
    this._pendingSnapshotRef = null;
    this._chartDebugLogged = { noSeries: false };
    this._ingestDebug = {
      firstAntSeen: false,
      lastAntLogTs: 0
    };
    
    // Ghost session detection - now also in SessionLifecycle but keeping for compatibility
    this._emptyRosterStartTime = null;
    this._isEndingSession = false; // Re-entrancy guard for endSession()
    this._sessionEndedCallbacks = [];

    this.snapshot = {
      participantRoster: [],
      playQueue: [],
      usersMeta: new Map(),
      participantSeries: new Map(),
      deviceSeries: new Map(),
      mediaPlaylists: { video: [], music: [] },
      zoneConfig: null
    };

    this.timebase = {
      startAbsMs: null,
      intervalMs: 5000,
      intervalCount: 0
    };
    this._lastSampleIndex = -1;
    this.timeline = null;
    
    this.screenshots = {
      captures: [],
      intervalMs: null,
      filenamePattern: null
    };
    this._telemetryTickInterval = 12;
    this._lastTelemetrySnapshotTick = -1;
  }

  /**
   * Schedule a ZoneProfileStore sync without blocking updateSnapshot.
   * Throttles to avoid repeated queued work when snapshots arrive frequently.
   *
   * @param {Array<any>} allUsers
   * @returns {boolean} True if a sync was scheduled
   */
  _scheduleZoneProfileSync(allUsers) {
    if (!this.zoneProfileStore) return false;

    const nowMs = Date.now();
    if (this._zoneProfileSyncPending) return false;
    if (nowMs - (this._zoneProfileSyncLastScheduledAt || 0) < (this._zoneProfileSyncMinIntervalMs || 0)) {
      return false;
    }

    this._zoneProfileSyncPending = true;
    this._zoneProfileSyncLastScheduledAt = nowMs;

    const runSync = () => {
      const startedAt = Date.now();
      try {
        this.zoneProfileStore.syncFromUsers(allUsers);
      } catch (err) {
        getLogger().error('fitness.zone_profile_store.sync_failed', {
          message: err?.message || String(err),
          stack: err?.stack || null,
          userCount: Array.isArray(allUsers) ? allUsers.length : null
        });
      } finally {
        this._zoneProfileSyncPending = false;
      }

      const durationMs = Date.now() - startedAt;
      if (durationMs > 200) {
        getLogger().warn('fitness.zone_profile_store.sync_slow', {
          durationMs,
          userCount: Array.isArray(allUsers) ? allUsers.length : null
        });
      }
    };

    // Use requestIdleCallback to avoid blocking the main thread when available.
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(runSync, { timeout: 1000 });
    } else {
      setTimeout(runSync, 0);
    }

    return true;
  }

  /**
   * Get the device event router for external handler registration
   * @returns {DeviceEventRouter}
   */
  getDeviceRouter() {
    return this._deviceRouter;
  }

  /**
   * Register a custom device handler
   * @param {string} type - Payload type (e.g., 'ble_rower', 'ble_treadmill')
   * @param {(payload: any, ctx: Object) => Object|null} handler
   */
  registerDeviceHandler(type, handler) {
    this._deviceRouter.register(type, handler);
  }

  ingestData(payload) {
    if (!payload) return;

    // Route through DeviceEventRouter for all device types
    const result = this._deviceRouter.route(payload);
    
    if (result.handled && result.device) {
      this.recordDeviceActivity(result.device, { rawPayload: payload });
      return result.device;
    }
    
    // For unhandled payload types with deviceId, still try to record activity
    if (!result.handled && payload.deviceId) {
      this.recordDeviceActivity(payload, { rawPayload: payload });
    }
  }

  _log(type, payload = {}) {
    this.eventLog.push({ ts: Date.now(), type, ...payload });
    // MEMORY LEAK FIX: Use splice for in-place mutation instead of slice (new array)
    if (this.eventLog.length > 500) {
      this.eventLog.splice(0, this.eventLog.length - 500);
    }
  }

  recordDeviceActivity(deviceData, { rawPayload = null } = {}) {
    const now = Date.now();
    this.lastActivityTime = now;
    
    // Register/Update device in manager
    const device = this.deviceManager.registerDevice(deviceData);
    if (device) {
      this.activeDeviceIds.add(device.id);
      
      // 5A: Clear cumulative state for newly registered devices to prevent state leakage
      if (device._isNew) {
        this._cumulativeBeats.delete(device.id);
        this._cumulativeRotations.delete(device.id);
        this._log('device_first_seen', { deviceId: device.id, profile: deviceData.profile });
      } else {
        this._log('device_activity', { deviceId: device.id, profile: deviceData.profile });
      }
      // Clear the flag after processing
      device._isNew = false;
      
      // Resolve user and update their stats
      const user = this.userManager.resolveUserForDevice(device.id);
      const resolvedSlug = user?.id || null;
      if (user) {
        // 5A: Check for device reassignment - clear cumulative state if occupant changed
        const currentOccupant = resolvedSlug;
        if (device.lastOccupantSlug && device.lastOccupantSlug !== currentOccupant) {
          this._cumulativeBeats.delete(device.id);
          this._cumulativeRotations.delete(device.id);
          this._log('device_reassigned', { 
            deviceId: device.id, 
            from: device.lastOccupantSlug, 
            to: currentOccupant 
          });
        }
        device.lastOccupantSlug = currentOccupant;
        
        user.updateFromDevice(deviceData);
        // Feed TreasureBox if HR - Phase 2: Use entity-based routing
        if (this.treasureBox && deviceData.type === 'heart_rate') {
          // Check ledger for current occupant (guest may have taken over)
          const ledgerEntry = this.userManager?.assignmentLedger?.get(device.id);
          const currentOccupantId = ledgerEntry?.metadata?.profileId || ledgerEntry?.occupantId || user.id;
          
          // Try to route via entity first (Phase 2), fall back to current occupant
          this.treasureBox.recordHeartRateForDevice(device.id, deviceData.heartRate, {
            profileId: currentOccupantId,
            fallbackUserId: currentOccupantId
          });
        }
      }
      const ledger = this.userManager?.assignmentLedger;
      if (ledger) {
        const ledgerEntry = ledger.get(device.id);
        const userId = user?.id || null;
        
        // Auto-assign device to user if not already assigned (for simulator/auto-mapping)
        if (!ledgerEntry && user && userId) {
          getLogger().warn('fitness.auto_assign', { deviceId: device.id, userName: user.name, userId });
          this.userManager.assignGuest(device.id, user.name, {
            name: user.name,
            profileId: user.id,
            source: user.source || 'auto'
          });
          this._log('device_auto_assigned', { deviceId: device.id, userName: user.name, userId });
        } else if (ledgerEntry) {
          // Already assigned
        } else {
          getLogger().debug('fitness.auto_assign_skip', { deviceId: device.id, hasUser: !!user, hasUserId: !!userId, hasLedgerEntry: !!ledgerEntry });
        }
        
        if (ledgerEntry) {
          if (ledgerEntry.occupantSlug && resolvedSlug && ledgerEntry.occupantSlug !== resolvedSlug) {
            this.eventJournal?.log('LEDGER_DEVICE_MISMATCH', {
              deviceId: device.id,
              ledgerSlug: ledgerEntry.occupantSlug,
              resolvedSlug
            }, { severity: 'warn' });
          }
          if (ledgerEntry.occupantSlug && !resolvedSlug) {
            this.eventJournal?.log('LEDGER_DEVICE_MISSING_USER', {
              deviceId: device.id,
              ledgerSlug: ledgerEntry.occupantSlug
            }, { severity: 'warn' });
          }
        }
      }
    }

    // Use rawPayload for HR detection (deviceData is transformed Device object)
    const bufferCheckPayload = rawPayload || deviceData;
    const startedNow = this._maybeStartSessionFromBuffer(bufferCheckPayload, now);
    if (!this.sessionId) return;
    if (startedNow) this._log('session_started', { sessionId: this.sessionId, reason: 'buffer_threshold_met' });
    this._maybeTickTimeline(deviceData?.timestamp || now);
  }

  setParticipantRoster(roster = [], deviceAssignments = {}) {
    this.userManager.setRoster(roster);
    if (!deviceAssignments || typeof deviceAssignments !== 'object') return;

    const assign = (deviceId, assignment) => {
      if (!deviceId || !assignment) return;
      const name = assignment?.occupantName
        || assignment?.name
        || assignment?.metadata?.name
        || (typeof assignment === 'string' ? assignment : null);
      const metadata = {
        ...(assignment && typeof assignment === 'object' ? assignment : {}),
        name,
        zones: assignment?.zones || assignment?.metadata?.zones || null,
        baseUserName: assignment?.baseUserName || assignment?.metadata?.baseUserName || assignment?.metadata?.base_user_name || null,
        profileId: assignment?.profileId ?? assignment?.metadata?.profileId ?? assignment?.metadata?.profile_id ?? null
      };
      this.userManager.assignGuest(deviceId, name, metadata);
    };

    if (Array.isArray(deviceAssignments)) {
      deviceAssignments.forEach((assignment) => {
        if (!assignment) return;
        const deviceId = assignment.deviceId
          ?? assignment.device_id
          ?? assignment.deviceID
          ?? assignment.device_id_str;
        assign(deviceId, assignment);
      });
      return;
    }

    if (deviceAssignments instanceof Map) {
      deviceAssignments.forEach((assignment, deviceId) => assign(deviceId, assignment));
      return;
    }

    Object.entries(deviceAssignments).forEach(([deviceId, assignment]) => assign(deviceId, assignment));
  }

  /**
   * Create a new session entity for a device assignment.
   * Called when a device is assigned to a user (guest switch, initial assignment, etc.)
   * 
   * @param {Object} options
   * @param {string} options.profileId - User profile ID
   * @param {string} options.name - Display name
   * @param {string} options.deviceId - Heart rate device ID
   * @param {number} [options.startTime] - Optional start time (defaults to now)
   * @returns {import('./SessionEntity.js').SessionEntity}
   * @see /docs/design/guest-switch-session-transition.md
   */
  createSessionEntity({ profileId, name, deviceId, startTime }) {
    const now = startTime || Date.now();
    const entity = this.entityRegistry.create({
      profileId,
      name,
      deviceId,
      startTime: now
    });
    
    getLogger().warn('fitness.entity_creation_diagnostic', {
      entityId: entity.entityId,
      profileId,
      deviceId,
      hasTreasureBox: !!this.treasureBox,
      isActive: this.isActive
    });
    
    if (this.treasureBox) {
      this.treasureBox.initializeEntity(entity.entityId, now);
      // Set this entity as active for the device
      if (deviceId) {
        this.treasureBox.setActiveEntity(deviceId, entity.entityId);
        getLogger().warn('fitness.entity_mapping_set', { deviceId, entityId: entity.entityId });
      }
    } else {
      getLogger().warn('fitness.treasure_box_unavailable', { entityId: entity.entityId });
    }
    
    // Log entity creation
    this.eventJournal?.log('ENTITY_CREATED', {
      entityId: entity.entityId,
      profileId,
      name,
      deviceId,
      startTime: now
    });
    
    return entity;
  }

  /**
   * Get the active session entity for a device
   * @param {string} deviceId
   * @returns {import('./SessionEntity.js').SessionEntity|null}
   */
  getEntityForDevice(deviceId) {
    return this.entityRegistry.getByDevice(deviceId);
  }

  /**
   * End a session entity (mark as dropped/ended)
   * @param {string} entityId
   * @param {Object} options
   * @param {'dropped' | 'ended' | 'transferred'} [options.status='dropped']
   * @param {number} [options.timestamp]
   * @param {string} [options.transferredTo]
   * @param {string} [options.reason]
   */
  endSessionEntity(entityId, options = {}) {
    const entity = this.entityRegistry.get(entityId);
    if (!entity) return;
    
    this.entityRegistry.endEntity(entityId, options);
    
    // Log entity end
    this.eventJournal?.log(options.status === 'transferred' ? 'ENTITY_TRANSFERRED' : 'ENTITY_DROPPED', {
      entityId,
      profileId: entity.profileId,
      name: entity.name,
      deviceId: entity.deviceId,
      durationMs: entity.durationMs,
      finalCoins: entity.coins,
      status: entity.status,
      transferredTo: options.transferredTo || null
    });
  }

  /**
   * Phase 4: Transfer session data from one entity to another.
   * Used during grace period transfers when a brief session is merged into successor.
   * 
   * Transfers:
   * - TreasureBox accumulator (coins, zone state)
   * - Timeline series data (heart_rate, coins_total, zone_id)
   * - Marks source entity as 'transferred'
   * 
   * @param {string} fromEntityId - Source entity ID (being transferred)
   * @param {string} toEntityId - Destination entity ID (receiving transfer)
   * @returns {{ ok: boolean, coinsTransferred?: number, seriesTransferred?: Array, error?: string }}
   * @see /docs/design/guest-switch-session-transition.md
   */
  transferSessionEntity(fromEntityId, toEntityId) {
    if (!fromEntityId || !toEntityId || fromEntityId === toEntityId) {
      return { ok: false, error: 'Invalid entity IDs for transfer' };
    }
    
    const fromEntity = this.entityRegistry.get(fromEntityId);
    const toEntity = this.entityRegistry.get(toEntityId);
    
    if (!fromEntity) {
      return { ok: false, error: `Source entity not found: ${fromEntityId}` };
    }
    if (!toEntity) {
      return { ok: false, error: `Destination entity not found: ${toEntityId}` };
    }
    
    const now = Date.now();
    let coinsTransferred = 0;
    let seriesTransferred = [];
    
    // 1. Transfer TreasureBox accumulator (coins, zone state)
    if (this.treasureBox) {
      const transferred = this.treasureBox.transferAccumulator(fromEntityId, toEntityId);
      if (transferred) {
        coinsTransferred = fromEntity.coins || 0;
        // Update destination entity's coin count
        const toAcc = this.treasureBox.perUser.get(toEntityId);
        if (toAcc) {
          toEntity.setCoins(toAcc.totalCoins || 0);
        }
      }
    }
    
    // 2. Transfer timeline series (heart_rate, coins_total, zone_id, etc.)
    if (this.timeline) {
      const transferred = this.timeline.transferEntitySeries(fromEntityId, toEntityId);
      seriesTransferred = transferred;
    }

    // 2.1 Transfer activity history (Phase 2)
    if (this.activityMonitor) {
      this.activityMonitor.transferActivity(fromEntityId, toEntityId);
    }

    // 2.2 Transfer cumulative metrics (Phase 4)
    if (this._metricsRecorder) {
      this._metricsRecorder.transferCumulativeMetrics(fromEntityId, toEntityId);
    }
    
    // 3. Mark source entity as transferred (with reference to destination)
    this.entityRegistry.endEntity(fromEntityId, {
      status: 'transferred',
      timestamp: now,
      transferredTo: toEntityId,
      reason: 'grace_period_transfer'
    });

    // Also mark as transferred for chart filtering
    this.markUserAsTransferred(fromEntityId);
    
    // 4. Update destination entity's start time to match source (already done in createSessionEntity)
    // This ensures the new participant "inherits" the session start time
    
    // 5. Log the transfer event
    this.eventJournal?.log('ENTITY_TRANSFERRED', {
      fromEntityId,
      toEntityId,
      fromProfileId: fromEntity.profileId,
      toProfileId: toEntity.profileId,
      coinsTransferred,
      seriesTransferred: seriesTransferred.length,
      durationMs: fromEntity.durationMs,
      timestamp: now
    });
    
    console.log('[FitnessSession] Entity transfer complete:', {
      from: fromEntityId,
      to: toEntityId,
      coinsTransferred,
      seriesCount: seriesTransferred.length
    });
    
    return {
      ok: true,
      coinsTransferred,
      seriesTransferred
    };
  }

  /**
   * Transfer all session data from one user ID to another.
   * Used during grace period transfers when a user is replaced by a guest (or vice versa)
   * and we want to maintain a continuous line on the chart.
   * 
   * @param {string} fromUserId - Source user ID
   * @param {string} toUserId - Destination user ID
   * @returns {Object} Transfer results
   */
  transferUserSeries(fromUserId, toUserId) {
    if (!fromUserId || !toUserId || fromUserId === toUserId) {
      return { ok: false, error: 'Invalid user IDs for transfer' };
    }

    console.log('[FitnessSession] Orchestrating user series transfer:', { fromUserId, toUserId });

    // 1. Transfer timeline history
    let seriesTransferred = [];
    if (this.timeline) {
      seriesTransferred = this.timeline.transferUserSeries(fromUserId, toUserId);
    }

    // 2. Transfer TreasureBox accumulator
    let coinsTransferred = 0;
    if (this.treasureBox) {
      const transferred = this.treasureBox.transferAccumulator(fromUserId, toUserId);
      if (transferred) {
        const toAcc = this.treasureBox.perUser.get(toUserId);
        coinsTransferred = toAcc?.totalCoins || 0;
      }
    }

    // 3. Transfer activity history
    if (this.activityMonitor) {
      this.activityMonitor.transferActivity(fromUserId, toUserId);
    }

    // 4. Transfer cumulative metrics
    if (this._metricsRecorder) {
      this._metricsRecorder.transferCumulativeMetrics(fromUserId, toUserId);
    }

    // 5. Mark source user as transferred
    this.markUserAsTransferred(fromUserId);

    return {
      ok: true,
      coinsTransferred,
      seriesTransferred: seriesTransferred.length
    };
  }

  /**
   * Phase 3: Get all entities for a profile ID.
   * A profile can have multiple entities (if they leave and rejoin, or use different devices).
   * 
   * @param {string} profileId - Profile ID to query
   * @returns {Array<import('./SessionEntity.js').SessionEntity>}
   */
  getEntitiesForProfile(profileId) {
    if (!profileId) return [];
    return this.entityRegistry.getByProfile(profileId);
  }

  /**
   * Phase 3: Get aggregated coin total for a profile across all their entities.
   * Excludes transferred entities (their coins were merged into successor).
   * 
   * @param {string} profileId - Profile ID to aggregate
   * @returns {number} Total coins across all non-transferred entities
   */
  getProfileCoinsTotal(profileId) {
    if (!profileId) return 0;
    const entities = this.getEntitiesForProfile(profileId);
    return entities.reduce((total, entity) => {
      // Exclude transferred entities - their coins went to successor
      if (entity.status === 'transferred') return total;
      return total + (entity.coins || 0);
    }, 0);
  }

  /**
   * Phase 3: Get aggregated timeline series for a profile.
   * Combines entity series data for profile-level display.
   * 
   * @param {string} profileId - Profile ID
   * @param {string} metric - Metric name (e.g., 'coins_total')
   * @returns {number[]} Aggregated series
   */
  getProfileTimelineSeries(profileId, metric) {
    if (!profileId || !metric || !this.timeline) return [];
    
    const entities = this.getEntitiesForProfile(profileId);
    if (entities.length === 0) return [];
    
    // For a single entity, just return its series
    if (entities.length === 1) {
      const entity = entities[0];
      return this.timeline.getEntitySeries(entity.entityId, metric);
    }
    
    // For multiple entities, aggregate based on metric type
    // For coins_total, sum across active entities at each tick
    // Note: This is a simplified aggregation - more complex logic may be needed
    const allSeries = entities
      .filter(e => e.status !== 'transferred')
      .map(e => this.timeline.getEntitySeries(e.entityId, metric));
    
    if (allSeries.length === 0) return [];
    if (allSeries.length === 1) return allSeries[0];
    
    // Find max length
    const maxLen = Math.max(...allSeries.map(s => s.length));
    const aggregated = new Array(maxLen).fill(0);
    
    // Sum values at each tick (for coins_total) or use latest (for heart_rate)
    for (let i = 0; i < maxLen; i++) {
      for (const series of allSeries) {
        const val = series[i];
        if (Number.isFinite(val)) {
          aggregated[i] += val;
        }
      }
    }
    
    return aggregated;
  }

  setEquipmentCatalog(equipmentList = []) {
    // Delegate to DeviceEventRouter for unified equipment lookups
    this._deviceRouter.setEquipmentCatalog(equipmentList);
  }

  _isValidPreSessionSample(payload) {
    if (!payload) return false;
    // Check profile from multiple possible locations
    const profileRaw = payload.profile || payload.type || payload.data?.profile;
    const profile = typeof profileRaw === 'string' ? profileRaw.trim().toLowerCase() : profileRaw;
    const isHeartRate = profile === 'heart_rate' || profile === 'hr';
    if (!isHeartRate) return false;
    // Extract HR from raw ANT+ payload structure or device object
    const hrValue = Number(
      payload.data?.heartRate ??
      payload.data?.heart_rate ??
      payload.data?.ComputedHeartRate ??
      payload.data?.computedHeartRate ??
      payload.heartRate ??
      payload.heart_rate ??
      payload.currentHeartRate ??
      0
    );
    const isValid = Number.isFinite(hrValue) && hrValue > 0;
    if (!isValid && this._preSessionBuffer.length === 0) {
      this._log('pre_session_sample_invalid', {
        profile,
        hrValue,
        payloadKeys: Object.keys(payload || {}),
        dataKeys: Object.keys(payload?.data || {}),
        hasComputedHR: payload?.data?.ComputedHeartRate != null || payload?.data?.computedHeartRate != null,
        hasRawHR: payload?.data?.heartRate != null || payload?.data?.heart_rate != null
      });
    }
    return isValid;
  }

  _maybeStartSessionFromBuffer(deviceData, timestamp) {
    if (this.sessionId) return false;
    const eligible = this._isValidPreSessionSample(deviceData);
    if (eligible) {
      this._preSessionBuffer.push({ ...deviceData, timestamp });
    } else if (!eligible && this._preSessionBuffer.length === 0) {
      // Log why sample was rejected (throttled to avoid spam)
      if (!this._lastRejectionLogAt || (timestamp - this._lastRejectionLogAt) > 3000) {
        this._lastRejectionLogAt = timestamp;
        getLogger().debug('fitness.session.buffer.rejected', {
          deviceId: deviceData?.deviceId || deviceData?.id,
          profile: deviceData?.profile || deviceData?.type,
          hasData: !!deviceData?.data,
          dataKeys: deviceData?.data ? Object.keys(deviceData.data) : [],
          hasComputedHR: deviceData?.data?.ComputedHeartRate != null,
          hasHeartRate: deviceData?.heartRate != null || deviceData?.heart_rate != null
        });
      }
    }
    const count = this._preSessionBuffer.length;
    const remaining = Math.max(0, (this._preSessionThreshold || 3) - count);
    const shouldStart = count >= (this._preSessionThreshold || 3);

    // Throttle logging to avoid spam while waiting for threshold
    if (!shouldStart) {
      if (timestamp - this._lastPreSessionLogAt > 5000) {
        this._log('pre_session_buffer', {
          eligible,
          bufferedCount: count,
          remaining,
          threshold: this._preSessionThreshold || 3,
          lastHr: deviceData?.heartRate
            || deviceData?.heart_rate
            || deviceData?.data?.heartRate
            || deviceData?.data?.heart_rate
            || deviceData?.data?.ComputedHeartRate
            || null,
          profile: deviceData?.profile || deviceData?.type || deviceData?.data?.profile || null
        });
        this._lastPreSessionLogAt = timestamp;
      }
      return false;
    }

    this._bufferThresholdMet = true;
    getLogger().warn('fitness.session.buffer.threshold_met', {
      bufferedCount: count,
      threshold: this._preSessionThreshold || 3,
      firstIds: this._preSessionBuffer.slice(0, 3).map((s) => s?.deviceId || s?.id || null)
    });
    const started = this.ensureStarted({ reason: 'buffer_threshold_met' });
    this._bufferThresholdMet = false;
    this._preSessionBuffer = [];
    return started;
  }

  // Phase 4: Expose extracted module interfaces for direct access
  // These provide focused, testable interfaces while maintaining backward compatibility
  
  /**
   * Get the SessionLifecycle module
   * @returns {SessionLifecycle}
   */
  get lifecycle() {
    return this._lifecycle;
  }

  /**
   * Get the MetricsRecorder module
   * @returns {MetricsRecorder}
   */
  get metricsRecorder() {
    return this._metricsRecorder;
  }

  /**
   * Get the ParticipantRoster module
   * @returns {ParticipantRoster}
   */
  get participantRoster() {
    return this._participantRoster;
  }

  /**
   * Get active participants (uses ParticipantRoster)
   * @returns {import('./ParticipantRoster.js').RosterEntry[]}
   */
  getActiveParticipants() {
    return this._participantRoster.getActive();
  }

  /**
   * Get inactive participants (uses ParticipantRoster)
   * @returns {import('./ParticipantRoster.js').RosterEntry[]}
   */
  getInactiveParticipants() {
    return this._participantRoster.getInactive();
  }

  /**
   * Get all participants with status (uses ParticipantRoster)
   * @returns {import('./ParticipantRoster.js').RosterEntry[]}
   */
  getAllParticipantsWithStatus() {
    return this._participantRoster.getAllWithStatus();
  }

  get roster() {
    // Delegate to ParticipantRoster but maintain backward compatibility
    // If ParticipantRoster is configured, use it; otherwise fall back to original logic
    if (this._participantRoster && this._participantRoster._deviceManager) {
      return this._participantRoster.getRoster();
    }
    
    // Original roster implementation (backward compatibility during migration)
    const roster = [];
    const heartRateDevices = this.deviceManager.getAllDevices().filter(d => d.type === 'heart_rate');
    const zoneLookup = new Map();
    const zoneSnapshot = typeof this.treasureBox?.getUserZoneSnapshot === 'function'
      ? this.treasureBox.getUserZoneSnapshot()
      : [];
    zoneSnapshot.forEach((entry) => {
      if (!entry || !entry.userId) return;
      // Use userId as the key
      zoneLookup.set(entry.userId, {
        zoneId: entry.zoneId ? String(entry.zoneId).toLowerCase() : null,
        color: entry.color || null
      });
    });

    heartRateDevices.forEach((device) => {
      if (!device || device.id == null) return;
      const deviceId = String(device.id);
      const heartRate = Number.isFinite(device.heartRate) ? Math.round(device.heartRate) : null;
      const guestEntry = this.userManager?.assignmentLedger?.get?.(deviceId) || null;
      const ledgerName = guestEntry?.occupantName || guestEntry?.metadata?.name || null;
      const mappedUser = this.userManager.resolveUserForDevice(deviceId);
      const participantName = ledgerName || mappedUser?.name;
      if (!participantName) return;

      // Use user ID for zone lookup
      const userId = mappedUser?.id || guestEntry?.occupantId || guestEntry?.metadata?.profileId;
      const zoneInfo = zoneLookup.get(userId) || null;
      const fallbackZoneId = mappedUser?.currentData?.zone || null;
      const fallbackZoneColor = mappedUser?.currentData?.color || null;

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

      roster.push({
        name: participantName,
        displayLabel,
        groupLabel: isGuest ? null : mappedUser?.groupLabel || null,
        profileId: mappedUser?.id || userId || deviceId,
        baseUserName,
        isGuest,
        hrDeviceId: deviceId,
        heartRate: resolvedHeartRate,
        zoneId: zoneInfo?.zoneId || fallbackZoneId || null,
        zoneColor: zoneInfo?.color || fallbackZoneColor || null,
        avatarUrl: isGuest ? null : mappedUser?.avatarUrl || null,
        isActive: true // Legacy fallback: assume active if in heartRateDevices
      });
    });

    return roster;
  }

  /**
   * Returns all unique participant slugs that have historical data in the session,
   * including users who have left. Used for chart persistence across remounts.
   * Fix 9 (bugbash 1B): Normalizes slugs to prevent whitespace-only entries.
   * @returns {string[]} Array of participant slug IDs
   */
  getHistoricalParticipants() {
    const participants = new Set();
    
    // Fix 9: Helper to validate and normalize slugs
    // Also exclude transferred users (their data was moved to another identity)
    const addIfValid = (slug) => {
      if (typeof slug === 'string') {
        const normalized = slug.trim();
        if (normalized && !this._transferredUsers?.has(normalized)) {
          participants.add(normalized);
        }
      }
    };
    
    // Get from snapshot participantSeries (legacy storage)
    if (this.snapshot?.participantSeries instanceof Map) {
      this.snapshot.participantSeries.forEach((_, slug) => {
        addIfValid(slug);
      });
    }
    
    // Get from timeline if available
    if (this.timeline?.getAllParticipantIds) {
      const timelineIds = this.timeline.getAllParticipantIds();
      timelineIds.forEach((id) => {
        addIfValid(id);
      });
    }
    
    // Get from usersMeta
    if (this.snapshot?.usersMeta instanceof Map) {
      this.snapshot.usersMeta.forEach((_, slug) => {
        addIfValid(slug);
      });
    }
    
    return Array.from(participants);
  }

  /**
   * Get the set of user IDs whose data was transferred to another identity.
   * These users should be excluded from charts/UI as their data now belongs to someone else.
   * @returns {Set<string>}
   */
  getTransferredUsers() {
    return this._transferredUsers || new Set();
  }

  /**
   * Mark a user as transferred (grace period substitution).
   * Increments transferVersion to trigger re-renders in UI.
   * @param {string} userId - ID of the user who was replaced
   */
  markUserAsTransferred(userId) {
    if (!userId) return;
    if (!this._transferredUsers) this._transferredUsers = new Set();
    this._transferredUsers.add(userId);
    this._transferVersion = (this._transferVersion || 0) + 1;
    this._log('user_transferred', { userId, version: this._transferVersion });
  }

  /**
   * Get the transfer version counter. Used to trigger re-renders when transfers happen.
   * @returns {number}
   */
  getTransferVersion() {
    return this._transferVersion || 0;
  }

  _resolveEquipmentId(device) {
    if (!device) return null;
    const explicit = device.equipmentId || device.equipment_id || device?.metadata?.equipmentId;
    if (explicit) return String(explicit).trim();
    const cadence = device.cadence ?? device.deviceCadence ?? device.id;
    const cadenceKey = cadence == null ? null : String(cadence).trim();
    if (cadenceKey && this._equipmentIdByCadence?.has(cadenceKey)) {
      return this._equipmentIdByCadence.get(cadenceKey);
    }
    // Use device id directly if available, otherwise fall back to name
    const name = device.name || device.label || null;
    if (device.id) return String(device.id);
    if (name) return String(name);
    if (cadenceKey) return cadenceKey;
    return null;
  }

  ensureStarted(options = {}) {
    const { force = false, reason = 'unknown' } = options;
    if (this.sessionId) return false;
    if (!force && !this._bufferThresholdMet) {
      this._log('ensure_started_blocked', { reason: 'pre_session_threshold_not_met', requestReason: reason });
      return false;
    }
    const nowDate = new Date();
    const now = nowDate.getTime();
    this.sessionTimestamp = formatSessionId(nowDate);
    this.sessionId = `fs_${this.sessionTimestamp}`;
    this.startTime = now;
    this.lastActivityTime = now;
    this.endTime = null;
    
    // DEBUG: Log session start with stack trace (throttled: first 5 only)
    if ((this._debugStartCount = (this._debugStartCount || 0) + 1) <= 5) {
      const stack = new Error().stack?.split('\n').slice(1, 6).map(s => s.trim()).join(' <- ');
      console.error(`🟢 SESSION_START [${this._debugStartCount}/5]: ${this.sessionId}, reason="${reason}"`, { stack });
    }

    getLogger().warn('fitness.session.started', {
      sessionId: this.sessionId,
      reason,
      timestamp: now
    });
    this.timebase.startAbsMs = now;
    this.timebase.intervalCount = 0;
    this.timebase.intervalMs = this.timebase.intervalMs || 5000;
    this._lastSampleIndex = -1;
    this.timeline = new FitnessTimeline(now, this.timebase.intervalMs);
    this._tickIntervalMs = this.timeline.timebase.intervalMs;
    this.timebase.intervalMs = this.timeline.timebase.intervalMs;
    this.timebase.startAbsMs = this.timeline.timebase.startTime;
    this._pendingSnapshotRef = null;
    
    // Reset ActivityMonitor for new session (Phase 2 - centralized activity tracking)
    this.activityMonitor.reset(now);
    this.activityMonitor.configure({
      tickIntervalMs: this.timebase.intervalMs,
      // Convert ms timeouts to tick counts
      idleThresholdTicks: 2, // ~10 seconds at 5s intervals
      removeThresholdTicks: Math.ceil((this._getTimeouts().remove || 180000) / this.timebase.intervalMs)
    });
    
    // Phase 4: Configure extracted modules for new session
    this._metricsRecorder.setInterval(this.timebase.intervalMs);
    this._metricsRecorder.reset();
    this._metricsRecorder.setLogCallback((type, data) => this._log(type, data));
    
    // Phase 5: Configure TimelineRecorder with dependencies
    this._timelineRecorder.reset();
    this._timelineRecorder.setInterval(this.timebase.intervalMs);
    this._timelineRecorder.setTimeline(this.timeline);
    this._timelineRecorder.configure({
      deviceManager: this.deviceManager,
      userManager: this.userManager,
      treasureBox: this.treasureBox,
      timeline: this.timeline,
      activityMonitor: this.activityMonitor,
      eventJournal: this.eventJournal,
      resolveEquipmentId: (device) => this._resolveEquipmentId(device)
    });
    
    this._participantRoster.reset();
    this._participantRoster.configure({
      deviceManager: this.deviceManager,
      userManager: this.userManager,
      treasureBox: this.treasureBox,
      activityMonitor: this.activityMonitor,
      timeline: this.timeline
    });
    
    // Reset snapshot structures
    this.snapshot.participantSeries = new Map();
    this.snapshot.deviceSeries = new Map();
    this.snapshot.usersMeta = new Map();
    this.snapshot.playQueue = [];
    this.snapshot.mediaPlaylists = { video: [], music: [] };
    this.snapshot.zoneConfig = null;
    this.screenshots.captures = [];
    
    this._log('start', { sessionId: this.sessionId, reason });
    
    if (!this.treasureBox) {
      this.treasureBox = new FitnessTreasureBox(this);
      // Inject ActivityMonitor for activity-aware coin processing (Priority 2)
      this.treasureBox.setActivityMonitor(this.activityMonitor);

      // BUGFIX: Configure TreasureBox with zones immediately after creation
      // Previously, this was only done in FitnessContext React effect which
      // could miss if TreasureBox was created after the effect ran
      const baseZoneConfig = this.zoneProfileStore?.getBaseZoneConfig();
      if (baseZoneConfig && baseZoneConfig.length > 0) {
        this.treasureBox.configure({
          zones: baseZoneConfig
        });
        this._log('treasurebox_zones_from_store', {
          zoneCount: baseZoneConfig.length,
          zoneIds: baseZoneConfig.map(z => z.id)
        });
      } else {
        // DIAGNOSTIC: Log when no zones available at session start
        this._log('treasurebox_no_zones_at_start', {
          hasZoneProfileStore: !!this.zoneProfileStore,
          baseZoneConfigLength: baseZoneConfig?.length ?? 0
        }, 'warn');
      }

      // Ensure governance callback is wired even when TreasureBox is lazily created
      if (this.governanceEngine) {
        this.treasureBox.setGovernanceCallback(() => {
          this.governanceEngine._evaluateFromTreasureBox();
        });
      }
    }
    
    // Update ParticipantRoster with treasureBox reference after creation
    this._participantRoster.configure({ treasureBox: this.treasureBox });
    
    // Update TimelineRecorder with treasureBox reference after creation
    this._timelineRecorder.setTreasureBox(this.treasureBox);
    
    this._lastAutosaveAt = 0;
    this._startAutosaveTimer();
    this._startTickTimer();
    this._cumulativeBeats = new Map();
    this._cumulativeRotations = new Map();
    this._emptyRosterStartTime = null; // 6A: Reset empty roster tracking on session start
    this._collectTimelineTick({ timestamp: now });
    return true;
  }

  updateSnapshot({
    users, // Map of user objects (legacy/external)
    devices, // Map of devices (legacy/external)
    playQueue,
    participantRoster,
    zoneConfig,
    mediaPlaylists,
    screenshotPlan
  } = {}) {
    if (!this.sessionId) return;

    if (!this.timebase.startAbsMs) {
      this.timebase.startAbsMs = this.startTime || Date.now();
    }

    const intervalMs = this.treasureBox?.coinTimeUnitMs || this.timebase.intervalMs || 5000;
    this.timebase.intervalMs = intervalMs;
    if (this.timeline) {
      this.timeline.setIntervalMs(intervalMs);
      this._tickIntervalMs = intervalMs;
      this._startTickTimer();
    }
    const now = Date.now();
    const elapsed = this.timebase.startAbsMs ? Math.max(0, now - this.timebase.startAbsMs) : 0;
    const intervalIndex = intervalMs > 0 ? Math.floor(elapsed / intervalMs) : 0;

    this._lastSampleIndex = Math.max(this._lastSampleIndex, intervalIndex);
    if (intervalIndex + 1 > this.timebase.intervalCount) {
      this.timebase.intervalCount = intervalIndex + 1;
    }

    // Sync roster
    if (Array.isArray(participantRoster)) {
      this.snapshot.participantRoster = participantRoster.map((entry) => ({ ...entry }));
      this.userManager.setRoster(participantRoster);
    }

    if (zoneConfig) {
      this.zoneProfileStore?.setBaseZoneConfig(zoneConfig);

      // BUGFIX: Also configure TreasureBox with zones
      // This ensures zones are set even if TreasureBox was created after initial config
      if (this.treasureBox) {
        this.treasureBox.configure({ zones: zoneConfig });
        this._log('treasurebox_zones_from_snapshot', {
          zoneCount: zoneConfig.length,
          zoneIds: zoneConfig.map(z => z.id)
        });
      }
    }

    // Process Users (from UserManager)
    const allUsers = this.userManager.getAllUsers();
    allUsers.forEach(user => {
        const userId = user.id;
        this.snapshot.usersMeta.set(userId, {
          name: user.name,
          displayName: user.name, // Could resolve display label
          age: user.age,
          hrDeviceId: user.hrDeviceId,
          cadenceDeviceId: user.cadenceDeviceId
        });
        
        const hrValueRaw = Number.isFinite(user?.currentData?.heartRate)
          ? user.currentData.heartRate
          : Number.isFinite(user?.currentHeartRate)
            ? user.currentHeartRate
            : 0;
        const hrValue = Math.max(0, Math.round(hrValueRaw || 0));
        user.currentHeartRate = hrValue; // legacy compatibility

        const series = this.snapshot.participantSeries.get(userId) || [];

        // CRITICAL DEBUG: Check if intervalIndex is reasonable
        if (intervalIndex > 100000) {
          getLogger().error('🚨 CRITICAL: intervalIndex TOO LARGE', {
            intervalIndex,
            intervalMs,
            elapsed,
            startAbsMs: this.timebase.startAbsMs,
            now,
            userId
          });
          // Skip this user to prevent hang
          return;
        }

        ensureSeriesCapacity(series, intervalIndex);
        series[intervalIndex] = hrValue > 0 ? hrValue : null;
        
        // MEMORY LEAK FIX: Prune old data from participantSeries to prevent unbounded growth
        // Keep at most 2000 points (~2.7 hours at 5-second intervals)
        const MAX_SNAPSHOT_SERIES_LENGTH = 2000;
        if (series.length > MAX_SNAPSHOT_SERIES_LENGTH) {
          const removeCount = series.length - MAX_SNAPSHOT_SERIES_LENGTH;
          series.splice(0, removeCount);
        }
        
        this.snapshot.participantSeries.set(userId, series);
      });

    this._scheduleZoneProfileSync(allUsers);

    // Process Devices (from DeviceManager)
    const allDevices = this.deviceManager.getAllDevices();
    allDevices.forEach(device => {
        const idStr = String(device.id);
        let record = this.snapshot.deviceSeries.get(idStr);
        if (!record) {
            record = {
                id: idStr,
                type: 'unknown', // DeviceManager needs to store type/profile better or we infer it
                label: device.name,
                rpmSeries: [],
                powerSeries: [],
                speedSeries: [],
                heartRateSeries: []
            };
            this.snapshot.deviceSeries.set(idStr, record);
        }
        // Note: DeviceManager generic Device class might not have specific fields like 'cadence' directly on root
        // We might need to store rawData or specific fields in DeviceManager.
        // For now, assuming DeviceManager stores these properties if updated via recordDeviceActivity
        
        // ... (Logic to populate series from device properties)
    });

    // ... (Rest of snapshot update logic: playQueue, mediaPlaylists, etc. - similar to original)
    if (Array.isArray(playQueue)) {
        this.snapshot.playQueue = deepClone(playQueue);
        // ... map to mediaPlaylists
    }
    
    if (zoneConfig) {
      this.snapshot.zoneConfig = deepClone(zoneConfig);
    }

    this._maybeAutosave();
    this._userCollectionsCache = this.userManager.getUserCollections();
    this._deviceOwnershipCache = this.userManager.getDeviceOwnership();
    this._guestCandidatesCache = this.userManager.getGuestCandidates();
    this._userZoneProfilesCache = this.zoneProfileStore
      ? this.zoneProfileStore.getProfileMap()
      : this.userManager.getUserZoneProfiles();

    // Run Governance Evaluation
    // IMPORTANT: Break the feedback loop. 
    // The UI (FitnessContext) passes participantRoster based on session.roster.
    // If we use participantRoster exclusively, and it's stale/empty, the engine resets,
    // which stops pulses, which stops UI updates, keeping the roster empty.
    // SOLUTION: Merge the passed-in roster with our internal session.roster 
    // to ensure we always use the most up-to-date local data available.
    const sessionRoster = this.roster || [];
    const uiRoster = Array.isArray(participantRoster) ? participantRoster : [];
    
    // Create a combined roster, prioritizing UI-provided entries if they match by ID/name
    const effectiveRosterMap = new Map();
    sessionRoster.forEach(entry => {
        if (entry.name) effectiveRosterMap.set(entry.name.toLowerCase(), entry);
    });
    uiRoster.forEach(entry => {
        if (entry.name) effectiveRosterMap.set(entry.name.toLowerCase(), entry);
    });
    const effectiveRoster = Array.from(effectiveRosterMap.values());

    // Use userId/entityId as stable identifiers (no case issues)
    const activeParticipants = effectiveRoster
        .filter((entry) => {
          const isActive = entry.isActive !== false;
          return isActive && (entry.id || entry.profileId);
        })
        .map(entry => entry.id || entry.profileId);  // Use ID, not name!

    // Key by userId/entityId (stable, no case issues)
    const userZoneMap = {};
    effectiveRoster.forEach(entry => {
        const userId = entry.id || entry.profileId;
        if (userId) {
            userZoneMap[userId] = entry.zoneId || null;
        }
    });
    
    // We need zoneRankMap and zoneInfoMap from somewhere (likely computed from zoneConfig)
    // For now, passing empty maps if not available, or we compute them here
    const zoneRankMap = {};
    const zoneInfoMap = {};
    if (this.snapshot.zoneConfig) {
        this.snapshot.zoneConfig.forEach((z, idx) => {
            const zid = String(z.id || z.name).toLowerCase();
            zoneRankMap[zid] = idx;
            zoneInfoMap[zid] = z;
        });
    }

    this.governanceEngine.evaluate({
        activeParticipants,
        userZoneMap,
        zoneRankMap,
        zoneInfoMap,
        totalCount: activeParticipants.length
    });
  }

  /**
   * Collect timeline tick - DELEGATED to TimelineRecorder.
   * 
   * Phase 5 refactoring: This method now delegates to TimelineRecorder
   * which owns all timeline metric recording, cumulative tracking, and
   * dropout detection logic.
   * 
   * @param {Object} params
   * @param {number} [params.timestamp] - Tick timestamp
   * @returns {Object|null} - Tick result from timeline
   */
  _collectTimelineTick({ timestamp } = {}) {
    if (!this.timeline || !this.sessionId) return null;

    // Delegate to TimelineRecorder
    const tickResult = this._timelineRecorder.recordTick({
      timestamp,
      sessionId: this.sessionId,
      roster: this.roster
    });

    // Update FitnessSession state from timeline (for backward compatibility)
    if (this.timeline?.timebase) {
      this.timebase.intervalCount = this.timeline.timebase.tickCount;
      this.timebase.intervalMs = this.timeline.timebase.intervalMs;
      this.timebase.startAbsMs = this.timeline.timebase.startTime;
      this.timebase.lastTickTimestamp = this.timeline.timebase.lastTickTimestamp;
    }

    // Sync cumulative trackers for backward compatibility
    // TODO: Remove once all consumers use TimelineRecorder directly
    this._cumulativeBeats = this._timelineRecorder.getAllCumulativeBeats();
    this._cumulativeRotations = this._timelineRecorder.getAllCumulativeRotations();

    // Telemetry logging
    this._maybeLogTimelineTelemetry();

    // Empty roster timeout check (6A)
    this._checkEmptyRosterTimeout();

    return tickResult;
  }
  
  // NOTE: The following ~375 lines of inline _collectTimelineTick code were
  // extracted to TimelineRecorder.js as part of Phase 5 refactoring.
  // See: /docs/postmortem-entityid-migration-fitnessapp.md #13

  /**
   * DEBUG: Log timeline series for dropout detection debugging
   * Logs to both console AND emits a debug event for backend visibility
   */
  _logTimelineDebug(tickIndex, activeHRSet) {
    if (!this.timeline?.series) return;
    
    const userSeries = {};
    const seriesKeys = Object.keys(this.timeline.series);
    
    // Find all user heart_rate series
    seriesKeys.forEach(key => {
      if (key.startsWith('user:') && key.endsWith(':heart_rate')) {
        const slug = key.replace('user:', '').replace(':heart_rate', '');
        const hrSeries = this.timeline.series[key] || [];
        const beatsSeries = this.timeline.series[`user:${slug}:heart_beats`] || [];
        const coinsSeries = this.timeline.series[`user:${slug}:coins_total`] || [];
        
        // Count nulls in heart_rate
        const nullCount = hrSeries.filter(v => v === null).length;
        const validCount = hrSeries.filter(v => v !== null && Number.isFinite(v) && v > 0).length;
        
        // Get last 10 values for inspection
        const lastHR = hrSeries.slice(-10);
        const lastBeats = beatsSeries.slice(-10).map(v => v?.toFixed?.(1) ?? v);
        const lastCoins = coinsSeries.slice(-10).map(v => v?.toFixed?.(1) ?? v);
        
        userSeries[slug] = {
          hrLength: hrSeries.length,
          nullCount,
          validCount,
          lastHR,
          lastBeats,
          lastCoins, // Add coins_total for debugging
          isActiveNow: activeHRSet.has(slug)
        };
      }
    });
    
    const debugData = {
      tick: tickIndex,
      totalSeries: seriesKeys.length,
      lastTickActiveHR: [...(this.activityMonitor?.getPreviousTickActive() || [])],
      currentTickActiveHR: [...activeHRSet],
      userSeries
    };
    
    // Log to console
 //   console.log(`[Timeline DEBUG] Tick ${tickIndex}`, debugData);
    
    // Also emit as event for backend visibility (will show in dev.log)
    this._log('timeline-debug', debugData);
  }

  // ... (Rest of methods: updateActiveDevices, maybeEnd, _persistSession, autosave, voice memos, summary)
  // I will include the essential ones for session lifecycle.

  updateActiveDevices() {
    const timeouts = this._getTimeouts();
    const { remove } = timeouts;
    const now = Date.now();
    const stillActive = new Set();
    
    // Prune DeviceManager
    this.deviceManager.pruneStaleDevices(timeouts);
    
    // Re-check active set
    const allDevices = this.deviceManager.getAllDevices();
    allDevices.forEach(d => {
        if (now - d.lastSeen <= remove) {
            stillActive.add(d.id);
        }
    });
    
    this.activeDeviceIds = stillActive;
    if (this.activeDeviceIds.size === 0) {
      this.maybeEnd();
    }
  }

  maybeEnd() {
    if (!this.sessionId || this.endTime) return false;
    const { remove } = this._getTimeouts();
    const now = Date.now();
    if (!this.lastActivityTime || (now - this.lastActivityTime) < remove) return false;
    
    return this.endSession('inactivity');
  }

  /**
   * 6A: Explicitly end the session with a reason.
   * Clears timers, flushes data, emits events, and resets state.
   * @param {string} reason - Why the session is ending (e.g., 'empty_roster', 'inactivity', 'manual')
   * @returns {boolean} - True if session was ended, false if no session was active
   */
  endSession(reason = 'unknown') {
    if (!this.sessionId) return false;

    // MEMORY LEAK FIX: Prevent recursive loop when _collectTimelineTick -> _checkEmptyRosterTimeout -> endSession
    if (this._isEndingSession) {
      console.warn('[FitnessSession] endSession() called recursively, skipping');
      return false;
    }
    this._isEndingSession = true;

    const now = Date.now();
    this.endTime = now;

    // DEBUG: Capture stack trace to identify what's triggering early session ends (throttled: first 5 only)
    const durationMs = this.endTime - this.startTime;
    if ((this._debugEndCount = (this._debugEndCount || 0) + 1) <= 5) {
      const stack = new Error().stack?.split('\n').slice(1, 6).map(s => s.trim()).join(' <- ');
      console.error(`🛑 SESSION_END [${this._debugEndCount}/5]: ${this.sessionId} after ${durationMs}ms, reason="${reason}"`, { stack });
    }

    this._collectTimelineTick({ timestamp: now });
    this._log('end', {
      sessionId: this.sessionId,
      durationMs,
      reason
    });
    
    let sessionData = null;
    try {
      if (this.treasureBox) {
        this.treasureBox.stop();
        // MEMORY LEAK FIX: Clear accumulated timeline data on session end
        this.treasureBox.reset();
      }
      sessionData = this.summary;
    } catch(_){}
    
    if (sessionData) this._persistSession(sessionData, { force: true });
    
    // 6A: Notify listeners that session has ended
    const endedSessionId = this.sessionId;
    this._notifySessionEnded(endedSessionId, reason);
    
    this.reset();
    return true;
  }

  /**
   * Phase 3: Check if an entity is active (has user with active HR this tick).
   * Used for determining whether to record entity coins_total.
   * 
   * @param {string} entityId - Entity ID to check
   * @param {Set<string>} activeHRSet - Set of user IDs with active HR this tick
   * @param {Map<string, Object>} userMetricMap - Map of userId -> staged entry
   * @returns {boolean}
   */
  _isEntityActive(entityId, activeHRSet, userMetricMap) {
    if (!entityId) return false;
    
    // Check userMetricMap for any user with this entityId
    for (const [userId, entry] of userMetricMap) {
      if (entry?.entityId === entityId && activeHRSet.has(userId)) {
        console.log('[FitnessSession] Entity is active:', { entityId, userId, hasActiveHR: true });
        return true;
      }
    }
    // Debug: log why entity wasn't found active
    const entriesWithEntity = [...userMetricMap.entries()].filter(([_, e]) => e?.entityId);
    const activeUsers = [...activeHRSet];
    console.log('[FitnessSession] Entity NOT active:', { 
      entityId, 
      entriesWithEntity: entriesWithEntity.map(([u, e]) => ({ userId: u, entityId: e.entityId })),
      activeUsers 
    });
    return false;
  }

  /**
   * 6A: Register a callback to be notified when the session ends.
   * @param {function} callback - Function called with (sessionId, reason)
   * @returns {function} - Unsubscribe function
   */
  onSessionEnded(callback) {
    if (typeof callback !== 'function') return () => {};
    this._sessionEndedCallbacks.push(callback);
    return () => {
      const idx = this._sessionEndedCallbacks.indexOf(callback);
      if (idx >= 0) this._sessionEndedCallbacks.splice(idx, 1);
    };
  }

  _notifySessionEnded(sessionId, reason) {
    this._sessionEndedCallbacks.forEach((cb) => {
      try {
        cb(sessionId, reason);
      } catch (_) {
        // Swallow errors in callbacks
      }
    });
  }

  /**
   * 6A: Check if roster is empty and end session after timeout.
   * Called from _collectTimelineTick after device pruning.
   */
  _checkEmptyRosterTimeout() {
    const roster = this.roster;
    const now = Date.now();
    const { emptySession } = this._getTimeouts();
    
    if (!roster || roster.length === 0) {
      // Roster is empty - start or check timer
      if (!this._emptyRosterStartTime) {
        this._emptyRosterStartTime = now;
        this._log('empty_roster_detected', { sessionId: this.sessionId });
      } else if (now - this._emptyRosterStartTime > emptySession) {
        // Roster has been empty too long - end session
        this._log('empty_roster_timeout', { 
          sessionId: this.sessionId,
          emptyDurationMs: now - this._emptyRosterStartTime
        });
        this.endSession('empty_roster');
      }
    } else {
      // Roster has users - reset the empty timer
      if (this._emptyRosterStartTime) {
        this._log('roster_recovered', { sessionId: this.sessionId });
      }
      this._emptyRosterStartTime = null;
    }
  }

  reset() {
    this.sessionId = null;
    this.startTime = null;
    this.endTime = null;
    this.lastActivityTime = null;
    this.activeDeviceIds.clear();
    this.eventLog = [];
    if (this.treasureBox) {
      try { this.treasureBox.stop(); } catch(_){}
    }
    this.treasureBox = null;
    this._saveTriggered = false;
    this.voiceMemoManager.reset();
    if (this._participantRoster) this._participantRoster.reset();
    this.userManager = new UserManager(); // Reset users? Or keep them? Usually reset for new session context.
    this.deviceManager = new DeviceManager(); // Reset devices?
    this.entityRegistry.reset(); // Clear session entities for new session
    this._stopAutosaveTimer();
    this._stopTickTimer(); // 6A: Also stop tick timer on reset
    this._lastAutosaveAt = 0;
    this._emptyRosterStartTime = null; // 6A: Reset empty roster tracking
    this._isEndingSession = false; // Clear re-entrancy guard
    // Note: Don't clear _sessionEndedCallbacks - they persist across sessions
    this.governanceEngine.reset();
    if (this.timeline) {
      this.timeline.reset(Date.now(), this.timeline.timebase?.intervalMs || 5000);
    }
    this.timeline = null;
    this.timebase = {
      startAbsMs: null,
      intervalMs: 5000,
      intervalCount: 0
    };
    this._lastSampleIndex = -1;
    this._pendingSnapshotRef = null;
    this._lastTelemetrySnapshotTick = -1;
    this._tickIntervalMs = 5000;
    this._cumulativeBeats = new Map();
    this._cumulativeRotations = new Map();
    
    // Phase 5: Reset TimelineRecorder
    this._timelineRecorder?.reset();
  }

  /**
   * MEMORY LEAK FIX: Complete teardown for unmount/navigation
   * Unlike reset() which prepares for session reuse, destroy() nullifies all references for GC
   */
  destroy() {
    // First do standard reset
    this.reset();
    
    // Then clear persistent state that reset() intentionally preserves
    this._sessionEndedCallbacks = [];
    
    // Nullify manager references
    this._deviceRouter = null;
    this._persistenceManager = null;
    this._metricsRecorder = null;
    this._timelineRecorder = null;
    this._participantRoster = null;
    this._lifecycle = null;
    
    // Clear zone profile store
    this.zoneProfileStore?.clear();
    this.zoneProfileStore = null;
    
    // Clear event journal
    this.eventJournal = null;
    
    // Clear activity monitor
    this.activityMonitor = null;
  }

  _encodeSeries(series = {}, tickCount = null) {
    const encodeValue = (key, value) => {
      if (value == null) return null;
      if (typeof value === 'number') {
        return roundValue(key, value);
      }
      const normalized = typeof value === 'string' ? value.trim().toLowerCase() : value;
      if (key.includes('zone')) {
        if (typeof normalized === 'string') {
          return ZONE_SYMBOL_MAP[normalized] || normalized;
        }
        return normalized;
      }
      return normalized;
    };

    const runLengthEncode = (key, arr) => {
      const encoded = [];
      for (let i = 0; i < arr.length; i += 1) {
        const value = encodeValue(key, arr[i]);
        const last = encoded[encoded.length - 1];

        // Compact RLE:
        // - bare value for count=1
        // - [value, count] for repeats
        if (Array.isArray(last) && last[0] === value) {
          last[1] += 1;
        } else if (last === value) {
          encoded[encoded.length - 1] = [value, 2];
        } else {
          encoded.push(value);
        }
      }
      return encoded;
    };

    const encodedSeries = {};
    Object.entries(series).forEach(([key, arr]) => {
      if (!Array.isArray(arr)) {
        encodedSeries[key] = arr;
        return;
      }

      // Empty-series filtering: do not persist all-null/empty series.
      if (!arr.length || arr.every((v) => v == null)) {
        return;
      }

      const rle = runLengthEncode(key, arr);
      encodedSeries[key] = JSON.stringify(rle);
    });
    return { encodedSeries };
  }

  _validateSessionPayload(sessionData) {
    if (!sessionData) return { ok: false, reason: 'missing-session' };
    const { startTime } = sessionData;
    if (!Number.isFinite(startTime)) return { ok: false, reason: 'invalid-startTime' };

    let endTime = Number(sessionData.endTime);
    if (!Number.isFinite(endTime)) {
      endTime = Date.now();
    }
    if (endTime <= startTime) {
      endTime = startTime + 1; // ensure forward progress
    }
    sessionData.endTime = endTime;
    sessionData.durationMs = Math.max(0, endTime - startTime);

    const roster = Array.isArray(sessionData.roster) ? sessionData.roster : [];
    const series = sessionData.timeline?.series || {};
    const tickCount = Number(sessionData.timeline?.timebase?.tickCount) || 0;
    const hasUserSeries = Object.keys(series).some((key) => typeof key === 'string' && key.startsWith('user:'));
    const deviceAssignments = Array.isArray(sessionData.deviceAssignments)
      ? sessionData.deviceAssignments
      : [];
    if (hasUserSeries && roster.length === 0) {
      return { ok: false, reason: 'roster-required' };
    }
    if (hasUserSeries && deviceAssignments.length === 0) {
      return { ok: false, reason: 'device-assignments-required' };
    }

    // 6A: Spam prevention - reject short, empty sessions
    const hasVoiceMemos = Array.isArray(sessionData.voiceMemos) && sessionData.voiceMemos.length > 0;
    const hasEvents = Array.isArray(sessionData.timeline?.events) && sessionData.timeline.events.length > 0;
    
    // If session is under 10 seconds and has no user data, voice memos, or events, it's spam.
    if (sessionData.durationMs < 10000 && !hasUserSeries && !hasVoiceMemos && !hasEvents) {
       // If roster is also empty, definitely spam.
       // If roster has people but duration is < 1s (like the 1ms sessions), also spam.
       if (roster.length === 0 || sessionData.durationMs < 1000) {
         return { ok: false, reason: 'session-too-short-and-empty' };
       }
    }

    // Deduplicate challenge events (e.g., repeated challenge_end at same tick)
    if (Array.isArray(sessionData.timeline?.events)) {
      const seen = new Set();
      sessionData.timeline.events = sessionData.timeline.events.filter((evt) => {
        if (!evt || typeof evt !== 'object') return false;
        const type = evt.type || evt.eventType || null;
        if (!type) return false;
        const tickIndex = Number.isFinite(evt.tickIndex) ? evt.tickIndex : null;
        const challengeId = evt.data?.challengeId
          || evt.data?.challenge_id
          || evt.data?.challenge
          || evt.data?.challengeID
          || null;
        const key = `${type}|${tickIndex}|${challengeId || ''}`;
        if (type.startsWith('challenge_')) {
          if (seen.has(key)) return false;
          seen.add(key);
        }
        return true;
      });
    }

    // CRITICAL: Require minimum ticks to prevent useless 1-tick ghost sessions
    if (tickCount < 3) {
      return { ok: false, reason: 'insufficient-ticks', tickCount };
    }

    const { ok: lengthsOk, issues } = FitnessTimeline.validateSeriesLengths(sessionData.timeline?.timebase || {}, series);
    if (!lengthsOk) {
      return { ok: false, reason: 'series-tick-mismatch', issues };
    }

    let totalPoints = 0;
    Object.values(series).forEach((entry) => {
      if (Array.isArray(entry)) {
        totalPoints += entry.length;
      }
    });
    if (totalPoints > MAX_SERIALIZED_SERIES_POINTS) {
      return { ok: false, reason: 'series-size-cap', totalPoints };
    }

    return { ok: true, endTime, durationMs: sessionData.durationMs };
  }

  /**
   * Persist session data - DELEGATED to PersistenceManager.
   * 
   * Phase 5 refactoring: This method now delegates to PersistenceManager
   * which owns all validation, encoding, and API persistence logic.
   * 
   * @param {Object} sessionData
   * @param {Object} [options]
   * @param {boolean} [options.force=false]
   * @returns {boolean}
   */
  _persistSession(sessionData, { force = false } = {}) {
    // Delegate to PersistenceManager
    const result = this._persistenceManager.persistSession(sessionData, { force });
    
    // Sync state for backward compatibility
    this._lastAutosaveAt = this._persistenceManager.getLastSaveTime();
    this._saveTriggered = this._persistenceManager.isSaveInProgress();
    
    return result;
  }
  
  // NOTE: ~140 lines of _persistSession implementation were extracted to
  // PersistenceManager.js as part of Phase 5 refactoring.
  // See: /docs/postmortem-entityid-migration-fitnessapp.md #13

  _startTickTimer() {
    this._stopTickTimer();
    const interval = this.timeline?.timebase.intervalMs || this._tickIntervalMs;
    if (!(interval > 0)) return;

    // TELEMETRY: Track timer lifecycle for memory leak debugging
    this._tickTimerStartedAt = Date.now();
    this._tickTimerTickCount = 0;
    getLogger().sampled('fitness.tick_timer.started', {
      sessionId: this.sessionId,
      intervalMs: interval
    }, { maxPerMinute: 10 });

    this._tickTimer = setInterval(() => {
      this._tickTimerTickCount++;
      try {
        this._collectTimelineTick();
        // 6A: Check for empty roster timeout after each tick
        this._checkEmptyRosterTimeout();
      } catch (err) {
        // Log error instead of silent swallow - helps debug freeze issues
        getLogger().error('fitness.tick_timer.error', {
          sessionId: this.sessionId,
          tick: this._tickTimerTickCount,
          error: err?.message,
          stack: err?.stack?.split('\n').slice(0, 3).join(' | ')
        });
      }

      // TELEMETRY: Health check every 60 ticks (~5 min at 5s interval)
      if (this._tickTimerTickCount % 60 === 0) {
        this._logTickTimerHealth();
      }
    }, interval);
  }

  _stopTickTimer() {
    if (this._tickTimer) {
      const tickCount = this._tickTimerTickCount || 0;
      const ranForMs = Date.now() - (this._tickTimerStartedAt || Date.now());

      // Only log meaningful timer stops (had ticks OR ran for >2s)
      // Zero-tick short timers are just restarts with no work done
      if (tickCount > 0 || ranForMs >= 2000) {
        getLogger().info('fitness.tick_timer.stopped', {
          sessionId: this.sessionId,
          tickCount,
          ranForMs
        });
      }

      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
  }

  /**
   * TELEMETRY: Log health metrics for memory leak debugging.
   * Called every 60 ticks (~5 min) during active session.
   */
  _logTickTimerHealth() {
    const stats = this.getMemoryStats();
    getLogger().sampled('fitness.tick_timer.health', {
      sessionId: this.sessionId,
      tickCount: this._tickTimerTickCount,
      runningForMs: Date.now() - (this._tickTimerStartedAt || Date.now()),
      ...stats
    }, { maxPerMinute: 5 });
  }

  /**
   * TELEMETRY: Get memory/data structure stats for profiling.
   * Can be called externally (e.g., from FitnessApp 30-second profiler).
   * @returns {Object} Stats about internal data structure sizes
   */
  getMemoryStats() {
    const timelineSeries = this.timeline?.series || {};
    const seriesKeys = Object.keys(timelineSeries);
    const totalSeriesPoints = seriesKeys.reduce((sum, key) => {
      const arr = timelineSeries[key];
      return sum + (Array.isArray(arr) ? arr.length : 0);
    }, 0);

    // Find max series length (potential unbounded growth indicator)
    const maxSeriesLength = seriesKeys.reduce((max, key) => {
      const arr = timelineSeries[key];
      return Math.max(max, Array.isArray(arr) ? arr.length : 0);
    }, 0);

    // Snapshot series stats (separate from timeline - used for legacy compatibility)
    let snapshotSeriesPoints = 0;
    let maxSnapshotSeriesLength = 0;
    if (this.snapshot?.participantSeries instanceof Map) {
      for (const arr of this.snapshot.participantSeries.values()) {
        if (Array.isArray(arr)) {
          snapshotSeriesPoints += arr.length;
          maxSnapshotSeriesLength = Math.max(maxSnapshotSeriesLength, arr.length);
        }
      }
    }

    // TreasureBox stats (if available)
    const treasureBoxStats = this.treasureBox?.getMemoryStats?.() || {};

    return {
      // Session state
      sessionActive: !!this.sessionId,
      tickTimerRunning: !!this._tickTimer,

      // Data structure sizes
      rosterSize: this.roster?.length || 0,
      deviceCount: this.deviceManager?.devices?.size || 0,
      userCount: this.userManager?.users?.size || 0,
      eventLogSize: this.eventLog?.length || 0,

      // Timeline stats
      seriesCount: seriesKeys.length,
      totalSeriesPoints,
      maxSeriesLength,
      timelineTicks: this.timeline?.timebase?.tickCount || 0,

      // Snapshot series stats (memory leak indicator)
      snapshotSeriesPoints,
      maxSnapshotSeriesLength,

      // Cumulative trackers
      cumulativeBeatsSize: this._cumulativeBeats?.size || 0,
      cumulativeRotationsSize: this._cumulativeRotations?.size || 0,

      // Entity tracking
      entityCount: this.entityRegistry?.getAll?.()?.length || 0,

      // TreasureBox (detailed stats)
      treasureBoxUsers: this.treasureBox?.perUser?.size || 0,
      treasureBoxCumulativeLen: treasureBoxStats.cumulativeTimelineLength || 0,
      treasureBoxPerColorPoints: treasureBoxStats.perColorTotalPoints || 0,
      
      // VoiceMemo
      voiceMemoCount: this.voiceMemoManager?.getMemos?.()?.length || 0,

      // Heap (if available - Chrome only)
      heapUsedMB: typeof performance !== 'undefined' && performance.memory
        ? Math.round(performance.memory.usedJSHeapSize / 1024 / 1024 * 10) / 10
        : null
    };
  }

  _maybeLogTimelineTelemetry() {
    if (!this.timeline) return;
    const tickCount = this.timeline.timebase?.tickCount ?? 0;
    if (!(this._telemetryTickInterval > 0)) return;
    if (this._lastTelemetrySnapshotTick >= 0) {
      const delta = tickCount - this._lastTelemetrySnapshotTick;
      if (delta < this._telemetryTickInterval) return;
    }
    this._lastTelemetrySnapshotTick = tickCount;
    const seriesRef = this.timeline.series || {};
    const seriesCount = Object.keys(seriesRef).length;
    const totalPoints = Object.values(seriesRef).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
    const eventCount = Array.isArray(this.timeline.events) ? this.timeline.events.length : 0;
    this._log('timeline_telemetry', {
      tickCount,
      eventCount,
      seriesCount,
      totalPoints
    });
  }

  _startAutosaveTimer() {
    if (this._autosaveTimer) clearInterval(this._autosaveTimer);
    if (!(this._autosaveIntervalMs > 0)) return;
    this._autosaveTimer = setInterval(() => {
      try {
        this._maybeAutosave();
      } catch (err) {
        // console.error('Autosave failed', err);
      }
    }, this._autosaveIntervalMs);
  }

  _stopAutosaveTimer() {
    if (this._autosaveTimer) {
      clearInterval(this._autosaveTimer);
      this._autosaveTimer = null;
    }
  }

  _maybeAutosave(force = false) {
    if (!this.sessionId) return;
    if (!force) {
      if (this._autosaveIntervalMs <= 0) return;
      // Check PersistenceManager directly - don't use stale _saveTriggered
      if (this._persistenceManager?.isSaveInProgress?.()) return;
      const now = Date.now();
      if (this._lastAutosaveAt && (now - this._lastAutosaveAt) < this._autosaveIntervalMs) return;
    }
    // DEBUG: Log autosave (throttled: first 3 only)
    if ((this._debugAutosaveCount = (this._debugAutosaveCount || 0) + 1) <= 3) {
      const elapsed = this.startTime ? Date.now() - this.startTime : 0;
      console.error(`💾 AUTOSAVE [${this._debugAutosaveCount}/3]: ${this.sessionId} at ${elapsed}ms`);
    }
    getLogger().debug('fitness.session.autosave', { sessionId: this.sessionId, force });
    this._maybeTickTimeline();
    const snapshot = this.summary;
    if (!snapshot) return;
    const saved = this._persistSession(snapshot, { force });
    if (!saved) {
      this._log('autosave_skipped', { reason: 'persist-validation-failed' });
    }
  }

  _maybeTickTimeline(targetTimestamp = Date.now()) {
    if (!this.timeline || !this.sessionId) return;
    const interval = this.timeline.timebase?.intervalMs || 0;
    if (!(interval > 0)) return;
    let lastTick = this.timeline.timebase?.lastTickTimestamp
      ?? this.timeline.timebase?.startTime
      ?? this.startTime
      ?? targetTimestamp;
    if (!Number.isFinite(lastTick)) {
      lastTick = targetTimestamp;
    }
    const maxIterations = 1000;
    let iterations = 0;
    while ((targetTimestamp - lastTick) >= interval && iterations < maxIterations) {
      const nextTickTimestamp = lastTick + interval;
      this._collectTimelineTick({ timestamp: nextTickTimestamp });
      lastTick = this.timeline.timebase?.lastTickTimestamp ?? nextTickTimestamp;
      iterations += 1;
    }
  }

  get isActive() {
    return !!this.sessionId && !this.endTime;
  }

  get summary() {
      // (Implement summary generation similar to original, aggregating from managers)
      // For brevity, returning a stub that calls managers
      if (!this.sessionId) return null;
      const timelineSummary = this.timeline ? this.timeline.summary : null;
      const startTime = this.startTime;
      const tickBasedEndTime = (() => {
        const start = timelineSummary?.timebase?.startTime;
        const interval = timelineSummary?.timebase?.intervalMs;
        const tickCount = timelineSummary?.timebase?.tickCount;
        if (Number.isFinite(start) && Number.isFinite(interval) && Number.isFinite(tickCount) && tickCount > 0) {
          return start + (tickCount * interval);
        }
        return null;
      })();
      const derivedEndTime = this.endTime
        || timelineSummary?.timebase?.lastTickTimestamp
        || tickBasedEndTime
        || this.timebase?.lastTickTimestamp
        || this.lastActivityTime
        || Date.now();
      // Fix: Do not mutate this.endTime during summary generation (autosave)
      // this.endTime = derivedEndTime;
      const durationMs = Number.isFinite(startTime) ? Math.max(0, derivedEndTime - startTime) : null;
      const deviceAssignments = this.userManager?.assignmentLedger?.snapshot?.() || [];
      const entities = this.entityRegistry?.snapshot?.() || [];
        return {
          sessionId: this.sessionId,
          startTime,
          endTime: derivedEndTime,
          durationMs,
          roster: this.roster,
          deviceAssignments,
          entities,
          voiceMemos: this.voiceMemoManager.summary,
          treasureBox: this.treasureBox ? this.treasureBox.summary : null,
          timeline: timelineSummary,
          timebase: timelineSummary?.timebase || this.timebase,
          events: timelineSummary?.events || []
        };
  }

  logEvent(type, data = {}, timestamp) {
    if (!type) return null;
    return this.timeline ? this.timeline.logEvent(type, data, timestamp) : null;
  }

  recordSnapshot(filename) {
    if (!filename) return null;
    this._pendingSnapshotRef = filename;
    return filename;
  }

  // Voice Memo Delegation
  addVoiceMemo(memo) {
    const result = this.voiceMemoManager.addMemo(memo);
    this._maybeAutosave();
    return result;
  }

  removeVoiceMemo(memoId) {
    this.voiceMemoManager.removeMemo(memoId);
    this._maybeAutosave();
  }

  replaceVoiceMemo(memoId, memo) {
    const result = this.voiceMemoManager.replaceMemo(memoId, memo);
    this._maybeAutosave();
    return result;
  }

  get userCollections() {
    if (!this._userCollectionsCache) {
      this._userCollectionsCache = this.userManager.getUserCollections();
    }
    return this._userCollectionsCache;
  }

  get deviceOwnership() {
    if (!this._deviceOwnershipCache) {
      this._deviceOwnershipCache = this.userManager.getDeviceOwnership();
    }
    return this._deviceOwnershipCache;
  }

  get guestCandidates() {
    if (!this._guestCandidatesCache) {
      this._guestCandidatesCache = this.userManager.getGuestCandidates();
    }
    return this._guestCandidatesCache;
  }

  get userZoneProfiles() {
    if (!this._userZoneProfilesCache) {
      this._userZoneProfilesCache = this.zoneProfileStore
        ? this.zoneProfileStore.getProfileMap()
        : this.userManager.getUserZoneProfiles();
    }
    return this._userZoneProfilesCache;
  }

  get zoneProfiles() {
    return this.zoneProfileStore ? this.zoneProfileStore.getProfiles() : [];
  }

  getZoneProfile(identifier) {
    return this.zoneProfileStore ? this.zoneProfileStore.getProfile(identifier) : null;
  }

  cleanupOrphanGuests() {
    const ledger = this.userManager?.assignmentLedger;
    if (!ledger) {
      return { removed: 0, devices: [] };
    }
    const snapshot = ledger.snapshot();
    const removedDevices = [];

    // DEBUG: Log cleanup attempt (throttled)
    if ((this._debugCleanupCount = (this._debugCleanupCount || 0) + 1) <= 5) {
      console.error(`🧹 CLEANUP_ORPHANS [${this._debugCleanupCount}/5]: checking ${snapshot.length} ledger entries`);
    }

    snapshot.forEach((entry) => {
      if (!entry) return;
      const slug = entry.occupantSlug || null;
      const user = slug ? this.userManager.getUser(slug) : null;
      const boundDeviceId = user?.hrDeviceId ? String(user.hrDeviceId) : null;
      const deviceMatches = boundDeviceId === entry.deviceId;
      if (!user || !deviceMatches) {
        // DEBUG: Log each removal (always - these are critical)
        console.error(`🗑️ LEDGER_REMOVE: device=${entry.deviceId}, slug=${slug}, reason=${!user ? 'user-missing' : 'device-mismatch'}`, {
          boundDeviceId,
          entryDeviceId: entry.deviceId,
          hasUser: !!user
        });
        ledger.remove(entry.deviceId);
        removedDevices.push(entry.deviceId);
        this.eventJournal?.log('ORPHAN_GUEST_REMOVED', {
          deviceId: entry.deviceId,
          occupantSlug: entry.occupantSlug || null,
          reason: !user ? 'user-missing' : 'device-mismatch'
        }, { severity: 'warn' });
      }
    });
    return { removed: removedDevices.length, devices: removedDevices };
  }

  reconcileAssignments() {
    const ledger = this.userManager?.assignmentLedger;
    const mismatches = [];
    if (!ledger) {
      return { mismatches };
    }
    const snapshot = ledger.snapshot();
    snapshot.forEach((entry) => {
      if (!entry) return;
      const slug = entry.occupantSlug || null;
      const user = slug ? this.userManager.getUser(slug) : null;
      if (!user) {
        mismatches.push({ type: 'missing-user', deviceId: entry.deviceId, occupantSlug: slug });
        this.eventJournal?.log('LEDGER_RECONCILE_WARN', {
          deviceId: entry.deviceId,
          occupantSlug: slug,
          issue: 'missing-user'
        }, { severity: 'warn' });
        return;
      }
      const boundDeviceId = user.hrDeviceId ? String(user.hrDeviceId) : null;
      if (boundDeviceId && boundDeviceId !== entry.deviceId) {
        mismatches.push({ type: 'device-mismatch', deviceId: entry.deviceId, occupantSlug: slug, boundDeviceId });
        this.eventJournal?.log('LEDGER_RECONCILE_WARN', {
          deviceId: entry.deviceId,
          occupantSlug: slug,
          issue: 'device-mismatch',
          boundDeviceId
        }, { severity: 'warn' });
      }
      const device = this.deviceManager.getDevice(entry.deviceId);
      if (!device) {
        mismatches.push({ type: 'device-missing', deviceId: entry.deviceId, occupantSlug: slug });
        this.eventJournal?.log('LEDGER_RECONCILE_WARN', {
          deviceId: entry.deviceId,
          occupantSlug: slug,
          issue: 'device-missing'
        }, { severity: 'warn' });
      }
    });
    if (mismatches.length === 0) {
      this.eventJournal?.log('LEDGER_RECONCILE_OK', { count: snapshot.length });
    }
    return { mismatches };
  }

  invalidateUserCaches() {
    this._userCollectionsCache = null;
    this._deviceOwnershipCache = null;
    this._guestCandidatesCache = null;
    this._userZoneProfilesCache = null;
    this.zoneProfileStore?.clear();
  }
}
