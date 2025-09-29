import { useState, useEffect, useRef } from 'react';

/**
 * Base Device class for all ANT+ fitness devices
 */
// -------------------- Timeout Configuration --------------------
// Defaults match previous hardcoded values (60s inactive, 180s removal)
const FITNESS_TIMEOUTS = {
  inactive: 60000,
  remove: 180000
};

// Setter to override timeouts from external configuration
export const setFitnessTimeouts = ({ inactive, remove } = {}) => {
  if (typeof inactive === 'number' && !Number.isNaN(inactive)) {
    FITNESS_TIMEOUTS.inactive = inactive;
  }
  if (typeof remove === 'number' && !Number.isNaN(remove)) {
    FITNESS_TIMEOUTS.remove = remove;
  }
};

// Getter (useful for context cleanup loop)
export const getFitnessTimeouts = () => ({ ...FITNESS_TIMEOUTS });

class Device {
  constructor(deviceId, profile, rawData = {}) {
    this.deviceId = String(deviceId);
    this.profile = profile;
    this.dongleIndex = rawData.dongleIndex;
    this.timestamp = rawData.timestamp;
    this.lastSeen = new Date();
    this.isActive = true;
    this.batteryLevel = rawData.BatteryLevel;
    this.batteryVoltage = rawData.BatteryVoltage;
    this.serialNumber = rawData.SerialNumber;
    this.manufacturerId = rawData.ManId;
    this.rawData = rawData;
  }

  updateData(rawData) {
    this.lastSeen = new Date();
    this.isActive = true;
    this.batteryLevel = rawData.BatteryLevel;
    this.batteryVoltage = rawData.BatteryVoltage;
    this.timestamp = rawData.timestamp;
    this.rawData = rawData;
  }

  isInactive(timeoutMs = FITNESS_TIMEOUTS.inactive) {
    return (new Date() - this.lastSeen) > timeoutMs;
  }

  shouldBeRemoved(timeoutMs = FITNESS_TIMEOUTS.remove) {
    return (new Date() - this.lastSeen) > timeoutMs;
  }
}

/**
 * Heart Rate Device class
 */
class HeartRateDevice extends Device {
  constructor(deviceId, rawData = {}) {
    super(deviceId, 'HR', rawData);
    this.type = 'heart_rate';
    this.heartRate = rawData.ComputedHeartRate || 0;
    this.beatCount = rawData.BeatCount || 0;
    this.beatTime = rawData.BeatTime || 0;
  }

  updateData(rawData) {
    super.updateData(rawData);
    this.heartRate = rawData.ComputedHeartRate || 0;
    this.beatCount = rawData.BeatCount || 0;
    this.beatTime = rawData.BeatTime || 0;
  }
}

/**
 * Speed Device class (classic speed monitoring)
 */
class SpeedDevice extends Device {
  constructor(deviceId, rawData = {}) {
    super(deviceId, 'Speed', rawData);
    this.type = 'speed';
    this.speed = rawData.CalculatedSpeed || 0; // m/s
    this.speedKmh = rawData.CalculatedSpeed ? (rawData.CalculatedSpeed * 3.6) : 0;
    this.distance = rawData.CalculatedDistance || 0;
    this.revolutionCount = rawData.CumulativeSpeedRevolutionCount || 0;
    this.eventTime = rawData.SpeedEventTime || 0;
  }

  updateData(rawData) {
    super.updateData(rawData);
    this.speed = rawData.CalculatedSpeed || 0;
    this.speedKmh = rawData.CalculatedSpeed ? (rawData.CalculatedSpeed * 3.6) : 0;
    this.distance = rawData.CalculatedDistance || 0;
    this.revolutionCount = rawData.CumulativeSpeedRevolutionCount || 0;
    this.eventTime = rawData.SpeedEventTime || 0;
  }
}

/**
 * Cadence Device class
 */
class CadenceDevice extends Device {
  constructor(deviceId, rawData = {}) {
    super(deviceId, 'CAD', rawData);
    this.type = 'cadence';
    this.cadence = Math.round(rawData.CalculatedCadence || 0);
    this.revolutionCount = rawData.CumulativeCadenceRevolutionCount || 0;
    this.eventTime = rawData.CadenceEventTime || 0;
  }

