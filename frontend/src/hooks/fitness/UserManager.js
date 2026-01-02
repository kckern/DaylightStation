import { resolveDisplayLabel, buildZoneConfig, deriveZoneProgressSnapshot } from './types.js';

export class User {
  constructor(name, birthyear, hrDeviceId = null, cadenceDeviceId = null, options = {}) {
    const { id: configuredId, globalZones, zoneOverrides, groupLabel, source, category, avatarUrl } = options;
    // ID must be explicitly provided - never derive from name
    if (!configuredId) {
      console.warn('[User] No id provided for user, using name as fallback:', name);
    }
    this.id = configuredId ? String(configuredId) : String(name).toLowerCase().replace(/\s+/g, '_');
    this.name = name;
    this.birthyear = birthyear;
    this.hrDeviceId = hrDeviceId;
    this.cadenceDeviceId = cadenceDeviceId;
    this.groupLabel = groupLabel || null; // e.g., "Dad", "Mom", etc.
    this.source = source || null; // e.g., "Primary", "Secondary", "Guest"
    this.category = category || null; // e.g., "Family", "Friend"
    this.avatarUrl = avatarUrl || null;
    this.age = new Date().getFullYear() - (birthyear || new Date().getFullYear());
    this.zoneConfig = buildZoneConfig(globalZones, zoneOverrides);
    this.zoneSnapshot = deriveZoneProgressSnapshot({ zoneConfig: this.zoneConfig, heartRate: 0 });
    this.currentData = this.#createDefaultCurrentData(this.zoneSnapshot);
    this._cumulativeData = {
      heartRate: { readings: [], avgHR: 0, maxHR: 0, minHR: 0, zones: this.#createZoneBuckets() },
      cadence: { readings: [], avgRPM: 0, maxRPM: 0, totalRevolutions: 0 },
      power: { readings: [], avgPower: 0, maxPower: 0, totalWork: 0 },
      distance: { total: 0, sessions: [] },
      sessionStartTime: null,
      totalWorkoutTime: 0
    };
  }

  #createZoneBuckets() {
    if (!Array.isArray(this.zoneConfig) || this.zoneConfig.length === 0) {
      return {};
    }
    return this.zoneConfig.reduce((acc, zone) => {
      acc[zone.id] = 0;
      return acc;
    }, {});
  }

