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
    super(deviceId, 'HeartRate', rawData);
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
 * Speed Device class
 */
class SpeedDevice extends Device {
  constructor(deviceId, rawData = {}) {
    super(deviceId, 'Speed', rawData);
    this.type = 'speed';
    // If the cumulative revolution field exists, we treat this device as an RPM (wheel) meter only
    // and intentionally ignore instantaneous speed so the UI does not show speed before RPM is available.
    this.isRpmOnly = rawData.CumulativeSpeedRevolutionCount !== undefined;
    this.speed = this.isRpmOnly ? 0 : (rawData.CalculatedSpeed || 0); // m/s (suppressed when rpm-only)
    this.speedKmh = this.isRpmOnly ? 0 : (rawData.CalculatedSpeed ? (rawData.CalculatedSpeed * 3.6) : 0);
    // Distance can also be misleading for rpm-only usage; keep but zero if rpm-only to avoid premature display.
    this.distance = this.isRpmOnly ? 0 : (rawData.CalculatedDistance || 0);
    this.revolutionCount = rawData.CumulativeSpeedRevolutionCount || 0;
    this.eventTime = rawData.SpeedEventTime || 0;
    // RPM tracking (wheel RPM derived from revolution count & event time)
    this.prevRevolutionCount = null;
    this.prevEventTime = null;
    this.instantRpm = 0;      // raw instantaneous RPM calculation
    this.smoothedRpm = 0;     // exponentially smoothed RPM
    this._rpmAlpha = 0.3;     // smoothing factor (EMA)
    this.lastRevolutionEpoch = null; // Date of last revolution (wall clock)
    this._rpmInactivityMs = 5000;   // 15s inactivity threshold
  }

  updateData(rawData) {
    super.updateData(rawData);

    // Preserve previous values for RPM computation
    const prevRev = this.revolutionCount;
    const prevTime = this.eventTime;

    // Update with new raw values
    // If at any point we detect the cumulative revolution field, lock into rpm-only mode
    if (rawData.CumulativeSpeedRevolutionCount !== undefined) {
      this.isRpmOnly = true;
    }
    if (this.isRpmOnly) {
      // Suppress speed & distance so UI relies solely on RPM
      this.speed = 0;
      this.speedKmh = 0;
      this.distance = 0; // Could keep accumulating if desired; requirement says to ignore speed entirely
    } else {
      this.speed = rawData.CalculatedSpeed || 0;
      this.speedKmh = rawData.CalculatedSpeed ? (rawData.CalculatedSpeed * 3.6) : 0;
      this.distance = rawData.CalculatedDistance || 0;
    }
    this.revolutionCount = rawData.CumulativeSpeedRevolutionCount || 0;
    this.eventTime = rawData.SpeedEventTime || 0;

    // ANT+ spec: event time unit = 1/1024 s, 16-bit rollover (0..65535)
    const MAX_16 = 0x10000; // 65536

    if (prevRev !== null && prevTime !== null) {
      let revDiff = this.revolutionCount - prevRev;
      if (revDiff < 0) revDiff += MAX_16; // handle rollover

      let timeDiff = this.eventTime - prevTime;
      if (timeDiff < 0) timeDiff += MAX_16; // handle rollover

      // Convert event time ticks (1/1024 s) to seconds
      const seconds = timeDiff / 1024;
      if (seconds > 0 && revDiff >= 0) {
        if (revDiff > 0) {
          const rpm = (revDiff / seconds) * 60; // revolutions per minute
          // Basic sanity filter: ignore implausible spikes
            if (rpm > 0 && rpm < 400) {
              this.instantRpm = rpm;
              this.smoothedRpm = this.smoothedRpm === 0
                ? rpm
                : (this._rpmAlpha * rpm) + (1 - this._rpmAlpha) * this.smoothedRpm;
              this.lastRevolutionEpoch = Date.now();
            }
        } else {
          // No new revolutions; check inactivity window based on wall clock
          if (this.lastRevolutionEpoch && (Date.now() - this.lastRevolutionEpoch) > this._rpmInactivityMs) {
            this.instantRpm = 0;
            this.smoothedRpm = 0;
          }
        }
      }
    }

    this.prevRevolutionCount = this.revolutionCount;
    this.prevEventTime = this.eventTime;

    // If we have never recorded a revolution yet, ensure RPM is zero
    if (this.lastRevolutionEpoch === null) {
      this.instantRpm = 0;
      this.smoothedRpm = 0;
    }
  }

  // Getter to expose the best RPM estimate (prefer smoothed)
  get wheelRpm() {
    return this.smoothedRpm || this.instantRpm || 0;
  }
}

/**
 * Cadence Device class
 */
class CadenceDevice extends Device {
  constructor(deviceId, rawData = {}) {
    super(deviceId, 'Cadence', rawData);
    this.type = 'cadence';
    this.cadence = rawData.CalculatedCadence || 0;
    this.revolutionCount = rawData.CumulativeCadenceRevolutionCount || 0;
    this.eventTime = rawData.CadenceEventTime || 0;
  }

