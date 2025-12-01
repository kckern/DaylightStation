import { slugifyId, resolveDisplayLabel, buildZoneConfig, deriveZoneProgressSnapshot } from './types';

export class User {
  constructor(name, birthyear, hrDeviceId = null, cadenceDeviceId = null, options = {}) {
    const { id: configuredId, globalZones, zoneOverrides, groupLabel, source, category, avatarUrl } = options;
    this.id = configuredId ? String(configuredId) : slugifyId(name);
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
}

export class UserManager {
  constructor() {
    this.users = new Map(); // userId -> User
    this.roster = []; // Array of participant objects
    this.guestAssignments = new Map(); // deviceId -> guestName
  }

  configure(usersConfig, globalZones) {
    if (!usersConfig) return;
    
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

  registerUser(config) {
    const id = slugifyId(config.name);
    const birthYear = config.birth_year ?? config.birthyear ?? config.birthYear ?? null;
    const hrDeviceId = config.hr_device_id ?? config.hr ?? config.hrDeviceId ?? config.deviceId ?? null;
    const cadenceDeviceId = config.cadence_device_id ?? config.cadence ?? config.cadenceDeviceId ?? null;
    const groupLabel = config.group_label ?? config.groupLabel ?? null;
    const source = config.source ?? null;
    const category = config.category ?? null;
    const avatarUrl = config.avatar_url ?? config.avatarUrl ?? null;
    
    if (!this.users.has(id)) {
      const user = new User(config.name, birthYear, hrDeviceId, cadenceDeviceId, {
        id: config.id,
        globalZones: config.globalZones,
        zoneOverrides: config.zones,
        groupLabel,
        source,
        category,
        avatarUrl
      });
      this.users.set(id, user);
    } else {
      // Update existing user config if needed
      const user = this.users.get(id);
      user.hrDeviceId = hrDeviceId ?? user.hrDeviceId;
      user.cadenceDeviceId = cadenceDeviceId ?? user.cadenceDeviceId;
      user.groupLabel = groupLabel ?? user.groupLabel;
      user.source = source ?? user.source;
      user.category = category ?? user.category;
      user.avatarUrl = avatarUrl ?? user.avatarUrl;
      if (config.id) {
        user.id = String(config.id);
      }
      if (birthYear && user.birthyear !== birthYear) {
        user.birthyear = birthYear;
        user.age = new Date().getFullYear() - birthYear;
      }
      // Could update zones here too
    }
    return this.users.get(id);
  }

  getUser(id) {
    return this.users.get(slugifyId(id));
  }

  getAllUsers() {
    return Array.from(this.users.values());
  }

  setRoster(roster) {
    this.roster = Array.isArray(roster) ? roster : [];
  }

  assignGuest(deviceId, guestName, metadata = {}) {
    this.guestAssignments.set(String(deviceId), { name: guestName, ...metadata });
  }

  clearGuestAssignment(deviceId) {
    this.guestAssignments.delete(String(deviceId));
  }

  getGuestNameForDevice(deviceId) {
    const entry = this.guestAssignments.get(String(deviceId));
    return entry?.name || (typeof entry === 'string' ? entry : null);
  }

  resolveUserForDevice(deviceId) {
    const idStr = String(deviceId);
    
    // Check guest assignments first
    const guestEntry = this.guestAssignments.get(idStr);
    const guestName = guestEntry?.name || (typeof guestEntry === 'string' ? guestEntry : null);
    
    if (guestName) {
      // Return a temporary user-like object or look up if we created a guest user
      // For now, let's assume we might have a guest user registered or we return a stub
      let guestUser = this.getUser(guestName);
      if (!guestUser) {
         // Create ad-hoc guest user if not exists
         guestUser = new User(guestName, null, deviceId, null, {});
         this.users.set(slugifyId(guestName), guestUser);
      }
      return guestUser;
    }

    // Check registered users
    for (const user of this.users.values()) {
      if (String(user.hrDeviceId) === idStr || String(user.cadenceDeviceId) === idStr) {
        return user;
      }
    }
    return null;
  }

  #buildUserDescriptor(user) {
    if (!user) return null;
    const slug = slugifyId(user.name);
    return {
      id: user.id || slug,
      name: user.name,
      slug,
      profileId: user.id || slug,
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
      if (!user?.name) return;
      profiles.set(slugifyId(user.name), {
        name: user.name,
        zoneConfig: user.zoneConfig,
        zoneSnapshot: user.zoneSnapshot
      });
    });
    return profiles;
  }
}
