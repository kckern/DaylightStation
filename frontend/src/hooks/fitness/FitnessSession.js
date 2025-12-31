import { formatSessionId, slugifyId, ensureSeriesCapacity, deepClone, resolveDisplayLabel } from './types.js';
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

// Phase 4: Extracted modules for decomposed session management
import { SessionLifecycle } from './SessionLifecycle.js';
import { MetricsRecorder } from './MetricsRecorder.js';
import { ParticipantRoster } from './ParticipantRoster.js';

// -------------------- Timeout Configuration --------------------
const FITNESS_TIMEOUTS = {
  inactive: 60000,
  remove: 180000,
  rpmZero: 12000,
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

export const setFitnessTimeouts = ({ inactive, remove, rpmZero, emptySession } = {}) => {
  if (typeof inactive === 'number' && !Number.isNaN(inactive)) FITNESS_TIMEOUTS.inactive = inactive;
  if (typeof remove === 'number' && !Number.isNaN(remove)) FITNESS_TIMEOUTS.remove = remove;
  if (typeof rpmZero === 'number' && !Number.isNaN(rpmZero)) FITNESS_TIMEOUTS.rpmZero = rpmZero;
  if (typeof emptySession === 'number' && !Number.isNaN(emptySession)) FITNESS_TIMEOUTS.emptySession = emptySession;
};

export const getFitnessTimeouts = () => ({ ...FITNESS_TIMEOUTS });

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
    
    // Sub-managers
    this.deviceManager = new DeviceManager();
    this.userManager = new UserManager();
    this.governanceEngine = new GovernanceEngine();
    this.voiceMemoManager = new VoiceMemoManager(this);
    this.zoneProfileStore = new ZoneProfileStore();
    this.eventJournal = new EventJournal();
    this.treasureBox = null; // Instantiated on start
    
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

    // Pre-session buffer to avoid ghost sessions from spurious single pings
    this._preSessionBuffer = [];
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
    this._equipmentIdByCadence = new Map();
    
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
    
    // Ghost session detection - now also in SessionLifecycle but keeping for compatibility
    this._emptyRosterStartTime = null;
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

  ingestData(payload) {
    if (!payload) return;

    // Handle ANT+ Data
    if (payload.topic === 'fitness' && payload.type === 'ant' && payload.deviceId && payload.data) {
      const device = this.deviceManager.updateDevice(
        String(payload.deviceId),
        payload.profile,
        { ...payload.data, dongleIndex: payload.dongleIndex, timestamp: payload.timestamp }
      );
      if (device) {
        this.recordDeviceActivity(device);
      }
      return device;
    }
  }

  _log(type, payload = {}) {
    this.eventLog.push({ ts: Date.now(), type, ...payload });
    if (this.eventLog.length > 500) {
      this.eventLog = this.eventLog.slice(-500);
    }
  }

  recordDeviceActivity(deviceData) {
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
      if (user) {
        // 5A: Check for device reassignment - clear cumulative state if occupant changed
        const currentOccupant = user.name || user.slug;
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
        // Feed TreasureBox if HR
        if (this.treasureBox && deviceData.type === 'heart_rate') {
           this.treasureBox.recordUserHeartRate(user.name, deviceData.heartRate);
        }
      }
      const ledger = this.userManager?.assignmentLedger;
      if (ledger) {
        const ledgerEntry = ledger.get(device.id);
        const resolvedSlug = user ? slugifyId(user.name) : null;
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

    const startedNow = this._maybeStartSessionFromBuffer(deviceData, now);
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

  setEquipmentCatalog(equipmentList = []) {
    this._equipmentIdByCadence = new Map();
    if (!Array.isArray(equipmentList)) return;
    equipmentList.forEach((entry) => {
      if (!entry || entry.cadence == null || !entry.id) return;
      const key = String(entry.cadence).trim();
      const val = String(entry.id).trim();
      if (key && val) {
        this._equipmentIdByCadence.set(key, val);
      }
    });
  }

  _isValidPreSessionSample(deviceData) {
    if (!deviceData) return false;
    const profile = deviceData.profile || deviceData.type;
    const hrValue = Number(deviceData.heartRate ?? deviceData.heart_rate ?? deviceData.data?.heartRate ?? deviceData.data?.heart_rate);
    const isHeartRate = (profile === 'heart_rate' || deviceData.type === 'heart_rate');
    return isHeartRate && Number.isFinite(hrValue) && hrValue > 0;
  }

  _maybeStartSessionFromBuffer(deviceData, timestamp) {
    if (this.sessionId) return false;
    const eligible = this._isValidPreSessionSample(deviceData);
    if (eligible) {
      this._preSessionBuffer.push({ ...deviceData, timestamp });
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
          threshold: this._preSessionThreshold || 3
        });
        this._lastPreSessionLogAt = timestamp;
      }
      return false;
    }

    const started = this.ensureStarted();
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
      if (!entry || !entry.user) return;
      const key = slugifyId(entry.user);
      if (!key) return;
      zoneLookup.set(key, {
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

      const key = slugifyId(participantName);
      const zoneInfo = zoneLookup.get(key) || null;
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
        profileId: mappedUser?.id || key,
        baseUserName,
        isGuest,
        hrDeviceId: deviceId,
        heartRate: resolvedHeartRate,
        zoneId: zoneInfo?.zoneId || fallbackZoneId || null,
        zoneColor: zoneInfo?.color || fallbackZoneColor || null,
        avatarUrl: isGuest ? null : mappedUser?.avatarUrl || null
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
    const addIfValid = (slug) => {
      if (typeof slug === 'string') {
        const normalized = slug.trim();
        if (normalized) participants.add(normalized);
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

  _resolveEquipmentId(device) {
    if (!device) return null;
    const explicit = device.equipmentId || device.equipment_id || device?.metadata?.equipmentId;
    if (explicit) return String(explicit).trim();
    const cadence = device.cadence ?? device.deviceCadence ?? device.id;
    const cadenceKey = cadence == null ? null : String(cadence).trim();
    if (cadenceKey && this._equipmentIdByCadence?.has(cadenceKey)) {
      return this._equipmentIdByCadence.get(cadenceKey);
    }
    const name = device.name || device.label || null;
    if (name) return slugifyId(name);
    if (cadenceKey) return slugifyId(cadenceKey);
    return null;
  }

  ensureStarted() {
    if (this.sessionId) return false;
    const nowDate = new Date();
    const now = nowDate.getTime();
    this.sessionTimestamp = formatSessionId(nowDate);
    this.sessionId = `fs_${this.sessionTimestamp}`;
    this.startTime = now;
    this.lastActivityTime = now;
    this.endTime = null;
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
    
    this._log('start', { sessionId: this.sessionId });
    
    if (!this.treasureBox) {
      this.treasureBox = new FitnessTreasureBox(this);
      // Inject ActivityMonitor for activity-aware coin processing (Priority 2)
      this.treasureBox.setActivityMonitor(this.activityMonitor);
      // Configure treasure box if we have config available
      // (Usually configured via updateSnapshot or external call)
    }
    
    // Update ParticipantRoster with treasureBox reference after creation
    this._participantRoster.configure({ treasureBox: this.treasureBox });
    
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
    }

    // Process Users (from UserManager)
    const allUsers = this.userManager.getAllUsers();
    allUsers.forEach(user => {
        const slug = slugifyId(user.name);
        this.snapshot.usersMeta.set(slug, {
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

        const series = this.snapshot.participantSeries.get(slug) || [];
        ensureSeriesCapacity(series, intervalIndex);
        series[intervalIndex] = hrValue > 0 ? hrValue : null;
        this.snapshot.participantSeries.set(slug, series);
      });
      this.zoneProfileStore?.syncFromUsers(allUsers);

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
    // Use the roster which already filters out suppressed devices
    const activeParticipants = this.roster
        .filter((entry) => {
          const hr = Number.isFinite(entry?.heartRate) ? entry.heartRate : 0;
          return hr > 0 && entry.name;
        })
        .map(entry => entry.name);
        
    const userZoneMap = {};
    this.roster.forEach(entry => {
        if (entry.name) {
            userZoneMap[entry.name] = entry.zoneId || null;
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

  _collectTimelineTick({ timestamp } = {}) {
    if (!this.timeline || !this.sessionId) return null;

    const tickPayload = {};
    const assignMetric = (key, value) => {
      // Allow explicit nulls for heart_rate to mark dropouts on the chart
      const isHeartRateKey = typeof key === 'string' && key.endsWith(':heart_rate');
      if (value == null && !isHeartRateKey) return;
      if (typeof value === 'number' && Number.isNaN(value)) return;
      tickPayload[key] = value;
    };
    const sanitizeHeartRate = (value) => (Number.isFinite(value) && value > 0 ? Math.round(value) : null);
    const sanitizeNumber = (value) => (Number.isFinite(value) ? value : null);
    const sanitizeDistance = (value) => (Number.isFinite(value) && value > 0 ? value : null);
    const hasNumericSample = (metrics = {}) => ['heartRate', 'rpm', 'power', 'distance'].some((key) => metrics[key] != null);
    const stageUserEntry = (user) => {
      if (!user?.name) return null;
      const slug = slugifyId(user.name);
      if (!slug) return null;
      const snapshot = typeof user.getMetricsSnapshot === 'function' ? user.getMetricsSnapshot() : {};
      const staged = {
        slug,
        metadata: {
          name: user.name,
          groupLabel: user.groupLabel || null,
          source: user.source || null,
          color: snapshot?.zoneColor || user.currentData?.color || null
        },
        metrics: {
          heartRate: sanitizeHeartRate(snapshot?.heartRate ?? user.currentData?.heartRate),
          zoneId: snapshot?.zoneId || user.currentData?.zone || null,
          rpm: sanitizeNumber(snapshot?.rpm),
          power: sanitizeNumber(snapshot?.power),
          distance: sanitizeDistance(snapshot?.distance)
        }
      };
      return staged;
    };
    const isValidTickKey = (key) => {
      if (!key || typeof key !== 'string') return false;
      const segments = key.split(':');
      if (segments.length !== 3) return false;
      return segments.every((segment) => !!segment && /^[a-z0-9_]+$/i.test(segment));
    };
    const validateTickPayloadKeys = () => {
      const invalidKeys = [];
      Object.keys(tickPayload).forEach((key) => {
        if (isValidTickKey(key)) return;
        invalidKeys.push(key);
        delete tickPayload[key];
      });
      if (invalidKeys.length) {
        this._log('timeline_tick_invalid_key', { keys: invalidKeys });
      }
    };
    const userMetricMap = new Map();
    const intervalMs = this.timeline?.timebase?.intervalMs || this._tickIntervalMs || 5000;
    const intervalSeconds = intervalMs / 1000;

    const currentTickIndex = this.timeline.timebase?.tickCount ?? 0;
    const users = this.userManager.getAllUsers();
    users.forEach((user) => {
      const staged = stageUserEntry(user);
      if (staged) {
        userMetricMap.set(staged.slug, staged);
      }
    });

    // Track users whose devices are inactive (for syncing chart dropout with sidebar)
    const deviceInactiveUsers = new Set();

    const devices = this.deviceManager.getAllDevices();
    devices.forEach((device) => {
      if (!device) return;
      const deviceId = slugifyId(device.id || device.deviceId || device.name);
      
      // OPTION A FIX: Check DeviceManager's inactiveSince as source of truth
      // This aligns chart dropout with sidebar's inactive state (transparent + countdown)
      if (device.inactiveSince) {
        // Device is inactive according to DeviceManager - don't count user as active
        const mappedUser = this.userManager.resolveUserForDevice(device.id || device.deviceId);
        if (mappedUser) {
          const slug = slugifyId(mappedUser.name);
          if (slug) {
            deviceInactiveUsers.add(slug);
            // Ensure user is in userMetricMap so we record null HR
            if (!userMetricMap.has(slug)) {
              const staged = stageUserEntry(mappedUser);
              if (staged) {
                userMetricMap.set(slug, staged);
              }
            }
          }
        }
        // Skip active device processing but still record device metrics
      }
      
      const metrics = typeof device.getMetricsSnapshot === 'function'
        ? device.getMetricsSnapshot()
        : null;
      const sanitizedDeviceMetrics = {
        rpm: sanitizeNumber(metrics?.rpm ?? metrics?.cadence),
        power: sanitizeNumber(metrics?.power),
        speed: sanitizeNumber(metrics?.speed),
        distance: sanitizeDistance(metrics?.distance),
        heartRate: sanitizeHeartRate(metrics?.heartRate)
      };
      const hasDeviceSample = Object.values(sanitizedDeviceMetrics).some((val) => val != null);
      if (hasDeviceSample) {
        assignMetric(`device:${deviceId}:rpm`, sanitizedDeviceMetrics.rpm);
        assignMetric(`device:${deviceId}:power`, sanitizedDeviceMetrics.power);
        assignMetric(`device:${deviceId}:speed`, sanitizedDeviceMetrics.speed);
        assignMetric(`device:${deviceId}:distance`, sanitizedDeviceMetrics.distance);
        assignMetric(`device:${deviceId}:heart_rate`, sanitizedDeviceMetrics.heartRate);
      }

      const equipmentId = this._resolveEquipmentId(device);
      const equipmentKey = equipmentId || deviceId;
      if (equipmentKey) {
        const prevRotations = this._cumulativeRotations.get(equipmentKey) || 0;
        const deltaRotations = Number.isFinite(sanitizedDeviceMetrics.rpm) && sanitizedDeviceMetrics.rpm > 0
          ? (sanitizedDeviceMetrics.rpm / 60) * intervalSeconds
          : 0;
        const nextRotations = prevRotations + deltaRotations;
        this._cumulativeRotations.set(equipmentKey, nextRotations);
        assignMetric(`device:${equipmentKey}:rotations`, nextRotations);
      }

      // Skip user metric assignment if device is inactive
      if (device.inactiveSince) return;

      if (!deviceId) return;
      const mappedUser = this.userManager.resolveUserForDevice(device.id || device.deviceId);
      if (!mappedUser) return;
      const slug = slugifyId(mappedUser.name);
      if (!slug) return;
      if (!userMetricMap.has(slug)) {
        const staged = stageUserEntry(mappedUser);
        if (staged) {
          userMetricMap.set(slug, staged);
        }
      }
      const entry = userMetricMap.get(slug);
      if (!entry) return;
      // Mark that this user received FRESH device data this tick
      entry._hasDeviceDataThisTick = true;
      entry.metrics.heartRate = entry.metrics.heartRate ?? sanitizedDeviceMetrics.heartRate;
      entry.metrics.rpm = entry.metrics.rpm ?? sanitizedDeviceMetrics.rpm;
      entry.metrics.power = entry.metrics.power ?? sanitizedDeviceMetrics.power;
      entry.metrics.distance = entry.metrics.distance ?? sanitizedDeviceMetrics.distance;
    });
    
    // Collect active participant IDs for ActivityMonitor (Phase 2)
    const activeParticipantIds = new Set();
    
    // PHASE 1 FIX: Track users who have valid HR data THIS tick
    // CRITICAL: Only count users who received FRESH device data this tick
    // User.getMetricsSnapshot() returns cached/stale heartRate which causes false positives
    const currentTickActiveHR = new Set();
    
    // First pass: identify who has valid HR data this tick FROM DEVICE
    userMetricMap.forEach((entry, slug) => {
      if (!entry) return;
      // Only trust heartRate if we got FRESH device data this tick
      // Otherwise the user's cached heartRate (from User.getMetricsSnapshot) is stale
      if (!entry._hasDeviceDataThisTick) return;
      
      // OPTION A FIX: Don't count user as active if their device is inactive
      // This syncs chart dropout with sidebar's inactive state
      if (deviceInactiveUsers.has(slug)) return;
      
      const hr = entry.metrics?.heartRate;
      const hasValidHR = hr != null && Number.isFinite(hr) && hr > 0;
      if (hasValidHR) {
        currentTickActiveHR.add(slug);
      }
    });
    
    // Record null for users who HAD active HR last tick but DON'T this tick
    // This creates the "holes" that allow dropout detection in the chart
    // Priority 6: Use ActivityMonitor.getPreviousTickActive() instead of _lastTickActiveHR
    const droppedUsers = [];
    const previousTickActive = this.activityMonitor?.getPreviousTickActive() || new Set();
    previousTickActive.forEach((slug) => {
      if (!currentTickActiveHR.has(slug)) {
        // User's device stopped broadcasting - record null to mark dropout
        droppedUsers.push(slug);
        
        // Note: TreasureBox coin accumulation is now handled by:
        // 1. processTick() which only processes active participants (Priority 1)
        // 2. _awardCoins() which checks ActivityMonitor.isActive() (Priority 2)
        // So we don't need to manually clear highestZone or freeze coins here anymore
      }
    });
    if (droppedUsers.length > 0) {
      console.log('[FitnessSession] DROPOUT DETECTED for:', droppedUsers);
    }
    
    // CRITICAL: Record null HR for ALL roster users who are not currently active
    // This ensures the chart shows dropout (dotted line) immediately when broadcast stops,
    // not when the user is removed from roster. This aligns with the sidebar's "inactive" state.
    const inactiveUsers = [];
    userMetricMap.forEach((entry, slug) => {
      if (!currentTickActiveHR.has(slug)) {
        // User is in roster but NOT actively broadcasting - record null
        assignMetric(`user:${slug}:heart_rate`, null);
        inactiveUsers.push(slug);
      }
    });
    
    // Note: Previous tick tracking now handled by ActivityMonitor.recordTick() (Priority 6)
    
    // Second pass: process metrics for all users
    userMetricMap.forEach((entry, slug) => {
      if (!entry) return;
      const prevBeats = this._cumulativeBeats.get(slug) || 0;
      const hr = entry.metrics.heartRate;
      const hasValidHR = currentTickActiveHR.has(slug);
      const deltaBeats = hasValidHR
        ? (hr / 60) * intervalSeconds
        : 0;
      const nextBeats = prevBeats + deltaBeats;
      this._cumulativeBeats.set(slug, nextBeats);
      assignMetric(`user:${slug}:heart_beats`, nextBeats);

      // Only record heart_rate if device is actively broadcasting valid HR
      // Null was already recorded above for users who stopped broadcasting
      if (!hasValidHR) {
        // No valid HR data - skip recording other metrics too
        return;
      }
      
      // Track this participant as active (has valid HR data)
      activeParticipantIds.add(slug);
      
      assignMetric(`user:${slug}:heart_rate`, entry.metrics.heartRate);
      assignMetric(`user:${slug}:zone_id`, entry.metrics.zoneId);
      assignMetric(`user:${slug}:rpm`, entry.metrics.rpm);
      assignMetric(`user:${slug}:power`, entry.metrics.power);
      assignMetric(`user:${slug}:distance`, entry.metrics.distance);
    });
    
    // Update ActivityMonitor with current tick's activity (Phase 2 - single source of truth)
    if (this.activityMonitor) {
      this.activityMonitor.recordTick(currentTickIndex, activeParticipantIds, { timestamp });
    }

    // Ensure every roster user gets a baseline coins_total=0 once (even if inactive)
    // so the chart has a series to render and can show dropout immediately.
    if (!this._usersWithCoinsRecorded) this._usersWithCoinsRecorded = new Set();
    userMetricMap.forEach((_, slug) => {
      if (!this._usersWithCoinsRecorded.has(slug)) {
        assignMetric(`user:${slug}:coins_total`, 0);
        this._usersWithCoinsRecorded.add(slug);
      }
    });

    // Process TreasureBox coin intervals SYNCHRONOUSLY during session tick
    // This ensures coin awards are aligned with activity detection (no race conditions)
    if (this.treasureBox) {
      this.treasureBox.processTick(currentTickIndex, currentTickActiveHR, { slugifyId });
      
      const treasureSummary = this.treasureBox.summary;
      if (treasureSummary) {
        assignMetric('global:coins_total', treasureSummary.totalCoins);
      }
      const perUserCoinTotals = typeof this.treasureBox.getPerUserTotals === 'function'
        ? this.treasureBox.getPerUserTotals()
        : null;
      if (perUserCoinTotals && typeof perUserCoinTotals.forEach === 'function') {
        // Track users who have had their first coin value recorded (to ensure all start at 0)
        if (!this._usersWithCoinsRecorded) this._usersWithCoinsRecorded = new Set();
        
        perUserCoinTotals.forEach((coins, userName) => {
          if (!userName) return;
          const slug = slugifyId(userName);
          if (!slug) return;
          // Only record coins_total if user's device is actively broadcasting HR
          // During dropout, we DON'T want to record new coin values - the chart should stay flat
          if (currentTickActiveHR.has(slug)) {
            // GUARDRAIL: For each user's first tick, ensure coins start at 0
            // This anchors all race chart lines to origin (0, 0)
            if (!this._usersWithCoinsRecorded.has(slug)) {
              // First time recording this user's coins: always 0
              assignMetric(`user:${slug}:coins_total`, 0);
              this._usersWithCoinsRecorded.add(slug);
            } else {
              // Subsequent ticks: record actual coin value from TreasureBox
              // Note: Frozen coins hack removed (Priority 3)
              // TreasureBox no longer awards coins during dropout because:
              // 1. processTick() only processes active participants (Priority 1)
              // 2. _awardCoins() checks ActivityMonitor.isActive() (Priority 2)
              const coinValue = Number.isFinite(coins) ? coins : null;
              assignMetric(`user:${slug}:coins_total`, coinValue);
            }
          }
          // Note: NOT recording coins during dropout means the timeline won't have a value
          // This is intentional - the chart will use the last known value (flat line)
        });
      }
    }

    if (this._pendingSnapshotRef) {
      assignMetric('global:snapshot_ref', this._pendingSnapshotRef);
      this._pendingSnapshotRef = null;
    }

    validateTickPayloadKeys();
    const tickResult = this.timeline.tick(tickPayload, { timestamp });
    this.timebase.intervalCount = this.timeline.timebase.tickCount;
    this.timebase.intervalMs = this.timeline.timebase.intervalMs;
    this.timebase.startAbsMs = this.timeline.timebase.startTime;
    this.timebase.lastTickTimestamp = this.timeline.timebase.lastTickTimestamp;
    this._maybeLogTimelineTelemetry();
    
    // DEBUG: Log timeline series state for dropout debugging
    // Log every 5 ticks to reduce spam but still capture state over time
    if (currentTickIndex % 5 === 0 || currentTickIndex < 3) {
      this._logTimelineDebug(currentTickIndex, currentTickActiveHR);
    }
    
    return tickResult;
  }
  
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
    
    const now = Date.now();
    this.endTime = now;
    this._collectTimelineTick({ timestamp: now });
    this._log('end', { 
      sessionId: this.sessionId, 
      durationMs: this.endTime - this.startTime,
      reason 
    });
    
    let sessionData = null;
    try {
      if (this.treasureBox) this.treasureBox.stop();
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
    this._stopAutosaveTimer();
    this._stopTickTimer(); // 6A: Also stop tick timer on reset
    this._lastAutosaveAt = 0;
    this._emptyRosterStartTime = null; // 6A: Reset empty roster tracking
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
  }

  _encodeSeries(series = {}, tickCount = null) {
    const encodeValue = (key, value) => {
      if (value == null) return null;
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
        if (last && last[0] === value) {
          last[1] += 1;
        } else {
          encoded.push([value, 1]);
        }
      }
      return encoded;
    };

    const encodedSeries = {};
    const seriesMeta = {};
    Object.entries(series).forEach(([key, arr]) => {
      if (!Array.isArray(arr)) {
        encodedSeries[key] = arr;
        return;
      }
      const rle = runLengthEncode(key, arr);
      encodedSeries[key] = JSON.stringify(rle);
      seriesMeta[key] = {
        encoding: 'rle',
        originalLength: arr.length,
        encodedLength: rle.length,
        tickCount
      };
    });
    return { encodedSeries, seriesMeta };
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
    const tickCount = Number(sessionData.timeline?.timebase?.tickCount);
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

    // Drop completely empty signals (all null/zero) per series and warn instead of failing the whole session
    const emptySeriesEntries = [];
    Object.entries(series).forEach(([key, arr]) => {
      if (!Array.isArray(arr) || arr.length === 0) return;
      const allEmpty = arr.every((v) => v == null || v === 0);
      if (allEmpty) {
        emptySeriesEntries.push({ key, length: arr.length });
        delete series[key];
      }
    });
    if (emptySeriesEntries.length) {
      sessionData._persistWarnings = sessionData._persistWarnings || [];
      emptySeriesEntries.forEach((entry) => {
        sessionData._persistWarnings.push({ reason: 'series-empty-signal', ...entry });
      });
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

  _persistSession(sessionData, { force = false } = {}) {
    if (!sessionData) return;
    if (this._saveTriggered && !force) return;
    const validation = this._validateSessionPayload(sessionData);
    if (!validation?.ok) {
      this._log('persist_validation_fail', { reason: validation.reason, detail: validation });
      return false;
    }
    if (Array.isArray(sessionData._persistWarnings) && sessionData._persistWarnings.length) {
      sessionData._persistWarnings.forEach((warn) => {
        this._log('persist_validation_warn', warn);
      });
    }
    // Encode series for compact, deterministic storage while keeping readability (stringified RLE)
    if (sessionData.timeline && sessionData.timeline.series) {
      const tickCount = Number(sessionData.timeline?.timebase?.tickCount);
      const rawSeries = sessionData.timeline.series;
      const rawKeys = rawSeries && typeof rawSeries === 'object' ? Object.keys(rawSeries) : [];
      this._log('persist_series_encode_before', {
        sessionId: sessionData.sessionId || this.sessionId,
        seriesCount: rawKeys.length,
        tickCount,
        sampleKeys: rawKeys.slice(0, 5)
      });
      const { encodedSeries, seriesMeta } = this._encodeSeries(sessionData.timeline.series, tickCount);
      const encodedKeys = Object.keys(encodedSeries || {});
      const droppedKeys = rawKeys.filter((key) => !Object.prototype.hasOwnProperty.call(encodedSeries || {}, key));
      this._log('persist_series_encode_after', {
        sessionId: sessionData.sessionId || this.sessionId,
        encodedCount: encodedKeys.length,
        droppedKeys: droppedKeys.slice(0, 5),
        wasEmpty: encodedKeys.length === 0,
        tickCount
      });
      sessionData.timeline.series = encodedSeries;
      sessionData.timeline.seriesMeta = seriesMeta;
    }
    this._lastAutosaveAt = Date.now();
    this._saveTriggered = true;
    const persistFn = this._persistApi || DaylightAPI;
    persistFn('api/fitness/save_session', { sessionData }, 'POST')
    .then(resp => {
      // console.log('Fitness session saved', resp);
    }).catch(err => {
      // console.error('Failed to save fitness session', err);
    }).finally(() => {
      this._saveTriggered = false;
    });
    return true;
  }

  _startTickTimer() {
    this._stopTickTimer();
    const interval = this.timeline?.timebase.intervalMs || this._tickIntervalMs;
    if (!(interval > 0)) return;
    this._tickTimer = setInterval(() => {
      try {
        this._collectTimelineTick();
        // 6A: Check for empty roster timeout after each tick
        this._checkEmptyRosterTimeout();
      } catch (_) {
        // swallow to keep timer alive
      }
    }, interval);
  }

  _stopTickTimer() {
    if (this._tickTimer) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
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
      if (this._saveTriggered) return;
      const now = Date.now();
      if (this._lastAutosaveAt && (now - this._lastAutosaveAt) < this._autosaveIntervalMs) return;
    }
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
        return {
          sessionId: this.sessionId,
          startTime,
          endTime: derivedEndTime,
          durationMs,
          roster: this.roster,
          deviceAssignments,
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
    snapshot.forEach((entry) => {
      if (!entry) return;
      const slug = entry.occupantSlug || null;
      const user = slug ? this.userManager.getUser(slug) : null;
      const boundDeviceId = user?.hrDeviceId ? String(user.hrDeviceId) : null;
      const deviceMatches = boundDeviceId === entry.deviceId;
      if (!user || !deviceMatches) {
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