  updateData(rawData) {
    super.updateData(rawData);
    this.cadence = Math.round(rawData.CalculatedCadence || 0);
    this.revolutionCount = rawData.CumulativeCadenceRevolutionCount || 0;
    this.eventTime = rawData.CadenceEventTime || 0;
  }
}

/**
 * Power Device class
 */
class PowerDevice extends Device {
  constructor(deviceId, rawData = {}) {
    super(deviceId, 'Power', rawData);
    this.type = 'power';
    this.power = rawData.InstantaneousPower || 0; // watts
    // Some power meters also report cadence
    this.cadence = Math.round(rawData.Cadence || rawData.CalculatedCadence || 0);
    this.leftRightBalance = rawData.PedalPowerBalance; // optional
  }

  updateData(rawData) {
    super.updateData(rawData);
    this.power = rawData.InstantaneousPower || 0;
    this.cadence = Math.round(rawData.Cadence || rawData.CalculatedCadence || 0);
    this.leftRightBalance = rawData.PedalPowerBalance;
  }
}

/**
 * Unknown / fallback device class
 */
class UnknownDevice extends Device {
  constructor(deviceId, profile = 'Unknown', rawData = {}) {
    super(deviceId, profile, rawData);
    this.type = 'unknown';
  }
}

/**
 * Factory for creating specific device subclass instances
 */
export class DeviceFactory {
  static createDevice(deviceId, profile, rawData = {}) {
    switch (profile) {
      case 'HR':
        return new HeartRateDevice(deviceId, rawData);
      case 'Speed':
        return new SpeedDevice(deviceId, rawData);
      case 'CAD':
        return new CadenceDevice(deviceId, rawData);
      case 'Power':
        return new PowerDevice(deviceId, rawData);
      default:
        return new UnknownDevice(deviceId, profile, rawData);
    }
  }
}
// -------------------- User Class --------------------
export class User {
  constructor(name, birthyear, hrDeviceId = null, cadenceDeviceId = null) {
    this.name = name;
    this.birthyear = birthyear;
    this.hrDeviceId = hrDeviceId;
    this.cadenceDeviceId = cadenceDeviceId;
    this.age = new Date().getFullYear() - birthyear;
    this._cumulativeData = {
      heartRate: { readings: [], avgHR: 0, maxHR: 0, minHR: 0, zones: { zone1: 0, zone2: 0, zone3: 0, zone4: 0, zone5: 0 } },
      cadence: { readings: [], avgRPM: 0, maxRPM: 0, totalRevolutions: 0 },
      power: { readings: [], avgPower: 0, maxPower: 0, totalWork: 0 },
      distance: { total: 0, sessions: [] },
      sessionStartTime: null,
      totalWorkoutTime: 0
    };
  }

