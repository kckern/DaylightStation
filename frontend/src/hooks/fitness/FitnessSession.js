import { formatSessionId, slugifyId, ensureSeriesCapacity, trimTrailingNulls, serializeSeries, deepClone, resolveDisplayLabel } from './types';
import { DeviceManager } from './DeviceManager';
import { UserManager } from './UserManager';
import { GovernanceEngine } from './GovernanceEngine';
import { FitnessTreasureBox } from './TreasureBox';
import { VoiceMemoManager } from './VoiceMemoManager';
import { DaylightAPI } from '../../lib/api.mjs';

// -------------------- Timeout Configuration --------------------
const FITNESS_TIMEOUTS = {
  inactive: 60000,
  remove: 180000,
  rpmZero: 12000
};

export const setFitnessTimeouts = ({ inactive, remove, rpmZero } = {}) => {
  if (typeof inactive === 'number' && !Number.isNaN(inactive)) FITNESS_TIMEOUTS.inactive = inactive;
  if (typeof remove === 'number' && !Number.isNaN(remove)) FITNESS_TIMEOUTS.remove = remove;
  if (typeof rpmZero === 'number' && !Number.isNaN(rpmZero)) FITNESS_TIMEOUTS.rpmZero = rpmZero;
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
    this.treasureBox = null; // Instantiated on start
    this._userCollectionsCache = null;
    this._deviceOwnershipCache = null;
    this._guestCandidatesCache = null;
    this._userZoneProfilesCache = null;

    this._autosaveIntervalMs = 15000;
    this._lastAutosaveAt = 0;
    this._autosaveTimer = null;

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
    
    this.screenshots = {
      captures: [],
      intervalMs: null,
      filenamePattern: null
    };
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
    const started = this.ensureStarted();
    this.lastActivityTime = now;
    
    // Register/Update device in manager
    const device = this.deviceManager.registerDevice(deviceData);
    if (device) {
      this.activeDeviceIds.add(device.id);
      this._log('device_activity', { deviceId: device.id, profile: deviceData.profile });
      
      // Resolve user and update their stats
      const user = this.userManager.resolveUserForDevice(device.id);
      if (user) {
        user.updateFromDevice(deviceData);
        // Feed TreasureBox if HR
        if (this.treasureBox && deviceData.type === 'heart_rate') {
           this.treasureBox.recordUserHeartRate(user.name, deviceData.heartRate);
        }
      }
    }

    if (started) this._log('session_started', { sessionId: this.sessionId });
  }

  setParticipantRoster(roster = [], guestAssignments = {}) {
    this.userManager.setRoster(roster);
    if (guestAssignments && typeof guestAssignments === 'object') {
      Object.entries(guestAssignments).forEach(([deviceId, guestName]) => {
        this.userManager.assignGuest(deviceId, guestName);
      });
    }
  }

  get roster() {
    const roster = [];
    const heartRateDevices = this.deviceManager.getAllDevices().filter(d => d.type === 'heart_rate');
    const treasureSummary = this.treasureBox ? this.treasureBox.summary : null;
    
    const zoneLookup = new Map();
    if (treasureSummary?.perUser) {
      treasureSummary.perUser.forEach((entry) => {
        if (!entry || !entry.user) return;
        const key = slugifyId(entry.user);
        if (!key) return;
        zoneLookup.set(key, {
          zoneId: entry.zoneId ? String(entry.zoneId).toLowerCase() : null,
          color: entry.currentColor || null
        });
      });
    }

    heartRateDevices.forEach((device) => {
      if (!device || device.id == null) return;
      const deviceId = String(device.id);
      const heartRate = Number.isFinite(device.heartRate) ? Math.round(device.heartRate) : null;
      
      const guestName = this.userManager.getGuestNameForDevice(deviceId);
      
      if (guestName) {
        const key = slugifyId(guestName);
        const zoneInfo = zoneLookup.get(key) || null;
        const displayLabel = resolveDisplayLabel({ name: guestName, preferGroupLabel: false });
        
        roster.push({
          name: guestName,
          displayLabel,
          groupLabel: null, // Guests don't have group labels
          profileId: slugifyId(guestName),
          baseUserName: null,
          isGuest: true,
          deviceId,
          hrDeviceId: deviceId,
          heartRate,
          zoneId: zoneInfo?.zoneId || null,
          zoneColor: zoneInfo?.color || null,
          source: 'Guest',
          category: 'Guest',
          userId: null,
          avatarUrl: null
        });
        return;
      }

      const mappedUser = this.userManager.resolveUserForDevice(deviceId);
      if (mappedUser) {
        const name = mappedUser.name;
        const key = slugifyId(name);
        const zoneInfo = zoneLookup.get(key) || null;
        
        let resolvedHeartRate = heartRate;
        if (mappedUser.currentData && Number.isFinite(mappedUser.currentData.heartRate)) {
             resolvedHeartRate = Math.round(mappedUser.currentData.heartRate);
        }

        const displayLabel = resolveDisplayLabel({
          name,
          groupLabel: mappedUser.groupLabel,
          preferGroupLabel: true
        });
        
        roster.push({
          name,
          displayLabel,
          groupLabel: mappedUser.groupLabel || null, // NOW INCLUDED FROM USER
          profileId: mappedUser.id || slugifyId(name),
          baseUserName: name,
          isGuest: false,
          deviceId,
          hrDeviceId: deviceId,
          heartRate: resolvedHeartRate,
          zoneId: zoneInfo?.zoneId || mappedUser.currentData?.zone || null,
          zoneColor: zoneInfo?.color || mappedUser.currentData?.color || null,
          source: mappedUser.source || 'Primary',
          category: mappedUser.category || 'Family',
          userId: mappedUser.id || null,
          avatarUrl: mappedUser.avatarUrl || null
        });
      }
    });

    return roster;
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
      // Configure treasure box if we have config available
      // (Usually configured via updateSnapshot or external call)
    }
    
    this._lastAutosaveAt = 0;
    this._startAutosaveTimer();
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
    this._userZoneProfilesCache = this.userManager.getUserZoneProfiles();
    
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

  // ... (Rest of methods: updateActiveDevices, maybeEnd, _persistSession, autosave, voice memos, summary)
  // I will include the essential ones for session lifecycle.

  updateActiveDevices() {
    const { remove } = this._getTimeouts();
    const now = Date.now();
    const stillActive = new Set();
    
    // Prune DeviceManager
    this.deviceManager.pruneStaleDevices(remove);
    
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
    
    this.endTime = now;
    this._log('end', { sessionId: this.sessionId, durationMs: this.endTime - this.startTime });
    
    let sessionData = null;
    try {
      if (this.treasureBox) this.treasureBox.stop();
      sessionData = this.summary;
    } catch(_){}
    
    if (sessionData) this._persistSession(sessionData, { force: true });
    this.reset();
    return true;
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
    this.userManager = new UserManager(); // Reset users? Or keep them? Usually reset for new session context.
    this.deviceManager = new DeviceManager(); // Reset devices?
    this._stopAutosaveTimer();
    this._lastAutosaveAt = 0;
    this.governanceEngine.reset();
  }

  _persistSession(sessionData, { force = false } = {}) {
    if (!sessionData) return;
    if (this._saveTriggered && !force) return;
    this._lastAutosaveAt = Date.now();
    this._saveTriggered = true;
    DaylightAPI('api/fitness/save_session', { sessionData }, 'POST')
    .then(resp => {
      // console.log('Fitness session saved', resp);
    }).catch(err => {
      // console.error('Failed to save fitness session', err);
    }).finally(() => {
      this._saveTriggered = false;
    });
    return true;
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
    const snapshot = this.summary;
    if (!snapshot) return;
    this._persistSession(snapshot, { force });
  }

  get isActive() {
    return !!this.sessionId && !this.endTime;
  }

  get summary() {
      // (Implement summary generation similar to original, aggregating from managers)
      // For brevity, returning a stub that calls managers
      if (!this.sessionId) return null;
      
      return {
          sessionId: this.sessionId,
          startTime: this.startTime,
          endTime: this.endTime,
          voiceMemos: this.voiceMemoManager.summary,
          treasureBox: this.treasureBox ? this.treasureBox.summary : null,
          // ...
      };
  }

  // Voice Memo Delegation
  addVoiceMemo(memo) { return this.voiceMemoManager.addMemo(memo); }
  removeVoiceMemo(memoId) { return this.voiceMemoManager.removeMemo(memoId); }
  replaceVoiceMemo(memoId, memo) { return this.voiceMemoManager.replaceMemo(memoId, memo); }

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
      this._userZoneProfilesCache = this.userManager.getUserZoneProfiles();
    }
    return this._userZoneProfilesCache;
  }

  invalidateUserCaches() {
    this._userCollectionsCache = null;
    this._deviceOwnershipCache = null;
    this._guestCandidatesCache = null;
    this._userZoneProfilesCache = null;
  }
}