  #createDefaultCurrentData(snapshot = null) {
    const zoneSnapshot = snapshot
      || deriveZoneProgressSnapshot({ zoneConfig: this.zoneConfig, heartRate: 0 })
      || null;
    const firstZone = Array.isArray(this.zoneConfig) && this.zoneConfig.length > 0 ? this.zoneConfig[0] : null;
    return {
      heartRate: zoneSnapshot?.currentHR ?? 0,
      zone: zoneSnapshot?.currentZoneId ?? firstZone?.id ?? null,
      zoneName: zoneSnapshot?.currentZoneName ?? firstZone?.name ?? null,
      color: zoneSnapshot?.currentZoneColor ?? firstZone?.color ?? null,
      progressToNextZone: zoneSnapshot?.progress ?? 0,
      nextZoneId: zoneSnapshot?.nextZoneId ?? null,
      rangeMin: zoneSnapshot?.rangeMin ?? null,
      rangeMax: zoneSnapshot?.rangeMax ?? null,
      targetHeartRate: zoneSnapshot?.targetHeartRate ?? null,
      showProgress: zoneSnapshot?.showBar ?? false
    };
  }

  #updateCurrentData(zoneSnapshot) {
    if (!zoneSnapshot) {
      this.zoneSnapshot = deriveZoneProgressSnapshot({ zoneConfig: this.zoneConfig, heartRate: 0 });
      this.currentData = this.#createDefaultCurrentData(this.zoneSnapshot);
      return;
    }
    this.zoneSnapshot = zoneSnapshot;
    this.currentData = {
      heartRate: zoneSnapshot.currentHR ?? 0,
      zone: zoneSnapshot.currentZoneId ?? null,
      zoneName: zoneSnapshot.currentZoneName ?? null,
      color: zoneSnapshot.currentZoneColor ?? null,
      progressToNextZone: zoneSnapshot.progress ?? 0,
      nextZoneId: zoneSnapshot.nextZoneId ?? null,
      rangeMin: zoneSnapshot.rangeMin ?? null,
      rangeMax: zoneSnapshot.rangeMax ?? null,
      targetHeartRate: zoneSnapshot.targetHeartRate ?? null,
      showProgress: zoneSnapshot.showBar ?? false
    };
  }

  #updateHeartRateData(heartRate) {
    if (!heartRate || heartRate <= 0) {
      this.#updateCurrentData(deriveZoneProgressSnapshot({ zoneConfig: this.zoneConfig, heartRate: 0 }));
      return;
    }

    const hrData = this._cumulativeData.heartRate;
    hrData.readings.push({ value: heartRate, timestamp: new Date() });
    
    if (hrData.readings.length > 1000) {
      hrData.readings = hrData.readings.slice(-1000);
    }

    const validReadings = hrData.readings.map(r => r.value).filter(r => r > 0);
    hrData.avgHR = Math.round(validReadings.reduce((a, b) => a + b, 0) / validReadings.length) || 0;
    hrData.maxHR = Math.max(...validReadings, hrData.maxHR);
    hrData.minHR = hrData.minHR === 0 ? Math.min(...validReadings) : Math.min(...validReadings, hrData.minHR);

    const zoneSnapshot = deriveZoneProgressSnapshot({ zoneConfig: this.zoneConfig, heartRate });
    if (zoneSnapshot?.currentZoneId) {
      const zoneId = zoneSnapshot.currentZoneId;
      hrData.zones[zoneId] = (hrData.zones[zoneId] || 0) + 1;
    }

    this.#updateCurrentData(zoneSnapshot);
  }

  #updateCadenceData(cadence, revolutionCount = 0) {
    if (cadence === undefined || cadence === null) return;

    const cadData = this._cumulativeData.cadence;
    cadData.readings.push({ value: cadence, timestamp: new Date() });
    
    if (cadData.readings.length > 1000) {
      cadData.readings = cadData.readings.slice(-1000);
    }

    const validReadings = cadData.readings.map(r => r.value).filter(r => r >= 0);
    cadData.avgRPM = Math.round(validReadings.reduce((a, b) => a + b, 0) / validReadings.length) || 0;
    cadData.maxRPM = Math.max(...validReadings, cadData.maxRPM);
    
    if (revolutionCount > cadData.totalRevolutions) {
      cadData.totalRevolutions = revolutionCount;
    }
  }

  #updatePowerData(power) {
    if (!power || power <= 0) return;

    const pwrData = this._cumulativeData.power;
    pwrData.readings.push({ value: power, timestamp: new Date() });
    
    if (pwrData.readings.length > 1000) {
      pwrData.readings = pwrData.readings.slice(-1000);
    }

    const validReadings = pwrData.readings.map(r => r.value).filter(r => r > 0);
    pwrData.avgPower = Math.round(validReadings.reduce((a, b) => a + b, 0) / validReadings.length) || 0;
    pwrData.maxPower = Math.max(...validReadings, pwrData.maxPower);
    pwrData.totalWork += power * 1; 
  }

  updateFromDevice(device = {}) {
    if (!this._cumulativeData.sessionStartTime) {
      this._cumulativeData.sessionStartTime = new Date();
    }

    switch (device.type) {
      case 'heart_rate':
        if (String(device.deviceId) === String(this.hrDeviceId)) {
          this.#updateHeartRateData(device.heartRate);
        }
        break;
      case 'cadence':
        if (String(device.deviceId) === String(this.cadenceDeviceId)) {
          this.#updateCadenceData(device.cadence, device.revolutionCount);
        }
        break;
      case 'power':
        this.#updatePowerData(device.power);
        if (device.cadence) {
          this.#updateCadenceData(device.cadence);
        }
        break;
      case 'speed':
        if (device.distance > this._cumulativeData.distance.total) {
          this._cumulativeData.distance.total = device.distance;
        }
        break;
    }
  }

  resetSession() {
    this._cumulativeData.sessionStartTime = null;
    this._cumulativeData.heartRate.readings = [];
    this._cumulativeData.cadence.readings = [];
    this._cumulativeData.power.readings = [];
    this._cumulativeData.distance.sessions.push({
      distance: this._cumulativeData.distance.total,
      timestamp: new Date()
    });
    this.zoneSnapshot = deriveZoneProgressSnapshot({ zoneConfig: this.zoneConfig, heartRate: 0 });
    this.currentData = this.#createDefaultCurrentData(this.zoneSnapshot);
  }

  get summary() {
    return {
      name: this.name,
      age: this.age,
      currentHR: this.currentData.heartRate,
      currentZone: this.currentData.zone,
      currentZoneName: this.currentData.zoneName,
      currentZoneColor: this.currentData.color,
      progressToNextZone: this.currentData.progressToNextZone,
      nextZoneId: this.currentData.nextZoneId ?? null,
      targetHeartRate: this.currentData.targetHeartRate ?? null,
      avgHR: this._cumulativeData.heartRate.avgHR,
      maxHR: this._cumulativeData.heartRate.maxHR,
      currentRPM: this._cumulativeData.cadence.readings.length > 0 ? this._cumulativeData.cadence.readings[this._cumulativeData.cadence.readings.length - 1].value : 0,
      avgRPM: this._cumulativeData.cadence.avgRPM,
      distance: this._cumulativeData.distance.total,
      duration: this._cumulativeData.sessionStartTime ? Math.floor((new Date() - this._cumulativeData.sessionStartTime) / 1000) : 0,
      zones: { ...this._cumulativeData.heartRate.zones }
    };
  }

  getMetricsSnapshot() {
    const latestCadence = this._cumulativeData?.cadence?.readings;
    const latestPower = this._cumulativeData?.power?.readings;
    const recentCadence = Array.isArray(latestCadence) && latestCadence.length > 0
      ? latestCadence[latestCadence.length - 1]?.value
      : null;
    const recentPower = Array.isArray(latestPower) && latestPower.length > 0
      ? latestPower[latestPower.length - 1]?.value
      : null;
    const heartRate = Number.isFinite(this.currentData?.heartRate)
      ? Math.max(0, Math.round(this.currentData.heartRate))
      : null;
    return {
      userId: this.id,
      name: this.name,
      heartRate,
      zoneId: this.currentData?.zone || null,
      zoneColor: this.currentData?.color || null,
      zoneName: this.currentData?.zoneName || null,
      epochMs: Date.now(),
      rpm: Number.isFinite(recentCadence) ? recentCadence : null,
      power: Number.isFinite(recentPower) ? recentPower : null,
      avgRpm: Number.isFinite(this._cumulativeData?.cadence?.avgRPM)
        ? this._cumulativeData.cadence.avgRPM
        : null,
      avgPower: Number.isFinite(this._cumulativeData?.power?.avgPower)
        ? this._cumulativeData.power.avgPower
        : null,
      distance: Number.isFinite(this._cumulativeData?.distance?.total)
        ? this._cumulativeData.distance.total
        : null
    };
  }
}