  // Private method to calculate heart rate zones based on age
  #calculateHRZones() {
    const maxHR = 220 - this.age;
    return {
      zone1: { min: Math.round(maxHR * 0.5), max: Math.round(maxHR * 0.6) }, // Recovery
      zone2: { min: Math.round(maxHR * 0.6), max: Math.round(maxHR * 0.7) }, // Aerobic
      zone3: { min: Math.round(maxHR * 0.7), max: Math.round(maxHR * 0.8) }, // Threshold
      zone4: { min: Math.round(maxHR * 0.8), max: Math.round(maxHR * 0.9) }, // VO2 Max
      zone5: { min: Math.round(maxHR * 0.9), max: maxHR } // Anaerobic
    };
  }

  // Private method to determine which HR zone a reading falls into
  #getHRZone(heartRate) {
    const zones = this.#calculateHRZones();
    if (heartRate >= zones.zone5.min) return 'zone5';
    if (heartRate >= zones.zone4.min) return 'zone4';
    if (heartRate >= zones.zone3.min) return 'zone3';
    if (heartRate >= zones.zone2.min) return 'zone2';
    return 'zone1';
  }

  // Private method to update cumulative heart rate data
  #updateHeartRateData(heartRate) {
    if (!heartRate || heartRate <= 0) return;

    const hrData = this._cumulativeData.heartRate;
    hrData.readings.push({ value: heartRate, timestamp: new Date() });
    
    // Keep only last 1000 readings for performance
    if (hrData.readings.length > 1000) {
      hrData.readings = hrData.readings.slice(-1000);
    }

    // Update statistics
    const validReadings = hrData.readings.map(r => r.value).filter(r => r > 0);
    hrData.avgHR = Math.round(validReadings.reduce((a, b) => a + b, 0) / validReadings.length) || 0;
    hrData.maxHR = Math.max(...validReadings, hrData.maxHR);
    hrData.minHR = hrData.minHR === 0 ? Math.min(...validReadings) : Math.min(...validReadings, hrData.minHR);

    // Update zone tracking
    const zone = this.#getHRZone(heartRate);
    hrData.zones[zone]++;
  }

  // Private method to update cumulative cadence data
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

  // Private method to update cumulative power data
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
    
    // Estimate work (power * time) - simplified calculation
    pwrData.totalWork += power * 1; // Assuming 1 second intervals
  }

  // Public method to update user data from device
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

  // Public getters for accessing cumulative data
  get currentHeartRate() {
    const readings = this._cumulativeData.heartRate.readings;
    return readings.length > 0 ? readings[readings.length - 1].value : 0;
  }

  get averageHeartRate() {
    return this._cumulativeData.heartRate.avgHR;
  }

  get maxHeartRate() {
    return this._cumulativeData.heartRate.maxHR;
  }

  get currentCadence() {
    const readings = this._cumulativeData.cadence.readings;
    return readings.length > 0 ? readings[readings.length - 1].value : 0;
  }

  get averageCadence() {
    return this._cumulativeData.cadence.avgRPM;
  }

  get totalDistance() {
    return this._cumulativeData.distance.total;
  }

  get workoutDuration() {
    if (!this._cumulativeData.sessionStartTime) return 0;
    return Math.floor((new Date() - this._cumulativeData.sessionStartTime) / 1000);
  }

  get heartRateZones() {
    return { ...this._cumulativeData.heartRate.zones };
  }

  get summary() {
    return {
      name: this.name,
      age: this.age,
      currentHR: this.currentHeartRate,
      avgHR: this.averageHeartRate,
      maxHR: this.maxHeartRate,
      currentRPM: this.currentCadence,
      avgRPM: this.averageCadence,
      distance: this.totalDistance,
      duration: this.workoutDuration,
      zones: this.heartRateZones
    };
  }

  // Method to reset session data
  resetSession() {
    this._cumulativeData.sessionStartTime = null;
    this._cumulativeData.heartRate.readings = [];
    this._cumulativeData.cadence.readings = [];
    this._cumulativeData.power.readings = [];
    this._cumulativeData.distance.sessions.push({
      distance: this._cumulativeData.distance.total,
      timestamp: new Date()
    });
  }
}

// -------------------- Fitness Session Class --------------------
// Represents a logical workout session window spanning from the first
// observed device/user activity until all devices have exceeded the
// removal timeout. Devices/users may join or leave during the session.
export class FitnessSession {
  constructor(getTimeoutsFn = getFitnessTimeouts) {
    this._getTimeouts = getTimeoutsFn;
    this.sessionId = null; // could be timestamp-based id
    this.startTime = null;
    this.endTime = null;
    this.lastActivityTime = null; // last time any device reported activity
    this.activeDeviceIds = new Set();
    this.eventLog = []; // lightweight chronological log
    this.treasureBox = null; // Will be instantiated when session starts
  }

  // Internal helper to log events (kept small to avoid memory bloat)
  _log(type, payload = {}) {
    this.eventLog.push({ ts: Date.now(), type, ...payload });
    if (this.eventLog.length > 500) {
      this.eventLog = this.eventLog.slice(-500);
    }
  }

  // Called whenever a device reports fresh data
  recordDeviceActivity(device) {
    const now = Date.now();
    const started = this.ensureStarted();
    this.lastActivityTime = now;
    this.activeDeviceIds.add(String(device.deviceId));
    this._log('device_activity', { deviceId: device.deviceId, profile: device.profile });
    if (started) this._log('session_started', { sessionId: this.sessionId });
  }

