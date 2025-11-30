import { useState, useEffect, useRef } from 'react';
import { DaylightAPI } from '../lib/api.mjs';

const slugifyId = (value, fallback = 'user') => {
  if (!value) return fallback;
  const slug = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || fallback;
};

export const resolveDisplayLabel = ({
  name,
  groupLabel,
  preferGroupLabel = false,
  fallback = 'Participant'
} = {}) => {
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  const normalizedGroup = typeof groupLabel === 'string' ? groupLabel.trim() : '';
  if (preferGroupLabel && normalizedGroup) {
    return normalizedGroup;
  }
  if (normalizedName) {
    return normalizedName;
  }
  if (normalizedGroup) {
    return normalizedGroup;
  }
  return fallback;
};

const deepClone = (value) => {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
};

const ensureSeriesCapacity = (arr, index) => {
  if (!Array.isArray(arr)) return;
  while (arr.length <= index) {
    arr.push(null);
  }
};

const trimTrailingNulls = (series = []) => {
  let end = series.length;
  while (end > 0 && series[end - 1] == null) {
    end -= 1;
  }
  return series.slice(0, end);
};

const serializeSeries = (series = []) => {
  if (!Array.isArray(series) || series.length === 0) {
    return null;
  }
  return series
    .map((value) => {
      if (value == null) return '';
      return String(value);
    })
    .join('|');
};

const formatSessionId = (date = new Date()) => {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('');
};

const MIN_COOL_BASELINE = 60;
export const COOL_ZONE_PROGRESS_MARGIN = 40;

const DEFAULT_ZONE_CONFIG = [
  { id: 'cool', name: 'Cool', min: MIN_COOL_BASELINE, color: 'blue' },
  { id: 'active', name: 'Active', min: 100, color: 'green' },
  { id: 'warm', name: 'Warm', min: 120, color: 'yellow' },
  { id: 'hot', name: 'Hot', min: 140, color: 'orange' },
  { id: 'fire', name: 'On Fire', min: 160, color: 'red' }
];

const DEFAULT_ZONE_LOOKUP = DEFAULT_ZONE_CONFIG.reduce((acc, zone) => {
  const key = String(zone.id || zone.name).toLowerCase();
  acc[key] = zone;
  return acc;
}, {});

const normalizeZoneOverrides = (overrides = {}) => {
  if (!overrides || typeof overrides !== 'object') return {};
  return Object.entries(overrides).reduce((acc, [key, value]) => {
    const normalizedKey = slugifyId(key).toLowerCase();
    const numeric = Number(value);
    if (normalizedKey && Number.isFinite(numeric)) {
      acc[normalizedKey] = numeric;
    }
    return acc;
  }, {});
};

export const buildZoneConfig = (globalZones, overrides) => {
  const source = Array.isArray(globalZones) && globalZones.length > 0
    ? globalZones
    : DEFAULT_ZONE_CONFIG;
  const normalizedOverrides = normalizeZoneOverrides(overrides);
  const normalized = source.map((zone, index) => {
    const rawId = zone?.id || zone?.name || `zone-${index}`;
    const zoneId = String(rawId).trim() || `zone-${index}`;
    const lookupId = zoneId.toLowerCase();
    const defaultZone = DEFAULT_ZONE_LOOKUP[lookupId] || DEFAULT_ZONE_CONFIG[index] || {};
    const fallbackColor = defaultZone?.color || null;
    const fallbackMin = Number.isFinite(defaultZone?.min) ? defaultZone.min : 0;
    const overrideMin = normalizedOverrides[lookupId];
    return {
      id: zoneId,
      name: zone?.name || defaultZone?.name || zoneId,
      color: zone?.color || fallbackColor,
      min: Number.isFinite(overrideMin)
        ? overrideMin
        : (Number.isFinite(zone?.min) ? zone.min : fallbackMin)
    };
  }).sort((a, b) => (a?.min ?? 0) - (b?.min ?? 0));

  if (normalized.length === 0) {
    return DEFAULT_ZONE_CONFIG.map((zone) => ({ ...zone }));
  }

  if (normalized[0]) {
    const referenceNext = normalized.find((zone, index) => index > 0 && Number.isFinite(zone?.min));
    const fallbackMin = Number.isFinite(normalized[0].min) ? normalized[0].min : MIN_COOL_BASELINE;
    const inferredMin = referenceNext && Number.isFinite(referenceNext.min)
      ? Math.max(0, referenceNext.min - COOL_ZONE_PROGRESS_MARGIN)
      : Math.max(MIN_COOL_BASELINE, fallbackMin);
    normalized[0] = { ...normalized[0], min: inferredMin };
  }

  return normalized;
};

const ensureZoneList = (zoneConfig) => {
  if (Array.isArray(zoneConfig) && zoneConfig.length > 0) {
    return zoneConfig;
  }
  return DEFAULT_ZONE_CONFIG.map((zone) => ({ ...zone }));
};

const clamp01 = (value) => Math.max(0, Math.min(1, value));

const getZoneMin = (zone, { isFirst = false } = {}) => {
  if (!zone) return null;
  const rawMin = Number(zone.min);
  if (!Number.isFinite(rawMin)) {
    return isFirst ? MIN_COOL_BASELINE : null;
  }
  return isFirst ? Math.max(MIN_COOL_BASELINE, rawMin) : rawMin;
};