export class UserManager {
  constructor() {
    this.users = new Map(); // userId -> User
    this.roster = []; // Array of participant objects
    this._defaultZones = null;
    this.assignmentLedger = null;
    this._onLedgerChange = null;
  }

  configure(usersConfig, globalZones) {
    if (!usersConfig) return;
    this._defaultZones = Array.isArray(globalZones) ? globalZones : null;
    
    const processUserList = (list, defaultSource = null, defaultCategory = null) => {
      if (!Array.isArray(list)) return;
      list.forEach(userConfig => {
        if (!userConfig || !userConfig.name) return;
        this.registerUser({
          ...userConfig,
          globalZones,
          source: userConfig.source || defaultSource,
          category: userConfig.category || defaultCategory
        });
      });
    };

    processUserList(usersConfig.primary, 'Primary', 'Family');
    processUserList(usersConfig.secondary, 'Secondary', 'Family');
    processUserList(usersConfig.family, 'Family', 'Family');
    processUserList(usersConfig.friends, 'Friend', 'Friend');
  }

  setAssignmentLedger(ledger, { onChange } = {}) {
    this.assignmentLedger = ledger || null;
    this._onLedgerChange = typeof onChange === 'function' ? onChange : null;
  }

  registerUser(config) {
    // Use the actual ID from config - must be explicitly provided
    const userId = config.id || config.profileId;
    if (!userId) {
      console.warn('[UserManager] registerUser called without id/profileId, using name fallback:', config.name);
    }
    const resolvedUserId = userId || String(config.name).toLowerCase().replace(/\\s+/g, '_');
    console.log('[UserManager] registerUser', { 
      name: config.name, 
      resolvedUserId,
      'config.id': config.id,
      'config.profileId': config.profileId
    });
    const birthYear = config.birth_year ?? config.birthyear ?? config.birthYear ?? null;
    const hrDeviceId = config.hr_device_id ?? config.hr ?? config.hrDeviceId ?? config.deviceId ?? null;
    const cadenceDeviceId = config.cadence_device_id ?? config.cadence ?? config.cadenceDeviceId ?? null;
    const groupLabel = config.group_label ?? config.groupLabel ?? null;
    const source = config.source ?? null;
    const category = config.category ?? null;
    const avatarUrl = config.avatar_url ?? config.avatarUrl ?? null;
    
    if (!this.users.has(resolvedUserId)) {
      const user = new User(config.name, birthYear, hrDeviceId, cadenceDeviceId, {
        id: resolvedUserId,
        globalZones: config.globalZones || this._defaultZones,
        zoneOverrides: config.zones,
        groupLabel,
        source,
        category,
        avatarUrl
      });
      console.log('[UserManager] Created new user:', {
        'config.name': config.name,
        'user.id': user.id,
        'user.name': user.name,
        resolvedUserId
      });
      this.users.set(resolvedUserId, user);
    } else {
      // Update existing user config if needed
      const user = this.users.get(resolvedUserId);
      user.hrDeviceId = hrDeviceId ?? user.hrDeviceId;
      user.cadenceDeviceId = cadenceDeviceId ?? user.cadenceDeviceId;
      user.groupLabel = groupLabel ?? user.groupLabel;
      user.source = source ?? user.source;
      user.category = category ?? user.category;
      user.avatarUrl = avatarUrl ?? user.avatarUrl;
      if (birthYear && user.birthyear !== birthYear) {
        user.birthyear = birthYear;
        user.age = new Date().getFullYear() - birthYear;
      }
      // Could update zones here too
    }
    return this.users.get(resolvedUserId);
  }