  // Ensure we have a session started; returns true if newly started
  ensureStarted() {
    if (this.sessionId) return false;
    const now = Date.now();
    this.sessionId = `fs_${now}`;
    this.startTime = now;
    this.lastActivityTime = now;
    this.endTime = null;
    this._log('start', { sessionId: this.sessionId });
    // Lazy create treasure box when session begins
    if (!this.treasureBox) {
      this.treasureBox = new FitnessTreasureBox(this);
    }
    return true;
  }

  // Called periodically during cleanup to remove inactive devices
  updateActiveDevices(currentDevicesMap) {
    // Rebuild active set from devices not yet beyond removal timeout
    const { remove } = this._getTimeouts();
    const now = Date.now();
    const stillActive = new Set();
    for (const [id, device] of currentDevicesMap.entries()) {
      const age = now - device.lastSeen;
      if (age <= remove) {
        stillActive.add(String(id));
      }
    }
    // Detect devices removed
    for (const id of this.activeDeviceIds) {
      if (!stillActive.has(id)) {
        this._log('device_removed', { deviceId: id });
      }
    }
    this.activeDeviceIds = stillActive;
    if (this.activeDeviceIds.size === 0) {
      this.maybeEnd();
    }
  }

  // Attempt to end the session if conditions satisfied
  maybeEnd() {
    if (!this.sessionId || this.endTime) return false;
    // Session ends only when there are no active devices AND the last activity
    // happened at least "remove" ms ago (to avoid races during cleanup cycle)
    const { remove } = this._getTimeouts();
    const now = Date.now();
    if (!this.lastActivityTime || (now - this.lastActivityTime) < remove) return false;
    this.endTime = now;
    this._log('end', { sessionId: this.sessionId, durationMs: this.endTime - this.startTime });
    try { if (this.treasureBox) this.treasureBox.stop(); } catch(_){}
    return true;
  }

  get isActive() {
    return !!this.sessionId && !this.endTime;
  }

  get durationSeconds() {
    if (!this.sessionId) return 0;
    const end = this.endTime || Date.now();
    return Math.floor((end - this.startTime) / 1000);
  }

  get summary() {
    if (!this.sessionId) return null;
    return {
      sessionId: this.sessionId,
      startedAt: this.startTime,
      endedAt: this.endTime,
      active: this.isActive,
      durationSeconds: this.durationSeconds,
      activeDeviceCount: this.activeDeviceIds.size,
      lastActivityTime: this.lastActivityTime,
      treasureBox: this.treasureBox ? this.treasureBox.summary : null,
    };
  }

  // Reset after completion if desired (not automatically to allow consumers to read summary)
  reset() {
    this.sessionId = null;
    this.startTime = null;
    this.endTime = null;
    this.lastActivityTime = null;
    this.activeDeviceIds.clear();
    this.eventLog = [];
  }
}

// -------------------- Fitness Treasure Box --------------------
// Collects coins based on users being in HR zones over wall-clock intervals.
// Rules (from user clarifications):
//  - Interval length: coin_time_unit_ms (default 5000)
//  - During an interval, if any HR sample enters a zone, the highest zone reached awards its coin value once for that interval for that user
//  - Dropping out resets partial interval (no prorating)
//  - User-specific zone overrides adjust min thresholds only, keep color & coin value from global zone definition
//  - Only HR-based (requires positive HR reading)
//  - Multiple users earn independently; coins aggregated into color buckets plus total
//  - Event log entries for coin awards
export class FitnessTreasureBox {
  constructor(sessionRef) {
    this.sessionRef = sessionRef; // reference to owning FitnessSession
    this.coinTimeUnitMs = 5000; // default; will be overridden by configuration injection
    this.globalZones = []; // array of {id,name,min,color,coins}
    this.usersConfigOverrides = new Map(); // userName -> overrides object {active,warm,hot,fire}
    this.buckets = {}; // color -> coin total
    this.totalCoins = 0;
    this.perUser = new Map(); // userName -> accumulator
    this.lastTick = Date.now(); // for elapsed computation if needed
    // External mutation callback (set by context) to trigger UI re-render
    this._mutationCb = null;
    this._autoInterval = null; // timer id
  }