  updateData(rawData) {
    super.updateData(rawData);
    this.cadence = rawData.CalculatedCadence || 0;
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
    this.power = rawData.InstantaneousPower || 0;
    this.cadence = rawData.Cadence || 0;
    this.pedalPowerBalance = rawData.PedalPowerBalance || 0;
  }

  updateData(rawData) {
    super.updateData(rawData);
    this.power = rawData.InstantaneousPower || 0;
    this.cadence = rawData.Cadence || 0;
    this.pedalPowerBalance = rawData.PedalPowerBalance || 0;
  }
}

/**
 * Device Factory for creating appropriate device instances
 */
class DeviceFactory {
  static createDevice(deviceId, profile, rawData = {}) {
    const normalizedProfile = profile.toLowerCase();
    
    switch (normalizedProfile) {
      case 'hr':
      case 'heartrate':
        return new HeartRateDevice(deviceId, rawData);
      case 'spd':
      case 'speed':
        return new SpeedDevice(deviceId, rawData);
      case 'cad':
      case 'cadence':
        return new CadenceDevice(deviceId, rawData);
      case 'pwr':
      case 'power':
        return new PowerDevice(deviceId, rawData);
      default:
        return new Device(deviceId, profile, rawData);
    }
  }
}

/**
 * User class for tracking individual user data and metrics
 */
class User {
  constructor(name, birthyear, hrDeviceId = null, cadenceDeviceId = null) {
    this.name = name;
    this.birthyear = birthyear;
    this.hrDeviceId = hrDeviceId;
    this.cadenceDeviceId = cadenceDeviceId;
    this.age = new Date().getFullYear() - birthyear;
    
    // Private data storage
    this._cumulativeData = {
      heartRate: {
        readings: [],
        avgHR: 0,
        maxHR: 0,
        minHR: 0,
        zones: { zone1: 0, zone2: 0, zone3: 0, zone4: 0, zone5: 0 }
      },
      cadence: {
        readings: [],
        avgRPM: 0,
        maxRPM: 0,
        totalRevolutions: 0
      },
      power: {
        readings: [],
        avgPower: 0,
        maxPower: 0,
        totalWork: 0
      },
      distance: {
        total: 0,
        sessions: []
      },
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
  updateFromDevice(device) {
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
 *Custom hook for listening to fitness-specific WebSocket messages
 * Connects to the same /ws endpoint but only processes fitness topic messages
 */
export const useFitnessWebSocket = (fitnessConfiguration) => {

  const ant_devices = fitnessConfiguration?.fitness?.ant_devices || {};
  const usersConfig = fitnessConfiguration?.fitness?.users || {};

  const [connected, setConnected] = useState(false);
  const [latestData, setLatestData] = useState(null);
  const [fitnessDevices, setFitnessDevices] = useState(new Map());
  const [users, setUsers] = useState(new Map());
  const [lastUpdate, setLastUpdate] = useState(null);
  
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const baseReconnectDelay = 1000;

  // Initialize users from configuration
  useEffect(() => {
    const userMap = new Map();
    
    // Process primary users
    if (usersConfig.primary) {
      usersConfig.primary.forEach(userConfig => {
        const user = new User(
          userConfig.name,
          userConfig.birthyear,
          userConfig.hr,
          userConfig.cadence
        );
        userMap.set(userConfig.name, user);
      });
    }

    // Process secondary users
    if (usersConfig.secondary) {
      usersConfig.secondary.forEach(userConfig => {
        const user = new User(
          userConfig.name,
          userConfig.birthyear,
          userConfig.hr,
          userConfig.cadence
        );
        userMap.set(userConfig.name, user);
      });
    }

    setUsers(userMap);
  }, [usersConfig]);

  // Function to create WebSocket connection
  const connectWebSocket = () => {
    if (wsRef.current?.readyState === WebSocket.CONNECTING) {
      console.log('Fitness WebSocket connection already in progress');
      return;
    }

    const isLocalhost = /localhost/.test(window.location.href);
    const baseUrl = isLocalhost ? 'http://localhost:3112' : window.location.origin;
    const wsUrl = baseUrl.replace(/^http/, 'ws') + '/ws';
    
    console.log(`Fitness WebSocket connecting to: ${wsUrl}`);
    
    const ws = new window.WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      reconnectAttemptsRef.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Only process fitness messages
        if (data.topic === 'fitness') {
          setLatestData(data);
          setLastUpdate(new Date());
          
          // Process ANT+ device data
          if (data.type === 'ant' && data.deviceId && data.data) {
            const deviceId = String(data.deviceId);
            const profile = data.profile;
            const rawData = data.data;
            
            console.log(`� Processing ${profile} device ${deviceId}:`, rawData);
            
            // Legacy extraction logic removed; handled by Device subclasses
            
            setFitnessDevices(prevDevices => {
              const newDevices = new Map(prevDevices);
              
              // Get existing device or create new one using factory
              let device = newDevices.get(deviceId);
              if (device) {
                // Update existing device
                device.updateData({
                  ...rawData,
                  dongleIndex: data.dongleIndex,
                  timestamp: data.timestamp
                });
              } else {
                // Create new device using factory
                device = DeviceFactory.createDevice(deviceId, profile, {
                  ...rawData,
                  dongleIndex: data.dongleIndex,
                  timestamp: data.timestamp
                });
              }
              
              newDevices.set(deviceId, device);
              return newDevices;
            });

            // Update user data based on device readings - needs to be after device update
            setTimeout(() => {
              setUsers(prevUsers => {
                const newUsers = new Map(prevUsers);
                
                // Find users who have this device assigned
                for (const [userName, user] of newUsers.entries()) {
                  if (String(user.hrDeviceId) === deviceId || 
                      String(user.cadenceDeviceId) === deviceId) {
                    
                    // Get the current device from state
                    setFitnessDevices(currentDevices => {
                      const device = currentDevices.get(deviceId);
                      if (device) {
                        user.updateFromDevice(device);
                        newUsers.set(userName, user);
                      }
                      return currentDevices;
                    });
                  }
                }
                
                return newUsers;
              });
            }, 0);
          }
        }
      } catch (e) {
        // ignore non-JSON or irrelevant messages
        console.debug('Fitness WebSocket: Non-JSON message received');
      }
    };

    ws.onclose = (event) => {
      console.log('Fitness WebSocket disconnected:', event.code, event.reason);
      setConnected(false);
      wsRef.current = null;
      
      // Attempt to reconnect
      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        const delay = Math.min(baseReconnectDelay * Math.pow(2, reconnectAttemptsRef.current), 30000);
        console.log(`Fitness WebSocket reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1}/${maxReconnectAttempts})`);
        
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectAttemptsRef.current++;
          connectWebSocket();
        }, delay);
      } else {
        console.log('Fitness WebSocket: Max reconnection attempts reached');
      }
    };