export const deriveZoneProgressSnapshot = ({
  zoneConfig,
  heartRate,
  coolZoneMargin = COOL_ZONE_PROGRESS_MARGIN
} = {}) => {
  const zones = ensureZoneList(zoneConfig);
  if (!zones.length) {
    return null;
  }
  const hrValue = Number.isFinite(heartRate) ? Math.max(0, heartRate) : 0;
  const sortedZones = zones.slice().sort((a, b) => (a?.min ?? 0) - (b?.min ?? 0));
  const zoneSequence = sortedZones.map((zone, index) => {
    const zoneId = slugifyId(zone?.id || zone?.name || `zone-${index}`);
    const threshold = getZoneMin(zone, { isFirst: index === 0 });
    return {
      id: zoneId,
      name: zone?.name || zone?.id || `Zone ${index + 1}`,
      color: zone?.color || null,
      threshold: Number.isFinite(threshold) ? threshold : null,
      index
    };
  });

  let currentZoneIndex = -1;
  for (let i = 0; i < sortedZones.length; i += 1) {
    const threshold = getZoneMin(sortedZones[i], { isFirst: i === 0 }) ?? MIN_COOL_BASELINE;
    if (hrValue >= threshold) {
      currentZoneIndex = i;
    } else {
      break;
    }
  }
  if (currentZoneIndex === -1) {
    currentZoneIndex = 0;
  }

  const currentZone = sortedZones[currentZoneIndex] || null;
  const nextZone = sortedZones[currentZoneIndex + 1] || null;
  const currentZoneMeta = zoneSequence[currentZoneIndex] || null;
  const nextZoneMeta = zoneSequence[currentZoneIndex + 1] || null;
  const currentZoneId = currentZoneMeta?.id || currentZone?.id || (currentZone?.name ? slugifyId(currentZone.name) : null);
  const currentZoneName = currentZone?.name || currentZoneId;
  const currentZoneColor = currentZone?.color || null;
  const currentThreshold = Number.isFinite(currentZoneMeta?.threshold)
    ? currentZoneMeta.threshold
    : (getZoneMin(currentZone, { isFirst: currentZoneIndex === 0 }) ?? MIN_COOL_BASELINE);
  const nextThreshold = Number.isFinite(nextZoneMeta?.threshold)
    ? nextZoneMeta.threshold
    : (nextZone ? getZoneMin(nextZone, { isFirst: currentZoneIndex + 1 === 0 }) : null);

  let rangeMin = null;
  let rangeMax = null;
  let progress = 0;
  let showBar = false;

  const margin = Number.isFinite(coolZoneMargin) ? Math.max(5, coolZoneMargin) : COOL_ZONE_PROGRESS_MARGIN;
  if (nextZone && Number.isFinite(nextThreshold)) {
    if (currentZoneIndex === 0) {
      rangeMax = nextThreshold;
      rangeMin = Math.max(0, nextThreshold - margin);
    } else if (Number.isFinite(currentThreshold)) {
      rangeMin = currentThreshold;
      rangeMax = nextThreshold;
    }
    if (rangeMax != null && rangeMin != null && rangeMax > rangeMin) {
      progress = clamp01((hrValue - rangeMin) / (rangeMax - rangeMin));
      showBar = true;
    } else {
      showBar = false;
      progress = 0;
    }
  } else {
    // Max zone (e.g., On Fire) or missing next threshold: no progress bar
    rangeMin = Number.isFinite(currentThreshold) ? currentThreshold : null;
    rangeMax = null;
    progress = 0;
    showBar = false;
  }

  return {
    currentHR: hrValue,
    currentZoneId: currentZoneId || null,
    currentZoneName: currentZoneName || null,
    currentZoneColor,
    nextZoneId: nextZone?.id || null,
    nextZoneName: nextZone?.name || null,
    nextZoneColor: nextZone?.color || null,
    rangeMin: Number.isFinite(rangeMin) ? rangeMin : null,
    rangeMax: Number.isFinite(rangeMax) ? rangeMax : null,
    progress,
    showBar,
    targetHeartRate: Number.isFinite(nextThreshold)
      ? nextThreshold
      : null,
    isMaxZone: !nextZone,
    zoneIndex: currentZoneIndex,
    currentZoneThreshold: Number.isFinite(currentThreshold) ? currentThreshold : null,
    nextZoneThreshold: Number.isFinite(nextThreshold) ? nextThreshold : null,
    zoneSequence
  };
};