  setMutationCallback(cb) { this._mutationCb = typeof cb === 'function' ? cb : null; }
  _notifyMutation() { if (this._mutationCb) { try { this._mutationCb(); } catch(_){} } }

  configure({ coinTimeUnitMs, zones, users }) {
    if (typeof coinTimeUnitMs === 'number' && coinTimeUnitMs > 0) {
      this.coinTimeUnitMs = coinTimeUnitMs;
    }
    if (Array.isArray(zones)) {
      // Normalize zones sorted by min ascending for evaluation (we'll iterate descending)
      this.globalZones = zones.map(z => ({
        id: z.id,
        name: z.name,
        min: Number(z.min) || 0,
        color: z.color,
        coins: Number(z.coins) || 0
      })).sort((a,b) => a.min - b.min);
      // Initialize bucket colors
      for (const z of this.globalZones) {
        if (!(z.color in this.buckets)) this.buckets[z.color] = 0;
      }
    }
    // Extract user overrides (provided as part of users.primary/secondary config shape)
    if (users) {
      const collectOverrides = (arr) => {
        if (!Array.isArray(arr)) return;
        arr.forEach(u => {
          if (u?.zones) {
            this.usersConfigOverrides.set(u.name, { ...u.zones });
          }
        });
      };
      collectOverrides(users.primary);
      collectOverrides(users.secondary);
    }
    // Start / restart autonomous interval processing so awards happen even without continuous HR samples
    this._backfillExistingUsers();
    this._startAutoTicker();
  }

  _startAutoTicker() {
    if (this._autoInterval) clearInterval(this._autoInterval);
    // Run at half the coin unit granularity to be responsive but not heavy
    const tickMs = Math.max(1000, Math.min( this.coinTimeUnitMs / 2, 5000));
    this._autoInterval = setInterval(() => {
      try { this._processIntervals(); } catch(_){}
    }, tickMs);
  }

  stop() { if (this._autoInterval) { clearInterval(this._autoInterval); this._autoInterval = null; } }

  // Backfill highestZone from lastHR so already-on monitors immediately accrue coins
  _backfillExistingUsers() {
    if (!this.perUser.size || !this.globalZones.length) return;
    const now = Date.now();
    for (const [userName, acc] of this.perUser.entries()) {
      if (!acc.currentIntervalStart) acc.currentIntervalStart = now;
      if (acc.lastHR && acc.lastHR > 0 && !acc.highestZone) {
        const zone = this.resolveZone(userName, acc.lastHR);
        if (zone) {
          acc.highestZone = zone;
          acc.currentColor = zone.color;
          acc.lastColor = zone.color;
          acc.lastZoneId = zone.id || zone.name || null;
        }
      }
    }
  }

  // Walk each user accumulator and see if its interval window is complete even if no new HR sample arrived
  _processIntervals() {
    if (!this.perUser.size) return;
    const now = Date.now();
    for (const [userName, acc] of this.perUser.entries()) {
      if (!acc.currentIntervalStart) { acc.currentIntervalStart = now; continue; }
      const elapsed = now - acc.currentIntervalStart;
      if (elapsed >= this.coinTimeUnitMs) {
        if (acc.highestZone) {
          this._awardCoins(userName, acc.highestZone);
        }
        acc.currentIntervalStart = now;
        acc.highestZone = null;
        acc.currentColor = null;
      }
    }
  }

  // Determine zone for HR for a given user, returns zone object or null
  resolveZone(userName, hr) {
    if (!hr || hr <= 0 || this.globalZones.length === 0) return null;
    // Build effective thresholds using overrides where present
    const overrides = this.usersConfigOverrides.get(userName) || {};
    // Map of zone.id -> threshold min override (matching id by name semantics: active/warm/hot/fire)
    // We'll evaluate global zones but swap min if override present (by zone.id OR zone.name lowercased)
    const zonesDescending = [...this.globalZones].sort((a,b) => b.min - a.min);
    for (const zone of zonesDescending) {
      const key = zone.id || zone.name?.toLowerCase();
      const overrideMin = overrides[key];
      const effectiveMin = (typeof overrideMin === 'number') ? overrideMin : zone.min;
      if (hr >= effectiveMin) return { ...zone, min: effectiveMin };
    }
    return null;
  }