    ws.onerror = (err) => {
      console.error('Fitness WebSocket error:', err);
      setConnected(false);
    };
  };

  // Clean up inactive devices periodically
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const now = new Date();
      setFitnessDevices(prevDevices => {
        const newDevices = new Map(prevDevices);
        let hasChanges = false;
        
        for (const [deviceId, device] of newDevices.entries()) {
          const timeSinceLastSeen = now - device.lastSeen;
          // Mark as inactive after 60 seconds, remove after 3 minutes
          if (timeSinceLastSeen > 180000) { // 3 minutes
            newDevices.delete(deviceId);
            hasChanges = true;
          } else if (timeSinceLastSeen > 60000 && device.isActive) { // 60 seconds
            newDevices.set(deviceId, { ...device, isActive: false });
            hasChanges = true;
          }

          // Additional RPM inactivity handling: if this is a speed (rpm-only) device and
          // no revolutions have occurred within the inactivity window (10-15s), force RPM to zero
          if (device.type === 'speed' && device.isRpmOnly && device.lastRevolutionEpoch) {
            const inactivityMs = device._rpmInactivityMs || 8000;
            if ((Date.now() - device.lastRevolutionEpoch) > inactivityMs) {
              if (device.instantRpm !== 0 || device.smoothedRpm !== 0) {
                device.instantRpm = 0;
                device.smoothedRpm = 0;
                hasChanges = true; // reflect change so state updates
              }
            }
          }
        }
        
        return hasChanges ? newDevices : prevDevices;
      });
    }, 3000); // Check every 3 seconds

    return () => clearInterval(cleanupInterval);
  }, []);

  useEffect(() => {
    connectWebSocket();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const allDevices = Array.from(fitnessDevices.values());
  const allUsers = Array.from(users.values());
  
  return {
    connected,
    latestData,
    allDevices,
    deviceCount: fitnessDevices.size,
    lastUpdate,
    
    // User-related data (NEW OOP features)
    users: allUsers,
    userCount: users.size,
    primaryUsers: allUsers.filter(user => 
      usersConfig.primary?.some(config => config.name === user.name)
    ),
    secondaryUsers: allUsers.filter(user => 
      usersConfig.secondary?.some(config => config.name === user.name)
    ),
    
    // Device configuration info
    deviceConfiguration: ant_devices,
    
    // Categorized device arrays (backward compatible)
    heartRateDevices: allDevices.filter(d => d.type === 'heart_rate'),
    speedDevices: allDevices.filter(d => d.type === 'speed'),
    cadenceDevices: allDevices.filter(d => d.type === 'cadence'),
    powerDevices: allDevices.filter(d => d.type === 'power'),
    unknownDevices: allDevices.filter(d => d.type === 'unknown'),
    
    // Legacy compatibility - return the most recent heart rate device
    heartRate: allDevices.find(d => d.type === 'heart_rate') || null,
    
    // Helper functions for user lookups
    getUserByName: (name) => users.get(name),
    getUserByDevice: (deviceId) => allUsers.find(user => 
      String(user.hrDeviceId) === String(deviceId) || 
      String(user.cadenceDeviceId) === String(deviceId)
    ),
    
    // Reset all user sessions
    resetAllUserSessions: () => {
      users.forEach(user => user.resetSession());
    }
  };
};