export const calculateZoneProgressTowardsTarget = ({
  snapshot,
  targetZoneId,
  coolZoneMargin = COOL_ZONE_PROGRESS_MARGIN
} = {}) => {
  if (!snapshot) {
    return {
      progress: null,
      rangeMin: null,
      rangeMax: null,
      targetIndex: null
    };
  }

  const zoneSequence = Array.isArray(snapshot.zoneSequence)
    ? snapshot.zoneSequence
    : Array.isArray(snapshot.orderedZones)
      ? snapshot.orderedZones
      : null;
  const currentZoneIndex = Number.isFinite(snapshot.currentZoneIndex)
    ? snapshot.currentZoneIndex
    : Number.isFinite(snapshot.zoneIndex)
      ? snapshot.zoneIndex
      : null;
  if (!zoneSequence || zoneSequence.length === 0 || currentZoneIndex == null) {
    return {
      progress: Number.isFinite(snapshot.progress) ? snapshot.progress : null,
      rangeMin: snapshot.rangeMin ?? null,
      rangeMax: snapshot.rangeMax ?? null,
      targetIndex: null
    };
  }

  const normalizedTarget = targetZoneId ? slugifyId(targetZoneId).toLowerCase() : null;
  let targetIndex = null;
  if (normalizedTarget) {
    targetIndex = zoneSequence.findIndex((zone) => slugifyId(zone.id).toLowerCase() === normalizedTarget);
  }
  if (targetIndex == null || targetIndex === -1) {
    targetIndex = Math.min(currentZoneIndex + 1, zoneSequence.length - 1);
  }

  if (targetIndex <= currentZoneIndex) {
    return {
      progress: 1,
      rangeMin: snapshot.rangeMin ?? zoneSequence[targetIndex]?.threshold ?? null,
      rangeMax: snapshot.rangeMax ?? zoneSequence[targetIndex]?.threshold ?? null,
      targetIndex
    };
  }

  const margin = Number.isFinite(coolZoneMargin) ? Math.max(5, coolZoneMargin) : COOL_ZONE_PROGRESS_MARGIN;
  const hrValue = Number.isFinite(snapshot.currentHR)
    ? snapshot.currentHR
    : (Number.isFinite(snapshot.heartRate) ? snapshot.heartRate : 0);

  let rangeMin = null;
  if (currentZoneIndex <= 0) {
    const anchorZone = zoneSequence[currentZoneIndex + 1] || zoneSequence[targetIndex];
    const anchorThreshold = anchorZone?.threshold
      ?? snapshot.nextZoneThreshold
      ?? snapshot.targetHeartRate
      ?? snapshot.rangeMax
      ?? null;
    if (Number.isFinite(anchorThreshold)) {
      rangeMin = Math.max(0, anchorThreshold - margin);
    }
  } else {
    rangeMin = Number.isFinite(zoneSequence[currentZoneIndex]?.threshold)
      ? zoneSequence[currentZoneIndex].threshold
      : (Number.isFinite(snapshot.currentZoneThreshold)
        ? snapshot.currentZoneThreshold
        : snapshot.rangeMin ?? null);
  }

  if (rangeMin == null && Number.isFinite(snapshot.rangeMin)) {
    rangeMin = snapshot.rangeMin;
  }

  let rangeMax = Number.isFinite(zoneSequence[targetIndex]?.threshold)
    ? zoneSequence[targetIndex].threshold
    : (Number.isFinite(snapshot.targetHeartRate)
      ? snapshot.targetHeartRate
      : snapshot.rangeMax ?? null);

  if (rangeMax == null) {
    return {
      progress: null,
      rangeMin,
      rangeMax: null,
      targetIndex
    };
  }

  const span = rangeMax - (rangeMin ?? 0);
  if (!Number.isFinite(rangeMin) || span <= 0) {
    const progress = hrValue >= rangeMax ? 1 : 0;
    return {
      progress,
      rangeMin,
      rangeMax,
      targetIndex
    };
  }

  return {
    progress: clamp01((hrValue - rangeMin) / span),
    rangeMin,
    rangeMax,
    targetIndex
  };
};

export const resolveZoneThreshold = (zoneConfig, zoneId) => {
  if (!zoneId) return null;
  const zones = ensureZoneList(zoneConfig);
  if (!zones.length) return null;
  const normalizedId = slugifyId(zoneId).toLowerCase();
  const found = zones.find((zone) => slugifyId(zone.id || zone.name).toLowerCase() === normalizedId);
  if (!found) return null;
  const index = zones.findIndex((zone) => zone === found);
  const minValue = getZoneMin(found, { isFirst: index === 0 });
  return Number.isFinite(minValue) ? minValue : null;
};

/**
 * Base Device class for all ANT+ fitness devices
 */
// -------------------- Timeout Configuration --------------------
// Defaults match previous hardcoded values (60s inactive, 180s removal)
const FITNESS_TIMEOUTS = {
  inactive: 60000,
  remove: 180000,
  rpmZero: 12000  // RPM devices show 0 after 12 seconds of no updates
};

