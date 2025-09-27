import { useState, useEffect, useRef } from 'react';

/**
 * Base Device class for all ANT+ fitness devices
 */
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

  isInactive(timeoutMs = 60000) {
    return (new Date() - this.lastSeen) > timeoutMs;
  }

  shouldBeRemoved(timeoutMs = 180000) {
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