  // Record raw HR sample for a user
  recordUserHeartRate(userName, hr) {
    if (!this.globalZones.length) return; // disabled gracefully if no zones
    const now = Date.now();
    let acc = this.perUser.get(userName);
    if (!acc) {
      acc = {
        currentIntervalStart: now,
        highestZone: null, // zone object of highest seen this interval
        lastHR: null,
        currentColor: null,
        lastColor: null,
        lastZoneId: null,
      };
      this.perUser.set(userName, acc);
    }
    // HR dropout (<=0) resets interval without award
    if (!hr || hr <= 0) {
      acc.currentIntervalStart = now;
      acc.highestZone = null;
      acc.lastHR = hr;
      acc.currentColor = null;
      return;
    }
    // Determine zone for this reading
    const zone = this.resolveZone(userName, hr);
    if (zone) {
      if (!acc.highestZone || zone.min > acc.highestZone.min) {
        acc.highestZone = zone;
        acc.currentColor = zone.color;
        acc.lastColor = zone.color; // update persistent last color
        acc.lastZoneId = zone.id || zone.name || null;
      }
    }
    acc.lastHR = hr;
    // Check interval completion
    const elapsed = now - acc.currentIntervalStart;
    if (elapsed >= this.coinTimeUnitMs) {
      if (acc.highestZone) {
        this._awardCoins(userName, acc.highestZone);
      }
      // Start new interval after awarding (or discard if none)
      acc.currentIntervalStart = now;
      acc.highestZone = null;
      // Do NOT clear currentColor entirely; instead clear only the transient highest but keep lastColor
      acc.currentColor = null; // transient blank means we haven't seen a new zone this interval
    }
  }

  _awardCoins(userName, zone) {
    if (!zone) return;
    if (!(zone.color in this.buckets)) this.buckets[zone.color] = 0;
    this.buckets[zone.color] += zone.coins;
    this.totalCoins += zone.coins;
    // Log event in session if available
    try {
      this.sessionRef._log('coin_award', { user: userName, zone: zone.id || zone.name, coins: zone.coins, color: zone.color });
    } catch (_) { /* ignore */ }
    this._notifyMutation();
  }

  get summary() {
    // Derive session timing from owning sessionRef (if available and started)
    const sessionStarted = this.sessionRef?.startTime || null;
    const sessionEnded = this.sessionRef?.endTime || null;
    const now = Date.now();
    const elapsedSeconds = sessionStarted ? Math.floor(((sessionEnded || now) - sessionStarted) / 1000) : 0;

    // Backward compatible fields retained: coinTimeUnitMs, totalCoins, buckets, perUser
    // New self-contained fields: sessionStartTime, sessionElapsedSeconds, colorCoins (alias of buckets), totalCoinsAllColors (alias totalCoins)
    return {
      coinTimeUnitMs: this.coinTimeUnitMs,
      totalCoins: this.totalCoins,
      buckets: { ...this.buckets },
      perUser: Array.from(this.perUser.entries()).map(([user, data]) => ({
        user,
        currentColor: data.currentColor || data.lastColor || null,
        zoneId: data.lastZoneId || null,
      })),
      // Added fields
      sessionStartTime: sessionStarted,
      sessionElapsedSeconds: elapsedSeconds,
      colorCoins: { ...this.buckets },
      totalCoinsAllColors: this.totalCoins,
    };
  }
}

/**
 * Custom hook for listening to fitness-specific WebSocket messages
 * This is now a wrapper around the FitnessContext for backward compatibility
 */
import { useFitnessContext } from '../context/FitnessContext.jsx';

export const useFitnessWebSocket = (fitnessConfiguration) => {
  // Just return the context - the parameter is ignored as the context provider handles it
  // All implementation details have been moved to the FitnessContext
  return useFitnessContext();
};