// Setter to override timeouts from external configuration
export const setFitnessTimeouts = ({ inactive, remove, rpmZero } = {}) => {
  if (typeof inactive === 'number' && !Number.isNaN(inactive)) {
    FITNESS_TIMEOUTS.inactive = inactive;
  }
  if (typeof remove === 'number' && !Number.isNaN(remove)) {
    FITNESS_TIMEOUTS.remove = remove;
  }
  if (typeof rpmZero === 'number' && !Number.isNaN(rpmZero)) {
    FITNESS_TIMEOUTS.rpmZero = rpmZero;
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
    this._cadenceValue = Math.round(rawData.CalculatedCadence || 0);
    this.lastCadenceUpdate = new Date();
    this.revolutionCount = rawData.CumulativeCadenceRevolutionCount || 0;
    this.eventTime = rawData.CadenceEventTime || 0;
  }

  updateData(rawData) {
    super.updateData(rawData);
    const newCadence = Math.round(rawData.CalculatedCadence || 0);
    if (newCadence !== this._cadenceValue) {
      this.lastCadenceUpdate = new Date();
    }
    this._cadenceValue = newCadence;
    this.revolutionCount = rawData.CumulativeCadenceRevolutionCount || 0;
    this.eventTime = rawData.CadenceEventTime || 0;
  }

  // Getter that returns 0 if cadence hasn't been updated in rpmZero timeout
  get cadence() {
    const timeSinceUpdate = new Date() - this.lastCadenceUpdate;
    if (timeSinceUpdate > FITNESS_TIMEOUTS.rpmZero) {
      return 0;
    }
    return this._cadenceValue;
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
    this._cadenceValue = Math.round(rawData.Cadence || rawData.CalculatedCadence || 0);
    this.lastCadenceUpdate = new Date();
    this.leftRightBalance = rawData.PedalPowerBalance; // optional
  }

  updateData(rawData) {
    super.updateData(rawData);
    this.power = rawData.InstantaneousPower || 0;
    const newCadence = Math.round(rawData.Cadence || rawData.CalculatedCadence || 0);
    if (newCadence !== this._cadenceValue) {
      this.lastCadenceUpdate = new Date();
    }
    this._cadenceValue = newCadence;
    this.leftRightBalance = rawData.PedalPowerBalance;
  }

  // Getter that returns 0 if cadence hasn't been updated in rpmZero timeout
  get cadence() {
    const timeSinceUpdate = new Date() - this.lastCadenceUpdate;
    if (timeSinceUpdate > FITNESS_TIMEOUTS.rpmZero) {
      return 0;
    }
    return this._cadenceValue;
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
  constructor(name, birthyear, hrDeviceId = null, cadenceDeviceId = null, options = {}) {
    this.name = name;
    this.birthyear = birthyear;
    this.hrDeviceId = hrDeviceId;
    this.cadenceDeviceId = cadenceDeviceId;
    this.age = new Date().getFullYear() - birthyear;
    this.zoneConfig = buildZoneConfig(options.globalZones, options.zoneOverrides);
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

  // Private method to update cumulative heart rate data
  #updateHeartRateData(heartRate) {
    if (!heartRate || heartRate <= 0) {
      this.#updateCurrentData(deriveZoneProgressSnapshot({ zoneConfig: this.zoneConfig, heartRate: 0 }));
      return;
    }

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
    const zoneSnapshot = deriveZoneProgressSnapshot({ zoneConfig: this.zoneConfig, heartRate });
    if (zoneSnapshot?.currentZoneId) {
      const zoneId = zoneSnapshot.currentZoneId;
      hrData.zones[zoneId] = (hrData.zones[zoneId] || 0) + 1;
    }

    this.#updateCurrentData(zoneSnapshot);
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
    if (this.currentData && Number.isFinite(this.currentData.heartRate)) {
      return this.currentData.heartRate;
    }
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
      currentZone: this.currentData.zone,
      currentZoneName: this.currentData.zoneName,
      currentZoneColor: this.currentData.color,
      progressToNextZone: this.currentData.progressToNextZone,
      nextZoneId: this.currentData.nextZoneId ?? null,
      targetHeartRate: this.currentData.targetHeartRate ?? null,
      avgHR: this.averageHeartRate,
      maxHR: this.maxHeartRate,
      currentRPM: this.currentCadence,
      avgRPM: this.averageCadence,
      distance: this.totalDistance,
      duration: this.workoutDuration,
      zones: this.heartRateZones
    };
  }

  get zoneProgress() {
    return this.zoneSnapshot ? { ...this.zoneSnapshot } : null;
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
    this.zoneSnapshot = deriveZoneProgressSnapshot({ zoneConfig: this.zoneConfig, heartRate: 0 });
    this.currentData = this.#createDefaultCurrentData(this.zoneSnapshot);
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
    this._saveTriggered = false; // guard against duplicate saves
    this.voiceMemos = []; // { createdAt, sessionElapsedSeconds, videoTimeSeconds, transcriptRaw, transcriptClean }
    this.participantRoster = [];
    this.currentGuestAssignments = {};
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

  setParticipantRoster(roster = [], guestAssignments = {}) {
    if (Array.isArray(roster)) {
      this.participantRoster = roster.map((entry) => ({ ...entry }));
    } else {
      this.participantRoster = [];
    }
    if (guestAssignments && typeof guestAssignments === 'object') {
      try {
        this.currentGuestAssignments = JSON.parse(JSON.stringify(guestAssignments));
      } catch (_) {
        this.currentGuestAssignments = {};
      }
    } else {
      this.currentGuestAssignments = {};
    }
  }

  _getOrCreateDeviceRecord(deviceId, device = {}) {
    const idStr = String(deviceId);
    const existing = this.snapshot.deviceSeries.get(idStr);
    if (existing) {
      if (!existing.label) {
        existing.label = device.label || device.rawData?.label || null;
      }
      existing.type = device.type || existing.type || device.profile || 'unknown';
      return existing;
    }
    const record = {
      id: idStr,
      type: device.type || device.profile || 'unknown',
      label: device.label || device.rawData?.label || null,
      rpmSeries: [],
      powerSeries: [],
      speedSeries: [],
      heartRateSeries: []
    };
    this.snapshot.deviceSeries.set(idStr, record);
    return record;
  }

  updateSnapshot({
    users,
    devices,
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

    if (Array.isArray(participantRoster)) {
      this.snapshot.participantRoster = participantRoster.map((entry) => ({ ...entry }));
    }

    if (users instanceof Map) {
      users.forEach((userObj, key) => {
        if (!userObj) return;
        const slug = slugifyId(key);
        const displayName = userObj.name || userObj.displayName || key;
        this.snapshot.usersMeta.set(slug, {
          name: key,
          displayName,
          age: Number.isFinite(userObj.age) ? userObj.age : null,
          hrDeviceId: userObj.hrDeviceId ?? null,
          cadenceDeviceId: userObj.cadenceDeviceId ?? null
        });
        const readings = Array.isArray(userObj._cumulativeData?.heartRate?.readings)
          ? userObj._cumulativeData.heartRate.readings
          : [];
        let hrValue = null;
        if (readings.length > 0) {
          const latest = readings[readings.length - 1]?.value;
          if (Number.isFinite(latest)) {
            hrValue = Math.round(latest);
          }
        } else if (Number.isFinite(userObj.currentHeartRate)) {
          hrValue = Math.round(userObj.currentHeartRate);
        }
        const series = this.snapshot.participantSeries.get(slug) || [];
        ensureSeriesCapacity(series, intervalIndex);
        series[intervalIndex] = hrValue != null ? hrValue : null;
        this.snapshot.participantSeries.set(slug, series);
      });
    }

    if (devices instanceof Map) {
      devices.forEach((device, rawId) => {
        if (!device) return;
        const idStr = String(rawId ?? device.deviceId ?? slugifyId(rawId));
        const record = this._getOrCreateDeviceRecord(idStr, device);
        if (device.type === 'cadence') {
          const cadence = Number.isFinite(device.cadence) ? Math.round(device.cadence) : null;
          ensureSeriesCapacity(record.rpmSeries, intervalIndex);
          record.rpmSeries[intervalIndex] = cadence != null ? cadence : null;
        } else if (device.type === 'power') {
          const power = Number.isFinite(device.power) ? Math.round(device.power) : null;
          ensureSeriesCapacity(record.powerSeries, intervalIndex);
          record.powerSeries[intervalIndex] = power != null ? power : null;
          if (Number.isFinite(device.cadence)) {
            const cadence = Math.round(device.cadence);
            ensureSeriesCapacity(record.rpmSeries, intervalIndex);
            record.rpmSeries[intervalIndex] = cadence;
          }
        } else if (device.type === 'speed') {
          const speed = Number.isFinite(device.speedKmh)
            ? Math.round(device.speedKmh * 10) / 10
            : (Number.isFinite(device.speed) ? Math.round(device.speed * 100) / 100 : null);
          ensureSeriesCapacity(record.speedSeries, intervalIndex);
          record.speedSeries[intervalIndex] = speed != null ? speed : null;
        } else if (device.type === 'heart_rate') {
          const hr = Number.isFinite(device.heartRate) ? Math.round(device.heartRate) : null;
          ensureSeriesCapacity(record.heartRateSeries, intervalIndex);
          record.heartRateSeries[intervalIndex] = hr != null ? hr : null;
        }
        this.snapshot.deviceSeries.set(idStr, record);
      });
    }

    if (Array.isArray(playQueue)) {
      const clonedQueue = deepClone(playQueue) || [];
      this.snapshot.playQueue = clonedQueue;
      const video = [];
      const music = [];
      clonedQueue.forEach((item) => {
        if (!item) return;
        const base = {
          plexId: item.plex ?? item.id ?? null,
          title: item.title || item.name || null,
          sinceStartMs: Number.isFinite(item.sinceStartMs) ? item.sinceStartMs : null,
          videoOffsetMs: Number.isFinite(item.videoOffsetMs) ? item.videoOffsetMs : null,
          durationMs: Number.isFinite(item.duration) ? Math.round(item.duration) : null
        };
        if (item.audioUrl || item.type === 'audio' || item.mediaType === 'music') {
          base.artist = item.artist || item.albumArtist || item.show || null;
          music.push(base);
        } else {
          base.show = item.show
            || item.seriesTitle
            || item.series
            || item.parentTitle
            || item.collectionTitle
            || null;
          video.push(base);
        }
      });
      this.snapshot.mediaPlaylists = { video, music };
    }

    if (zoneConfig !== undefined) {
      const clone = deepClone(zoneConfig);
      this.snapshot.zoneConfig = clone !== null ? clone : zoneConfig;
    }

    if (mediaPlaylists && typeof mediaPlaylists === 'object') {
      const override = deepClone(mediaPlaylists);
      if (override) {
        this.snapshot.mediaPlaylists = {
          video: Array.isArray(override.videoPlaylist) ? override.videoPlaylist : [],
          music: Array.isArray(override.musicPlaylist) ? override.musicPlaylist : []
        };
      }
    }

    if (screenshotPlan && typeof screenshotPlan === 'object') {
      if (typeof screenshotPlan.intervalMs === 'number' && !Number.isNaN(screenshotPlan.intervalMs)) {
        this.screenshots.intervalMs = screenshotPlan.intervalMs;
      }
      if (screenshotPlan.filenamePattern) {
        this.screenshots.filenamePattern = String(screenshotPlan.filenamePattern);
      }
    }

    this._maybeAutosave();
  }

  setScreenshotPlan({ intervalMs, filenamePattern } = {}) {
    if (typeof intervalMs === 'number' && !Number.isNaN(intervalMs)) {
      this.screenshots.intervalMs = intervalMs;
    }
    if (filenamePattern) {
      this.screenshots.filenamePattern = String(filenamePattern);
    }
  }

  recordScreenshotCapture({ index, timestamp, filename, url } = {}) {
    if (!this.sessionId) return;
    const capture = {
      index: Number.isFinite(index) ? index : this.screenshots.captures.length,
      timestamp: timestamp || Date.now(),
      filename: filename || null,
      url: url || null
    };
    this.screenshots.captures.push(capture);
  }

  // Ensure we have a session started; returns true if newly started
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
    this.snapshot.participantSeries = new Map();
    this.snapshot.deviceSeries = new Map();
    this.snapshot.usersMeta = new Map();
    this.snapshot.playQueue = [];
    this.snapshot.mediaPlaylists = { video: [], music: [] };
    this.snapshot.zoneConfig = null;
    this.screenshots.captures = [];
    this._log('start', { sessionId: this.sessionId });
    // Lazy create treasure box when session begins
    if (!this.treasureBox) {
      this.treasureBox = new FitnessTreasureBox(this);
    }
    this._lastAutosaveAt = 0;
    this._startAutosaveTimer();
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
    let sessionData = null;
    try {
      if (this.treasureBox) this.treasureBox.stop();
      // Capture summary BEFORE resetting state so we can persist it
      sessionData = this.summary;
    } catch(_){}
    // Kick off async save (non-blocking)
    if (sessionData) this._persistSession(sessionData, { force: true });
    // Immediately reset so a new session can start on next device activity
    this.reset();
    return true;
  }

  // Persist session to backend using DaylightAPI
  _persistSession(sessionData, { force = false } = {}) {
    if (!sessionData) return;
    if (this._saveTriggered && !force) return; // already saving
    this._lastAutosaveAt = Date.now();
    this._saveTriggered = true;
    DaylightAPI('api/fitness/save_session', { sessionData }, 'POST')
    .then(resp => {
      // eslint-disable-next-line no-console
      console.log('Fitness session saved', resp);
    }).catch(err => {
      // eslint-disable-next-line no-console
      console.error('Failed to save fitness session', err);
    }).finally(() => {
      this._saveTriggered = false; // allow future sessions to save
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
        // eslint-disable-next-line no-console
        console.error('Autosave failed', err);
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

  get durationSeconds() {
    if (!this.sessionId) return 0;
    const end = this.endTime || Date.now();
    return Math.floor((end - this.startTime) / 1000);
  }

  // Add a voice memo into the active session
  addVoiceMemo({ memoId: incomingMemoId, transcriptRaw, transcriptClean, createdAt, videoTimeSeconds }) {
    if (!this.sessionId) this.ensureStarted();
    const ts = createdAt || Date.now();
    const sessionElapsedSeconds = this.startTime ? Math.max(0, Math.floor((ts - this.startTime) / 1000)) : 0;
    const memoId = incomingMemoId || `vm_${this.sessionId || 'pending'}_${this.voiceMemos.length + 1}`;
    const memo = {
      memoId,
      createdAt: ts,
      sessionElapsedSeconds,
      videoTimeSeconds: typeof videoTimeSeconds === 'number' ? videoTimeSeconds : null,
      transcriptRaw: transcriptRaw || '',
      transcriptClean: transcriptClean || transcriptRaw || ''
    };
    this.voiceMemos.push(memo);
    this._log('voice_memo', { sessionElapsedSeconds });
    if (this.voiceMemos.length > 200) this.voiceMemos = this.voiceMemos.slice(-200);
    this._maybeAutosave(true);
    return memo;
  }

  removeVoiceMemo(memoId) {
    if (!memoId) return null;
    const id = String(memoId);
    const index = this.voiceMemos.findIndex((memo) => memo && String(memo.memoId) === id);
    if (index === -1) return null;
    const [removed] = this.voiceMemos.splice(index, 1);
    this._log('voice_memo_removed', { memoId: id });
    this._maybeAutosave(true);
    return removed || null;
  }

  replaceVoiceMemo(memoId, newMemo = {}) {
    if (!memoId || !newMemo) return null;
    const id = String(memoId);
    const existingIndex = this.voiceMemos.findIndex((memo) => memo && String(memo.memoId) === id);
    const memo = {
      ...newMemo,
      memoId: newMemo.memoId || id
    };
    if (existingIndex === -1) {
      this.voiceMemos.push(memo);
    } else {
      this.voiceMemos.splice(existingIndex, 1, memo);
    }
    this._log('voice_memo_replaced', { memoId: id });
    this._maybeAutosave(true);
    return memo;
  }

  get summary() {
    if (!this.sessionId) return null;
    const startAbsMs = this.timebase.startAbsMs || this.startTime || null;
    const endTs = this.endTime || null;
    const intervalMs = this.timebase.intervalMs || this.treasureBox?.coinTimeUnitMs || 5000;
    const effectiveEnd = endTs || Date.now();
    const durationMs = startAbsMs ? Math.max(0, effectiveEnd - startAbsMs) : 0;
    const computedIntervalCount = intervalMs > 0 ? Math.max(1, Math.ceil(durationMs / intervalMs)) : 0;
    const intervalCount = Math.max(this.timebase.intervalCount, computedIntervalCount);
    const cloneSeries = (arr = [], { allowZero = true } = {}) => {
      const series = Array.isArray(arr) ? arr.slice(0, intervalCount) : [];
      if (intervalCount > 0 && series.length < intervalCount) {
        ensureSeriesCapacity(series, intervalCount - 1);
      }
      const normalized = series.map((value) => {
        if (Number.isFinite(value)) {
          if (!allowZero && value <= 0) return null;
          return value;
        }
        return null;
      });
      return trimTrailingNulls(normalized);
    };

    const rosterLookup = new Map();
    const ingestRoster = (roster = []) => {
      roster.forEach((entry) => {
        if (!entry?.name) return;
        rosterLookup.set(slugifyId(entry.name), entry.name);
      });
    };
    if (Array.isArray(this.snapshot.participantRoster)) ingestRoster(this.snapshot.participantRoster);
    if (Array.isArray(this.participantRoster)) ingestRoster(this.participantRoster);

    const participants = {};
    this.snapshot.participantSeries.forEach((series, slug) => {
      const normalized = cloneSeries(series, { allowZero: false });
      if (!normalized.length) return;
      const hasData = normalized.some((value) => Number.isFinite(value) && value > 0);
      if (!hasData) return;
      const meta = this.snapshot.usersMeta.get(slug);
      const displayName = meta?.displayName || meta?.name || rosterLookup.get(slug) || slug;
      const heartRate = serializeSeries(normalized);
      if (heartRate === null) return;
      participants[slug] = {
        displayName,
        heartRate
      };
    });

    const devices = {};
    this.snapshot.deviceSeries.forEach((record, id) => {
      const type = (record.type || 'unknown').toLowerCase();
      if (type === 'heart_rate') return;
      const entry = {
        type: record.type || 'unknown',
        label: record.label || null
      };
      if (record.rpmSeries?.length) {
        const rpmSeries = serializeSeries(cloneSeries(record.rpmSeries, { allowZero: true }));
        if (rpmSeries !== null) {
          entry.rpmSeries = rpmSeries;
        }
      }
      if (record.powerSeries?.length) {
        const powerSeries = serializeSeries(cloneSeries(record.powerSeries, { allowZero: true }));
        if (powerSeries !== null) {
          entry.powerSeries = powerSeries;
        }
      }
      if (record.speedSeries?.length) {
        const speedSeries = serializeSeries(cloneSeries(record.speedSeries, { allowZero: true }));
        if (speedSeries !== null) {
          entry.speedSeries = speedSeries;
        }
      }
      if (record.heartRateSeries?.length) {
        const heartRateSeries = serializeSeries(cloneSeries(record.heartRateSeries, { allowZero: true }));
        if (heartRateSeries !== null) {
          entry.heartRateSeries = heartRateSeries;
        }
      }
      if (entry.rpmSeries || entry.powerSeries || entry.speedSeries || entry.heartRateSeries) {
        devices[id] = entry;
      }
    });

    const mapVideoItem = (item) => {
      if (!item) return null;
      const sinceStartMs = Number.isFinite(item.sinceStartMs) ? item.sinceStartMs : null;
      const videoOffsetMs = Number.isFinite(item.videoOffsetMs) ? item.videoOffsetMs : null;
      const show = item.show
        || item.seriesTitle
        || item.series
        || item.parentTitle
        || item.collectionTitle
        || null;
      return {
        plexId: item.plexId ?? item.plex ?? item.id ?? null,
        title: item.title ?? item.name ?? null,
        show,
        sinceStartMs,
        videoOffsetMs
      };
    };

    const mapMusicItem = (item) => {
      if (!item) return null;
      const sinceStartMs = Number.isFinite(item.sinceStartMs) ? item.sinceStartMs : null;
      const videoOffsetMs = Number.isFinite(item.videoOffsetMs) ? item.videoOffsetMs : null;
      return {
        plexId: item.plexId ?? item.plex ?? item.id ?? null,
        title: item.title ?? item.name ?? null,
        artist: item.artist ?? item.albumArtist ?? null,
        sinceStartMs,
        videoOffsetMs
      };
    };

    const media = {
      videoPlaylist: Array.isArray(this.snapshot.mediaPlaylists?.video)
        ? this.snapshot.mediaPlaylists.video
            .map(mapVideoItem)
            .filter((item) => item && (item.plexId || item.title || item.show))
        : [],
      musicPlaylist: Array.isArray(this.snapshot.mediaPlaylists?.music)
        ? this.snapshot.mediaPlaylists.music
            .map(mapMusicItem)
            .filter((item) => item && (item.plexId || item.title))
        : []
    };

    const voiceMemos = this.voiceMemos.map((memo, idx) => {
      const sinceStartMs = memo.sessionElapsedSeconds != null ? memo.sessionElapsedSeconds * 1000 : null;
      const videoOffsetMs = memo.videoTimeSeconds != null ? Math.round(memo.videoTimeSeconds * 1000) : null;
      return {
        memoId: memo.memoId || (this.sessionTimestamp ? `vm_${this.sessionTimestamp}_${idx + 1}` : `vm_${idx + 1}`),
        sinceStartMs,
        videoTitle: memo.videoTitle ?? null,
        videoOffsetMs,
        videoPlexId: memo.videoPlexId ?? null,
        transcript: memo.transcriptClean || memo.transcriptRaw || ''
      };
    });

    const screenshots = {
      intervalMs: typeof this.screenshots.intervalMs === 'number' && !Number.isNaN(this.screenshots.intervalMs)
        ? this.screenshots.intervalMs
        : null,
      count: this.screenshots.captures.length,
      filenamePattern: this.screenshots.filenamePattern || null
    };

    const treasureBox = (() => {
      if (!this.treasureBox) return null;
      const summary = this.treasureBox.summary;
      if (!summary) return null;
      const perColorTimeline = {};
      if (summary.perColorTimeline && typeof summary.perColorTimeline === 'object') {
        Object.entries(summary.perColorTimeline).forEach(([color, series]) => {
          const serializedTimeline = serializeSeries(cloneSeries(series, { allowZero: true }));
          if (serializedTimeline !== null) {
            perColorTimeline[color] = serializedTimeline;
          }
        });
      }
      const cumulativeCoins = serializeSeries(cloneSeries(summary.cumulativeCoins || [], { allowZero: true }));
      return {
        coinTimeUnitMs: summary.coinTimeUnitMs ?? this.treasureBox.coinTimeUnitMs ?? intervalMs,
        totalCoins: summary.totalCoins ?? 0,
        perColorTimeline,
        cumulativeCoins
      };
    })();

    return {
      sessionId: this.sessionId,
      timebase: {
        startAbsMs,
        intervalMs,
        intervalCount
      },
      media,
      participants,
      devices,
      treasureBox,
      voiceMemos,
      screenshots
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
    if (this.treasureBox) {
      try { this.treasureBox.stop(); } catch(_){}
    }
    this.treasureBox = null; // ensure fresh treasure box for next session
    this._saveTriggered = false; // allow new session save
    this.voiceMemos = [];
    this.participantRoster = [];
    this.currentGuestAssignments = {};
    this._stopAutosaveTimer();
    this._lastAutosaveAt = 0;
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
const NO_ZONE_LABEL = 'No Zone';

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
    this._timeline = {
      perColor: new Map(),
      cumulative: [],
      lastIndex: -1
    };
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
    if (this.sessionRef?.timebase) {
      this.sessionRef.timebase.intervalMs = this.coinTimeUnitMs;
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
        if (!this._timeline.perColor.has(z.color)) {
          this._timeline.perColor.set(z.color, []);
        }
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

  // Rename a user in the perUser map (used when guest assigned to preserve zone state)
  renameUser(oldName, newName) {
    if (!oldName || !newName || oldName === newName) return false;
    const acc = this.perUser.get(oldName);
    if (!acc) return false;
    // Copy the accumulator to the new name
    this.perUser.set(newName, { ...acc });
    // Remove the old entry
    this.perUser.delete(oldName);
    this._notifyMutation();
    return true;
  }

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

  _ensureTimelineIndex(index, color) {
    if (index < 0) return;
    if (color) {
      if (!this._timeline.perColor.has(color)) {
        this._timeline.perColor.set(color, []);
      }
      const colorSeries = this._timeline.perColor.get(color);
      while (colorSeries.length <= index) {
        const prev = colorSeries.length > 0 ? (colorSeries[colorSeries.length - 1] ?? 0) : 0;
        colorSeries.push(prev);
      }
    }
    const cumulative = this._timeline.cumulative;
    while (cumulative.length <= index) {
      const prev = cumulative.length > 0 ? (cumulative[cumulative.length - 1] ?? 0) : 0;
      cumulative.push(prev);
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
        currentColor: NO_ZONE_LABEL,
        lastColor: NO_ZONE_LABEL,
        lastZoneId: null,
      };
      this.perUser.set(userName, acc);
    }
    // HR dropout (<=0) resets interval without award
    if (!hr || hr <= 0 || Number.isNaN(hr)) {
      acc.currentIntervalStart = now;
      acc.highestZone = null;
      acc.lastHR = hr;
      acc.currentColor = NO_ZONE_LABEL;
      acc.lastColor = NO_ZONE_LABEL; // persist display as No Zone until first valid reading
      acc.lastZoneId = null;
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
      // If last HR went invalid later we'll set No Zone in HR branch; here we keep the lastColor but clear currentColor to signal awaiting new reading
      acc.currentColor = NO_ZONE_LABEL;
    }
  }

  _awardCoins(userName, zone) {
    if (!zone) return;
    if (!(zone.color in this.buckets)) this.buckets[zone.color] = 0;
    this.buckets[zone.color] += zone.coins;
    this.totalCoins += zone.coins;
    const start = this.sessionRef?.startTime || this.sessionRef?.timebase?.startAbsMs || Date.now();
    const intervalMs = this.coinTimeUnitMs > 0 ? this.coinTimeUnitMs : 5000;
    const now = Date.now();
    const intervalIndex = Math.floor(Math.max(0, now - start) / intervalMs);
    this._ensureTimelineIndex(intervalIndex, zone.color);
    const colorSeries = this._timeline.perColor.get(zone.color);
    if (colorSeries) {
      colorSeries[intervalIndex] += zone.coins;
    }
    if (this._timeline.cumulative.length > intervalIndex) {
      this._timeline.cumulative[intervalIndex] += zone.coins;
    }
    this._timeline.lastIndex = Math.max(this._timeline.lastIndex, intervalIndex);
    if (this.sessionRef?.timebase && intervalIndex + 1 > this.sessionRef.timebase.intervalCount) {
      this.sessionRef.timebase.intervalCount = intervalIndex + 1;
    }
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
    const intervalCount = Math.max(
      this._timeline.lastIndex + 1,
      this.sessionRef?.timebase?.intervalCount || 0
    );
    const normalizeTimeline = (arr = []) => {
      const series = Array.isArray(arr) ? arr.slice(0, intervalCount) : [];
      if (intervalCount > 0 && series.length < intervalCount) {
        ensureSeriesCapacity(series, intervalCount - 1);
      }
      return series.map((value) => (Number.isFinite(value) ? value : 0));
    };
    const perColorTimeline = {};
    this._timeline.perColor.forEach((series, color) => {
      perColorTimeline[color] = normalizeTimeline(series);
    });
    const cumulativeCoins = normalizeTimeline(this._timeline.cumulative);

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
      perColorTimeline,
      cumulativeCoins,
      intervalCount
    };
  }
}

/**
 * Custom hook for listening to fitness-specific WebSocket messages
 * This is now a wrapper around the FitnessContext for backward compatibility
 */
import { useFitnessContext } from '../context/FitnessContext.jsx';

export const useFitnessSession = () => {
  // Just return the context - the parameter is ignored as the context provider handles it
  // All implementation details have been moved to the FitnessContext
  return useFitnessContext();
};