  getUser(id) {
    // Direct lookup by ID only - no slug conversion
    return this.users.get(id) || null;
  }

  getUserById(userId) {
    if (!userId) return null;
    // Direct lookup by ID
    return this.users.get(userId) || null;
  }

  getAllUsers() {
    return Array.from(this.users.values());
  }

  setRoster(roster) {
    this.roster = Array.isArray(roster) ? roster : [];
  }

  assignGuest(deviceId, guestName, metadata = {}) {
    if (deviceId == null) return null;

    const key = String(deviceId);

    if (!guestName) {
      if (this.assignmentLedger) {
        const removed = this.assignmentLedger.remove(key);
        if (removed) {
          this.#emitLedgerChange();
        }
      }
      return null;
    }

    const normalizedMetadata = this.#normalizeMetadata(metadata);
    const zones = Array.isArray(normalizedMetadata?.zones) ? normalizedMetadata.zones : null;
    const timestamp = Number.isFinite(normalizedMetadata?.updatedAt) ? normalizedMetadata.updatedAt : Date.now();
    // Use explicit IDs from metadata if available, generate guest ID otherwise
    const baseUserId = normalizedMetadata?.baseUserId || normalizedMetadata?.baseUserName || null;
    const occupantType = normalizedMetadata?.occupantType || 'guest';
    // Generate a guest ID if profileId not provided
    const guestId = normalizedMetadata?.profileId || `guest-${Date.now()}`;
    // Entity ID from GuestAssignmentService (Phase 1 session entity tracking)
    const entityId = normalizedMetadata?.entityId || null;
    const payload = {
      deviceId: key,
      occupantId: guestId,
      occupantSlug: guestId, // Required for cleanupOrphanGuests
      occupantName: guestName,
      occupantType,
      entityId, // Session entity for this assignment
      displacedUserId: baseUserId,
      displacedSlug: baseUserId, // Consistent naming
      overridesHash: zones ? JSON.stringify(zones) : null,
      metadata: {
        ...normalizedMetadata,
        name: guestName,
        profileId: guestId,
        entityId,
        updatedAt: timestamp
      },
      updatedAt: timestamp
    };

    if (this.assignmentLedger) {
      this.assignmentLedger.upsert(payload);
      this.#emitLedgerChange();
    }

    // Ensure no other user claims this device (fix for flickering/ghost users)
    for (const user of this.users.values()) {
      if (String(user.hrDeviceId) === key && user.id !== guestId) {
        console.log('[UserManager] Unclaiming device from previous user:', {
          deviceId: key,
          previousUser: user.name,
          newUser: guestName
        });
        user.hrDeviceId = null;
      }
    }

    const guestUser = this.#ensureUserFromAssignment({
      name: guestName,
      deviceId: key,
      zones,
      profileId: normalizedMetadata?.profileId,
      occupantType
    });
    if (guestUser) {
      guestUser.hrDeviceId = key;
    }
    return payload;
  }

  clearGuestAssignment(deviceId) {
    this.assignGuest(deviceId, null);
  }

  getGuestNameForDevice(deviceId) {
    const entry = this.assignmentLedger?.get?.(deviceId);
    if (!entry) return null;
    if (entry.occupantType && entry.occupantType !== 'guest') return null;
    return entry.occupantName || entry.metadata?.name || null;
  }

  resolveUserForDevice(deviceId) {
    const idStr = String(deviceId);
    const ledgerEntry = this.assignmentLedger?.get?.(idStr);
    const ledgerName = ledgerEntry?.occupantName || ledgerEntry?.metadata?.name || null;
    if (ledgerName) {
      const zones = Array.isArray(ledgerEntry?.metadata?.zones) ? ledgerEntry.metadata.zones : null;
      const profileId = ledgerEntry?.metadata?.profileId ?? ledgerEntry?.metadata?.profile_id ?? null;
      const occupantType = ledgerEntry?.occupantType || 'guest';
      const user = this.#ensureUserFromAssignment({
        name: ledgerName,
        deviceId: idStr,
        zones,
        profileId,
        occupantType
      });
      if (user && !user.hrDeviceId) {
        user.hrDeviceId = idStr;
      }
      return user;
    }

    // Check registered users
    for (const user of this.users.values()) {
      if (String(user.hrDeviceId) === idStr || String(user.cadenceDeviceId) === idStr) {
        return user;
      }
    }
    return null;
  }

  #normalizeMetadata(metadata) {
    if (metadata && typeof metadata === 'object') {
      return { ...metadata };
    }
    return {};
  }

  #createLedgerPayload(deviceId, assignment) {
    return null;
  }

  #writeLedgerEntryFromAssignment(deviceId, assignment) {
    return null;
  }

  #removeLedgerEntry(deviceId) {
    if (!this.assignmentLedger) return;
    const removed = this.assignmentLedger.remove(deviceId);
    if (removed) {
      this.#emitLedgerChange();
    }
  }

  #hydrateLedgerFromAssignments() {
    return null;
  }

  #emitLedgerChange() {
    if (typeof this._onLedgerChange === 'function') {
      this._onLedgerChange();
    }
  }

  #ensureUserFromAssignment({ name, deviceId, zones, profileId, occupantType = 'guest' }) {
    if (!name) return null;
    
    // Use profileId if available, otherwise generate a guest ID
    const userId = profileId || `guest-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let user = null;

    if (profileId != null) {
      user = this.getUserById(profileId);
    }

    if (!user) {
      user = this.users.get(userId) || null;
    }

    if (!user) {
      user = new User(name, null, deviceId, null, {
        id: userId,
        globalZones: this._defaultZones,
        zoneOverrides: zones || null,
        source: occupantType === 'guest' ? 'Guest' : null,
        category: occupantType === 'guest' ? 'Guest' : null
      });
      this.users.set(userId, user);
      return user;
    }

    if (zones && Array.isArray(this._defaultZones)) {
      user.zoneConfig = buildZoneConfig(this._defaultZones, zones);
    }
    if (deviceId && !user.hrDeviceId) {
      user.hrDeviceId = String(deviceId);
    }
    return user;
  }

  #buildUserDescriptor(user) {
    if (!user) return null;
    return {
      id: user.id,
      name: user.name,
      profileId: user.id,
      groupLabel: user.groupLabel || null,
      source: user.source || null,
      category: user.category || user.source || null,
      avatarUrl: user.avatarUrl || null,
      hrDeviceId: user.hrDeviceId ? String(user.hrDeviceId) : null,
      cadenceDeviceId: user.cadenceDeviceId ? String(user.cadenceDeviceId) : null
    };
  }

  getUserCollections() {
    const collections = {
      primary: [],
      secondary: [],
      family: [],
      friends: [],
      other: [],
      all: []
    };
    this.users.forEach((user) => {
      const descriptor = this.#buildUserDescriptor(user);
      if (!descriptor) return;
      const category = (descriptor.category || descriptor.source || '').toLowerCase();
      switch (category) {
        case 'primary':
          collections.primary.push(descriptor);
          break;
        case 'secondary':
          collections.secondary.push(descriptor);
          break;
        case 'family':
          collections.family.push(descriptor);
          break;
        case 'friend':
          collections.friends.push(descriptor);
          break;
        default:
          collections.other.push(descriptor);
          break;
      }
      collections.all.push(descriptor);
    });
    return collections;
  }

  getDeviceOwnership() {
    const owners = {
      heartRate: new Map(),
      cadence: new Map()
    };
    this.users.forEach((user) => {
      const descriptor = this.#buildUserDescriptor(user);
      if (!descriptor) return;
      if (descriptor.hrDeviceId) {
        owners.heartRate.set(descriptor.hrDeviceId, descriptor);
      }
      if (descriptor.cadenceDeviceId) {
        owners.cadence.set(descriptor.cadenceDeviceId, descriptor);
      }
    });
    return owners;
  }

  getGuestCandidates() {
    const collections = this.getUserCollections();
    return [
      ...collections.family,
      ...collections.friends,
      ...collections.secondary,
      ...collections.other
    ].map((descriptor) => ({
      ...descriptor,
      allowWhileAssigned: descriptor.source === 'Friend'
    }));
  }

  getUserZoneProfiles() {
    const profiles = new Map();
    this.users.forEach((user) => {
      if (!user?.id) return;
      profiles.set(user.id, {
        name: user.name,
        zoneConfig: user.zoneConfig,
        zoneSnapshot: user.zoneSnapshot
      });
    });
    return profiles;
  }

  resetAllSessions() {
    this.users.forEach((user) => {
      if (typeof user?.resetSession === 'function') {
        user.resetSession();
      }
    });
  }
}
