import { slugifyId, resolveDisplayLabel, deepClone } from './types.js';

export class Device {
  constructor(data = {}) {
    this.id = slugifyId(data.id || data.deviceId || `device-${Date.now()}`);
    this.name = data.name || `Device ${this.id}`;
    this.type = data.type || 'unknown';
    this.profile = data.profile || null;
    
    this.batteryLevel = Number.isFinite(data.batteryLevel) ? data.batteryLevel : null;
    this.isCharging = !!data.isCharging;
    this.lastSeen = data.lastSeen || Date.now();
    this.assignedUser = data.assignedUser || null; // userId
    this.connectionState = data.connectionState || 'disconnected';
    
    // Inactivity Lifecycle
    this.inactiveSince = data.inactiveSince || null;
    this.removalAt = data.removalAt || null;
    this.removalCountdown = Number.isFinite(data.removalCountdown) ? data.removalCountdown : null;
    this.lastSignificantActivity = data.lastSignificantActivity || this.lastSeen;

    // 5A: Track last occupant for detecting reassignments
    this.lastOccupantSlug = data.lastOccupantSlug || null;
    this._isNew = false; // Flag for newly registered devices

    // Sensor Data
    this.heartRate = Number.isFinite(data.heartRate) ? data.heartRate : null;
    this.cadence = Number.isFinite(data.cadence) ? data.cadence : null;
    this.power = Number.isFinite(data.power) ? data.power : null;
    this.speed = Number.isFinite(data.speed) ? data.speed : null;
    this.distance = Number.isFinite(data.distance) ? data.distance : null;
    this.revolutionCount = Number.isFinite(data.revolutionCount) ? data.revolutionCount : null;
    this.timestamp = data.timestamp || null;
  }

  get deviceId() {
    return this.id;
  }

  get isActive() {
    return !this.inactiveSince;
  }

  resetMetrics() {
    this.cadence = 0;
    this.power = 0;
    this.speed = 0;
    this.heartRate = null;
  }

  update(data = {}) {
    if (data.name) this.name = data.name;
    if (data.type) this.type = data.type;
    if (data.profile) this.profile = data.profile;
    
    if (Number.isFinite(data.batteryLevel)) this.batteryLevel = data.batteryLevel;
    if (typeof data.isCharging === 'boolean') this.isCharging = data.isCharging;
    if (data.lastSeen) this.lastSeen = data.lastSeen;
    if (data.connectionState) this.connectionState = data.connectionState;
    
    if (Number.isFinite(data.heartRate)) this.heartRate = data.heartRate;
    if (Number.isFinite(data.cadence)) this.cadence = data.cadence;
    if (Number.isFinite(data.power)) this.power = data.power;
    if (Number.isFinite(data.speed)) this.speed = data.speed;
    if (Number.isFinite(data.distance)) this.distance = data.distance;
    if (Number.isFinite(data.revolutionCount)) this.revolutionCount = data.revolutionCount;
    if (data.timestamp) this.timestamp = data.timestamp;

    // Check for significant activity to reset inactivity flags
    const hasHeartRate = Number.isFinite(this.heartRate) && this.heartRate > 0;
    const hasCadence = Number.isFinite(this.cadence) && this.cadence > 0;
    const hasPower = Number.isFinite(this.power) && this.power > 0;
    const hasSpeed = Number.isFinite(this.speed) && this.speed > 0;
    
    if (hasHeartRate || hasCadence || hasPower || hasSpeed) {
      this.lastSignificantActivity = Date.now();
      this.inactiveSince = null;
      this.removalAt = null;
      this.removalCountdown = null;
    }
  }

  serialize() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      profile: this.profile,
      batteryLevel: this.batteryLevel,
      isCharging: this.isCharging,
      lastSeen: this.lastSeen,
      assignedUser: this.assignedUser,
      connectionState: this.connectionState,
      inactiveSince: this.inactiveSince,
      removalAt: this.removalAt,
      removalCountdown: this.removalCountdown,
      lastSignificantActivity: this.lastSignificantActivity,
      heartRate: this.heartRate,
      cadence: this.cadence,
      power: this.power,
      speed: this.speed,
      distance: this.distance
    };
  }

  getMetricsSnapshot() {
    return {
      deviceId: this.id,
      label: this.name,
      type: this.type,
      rpm: Number.isFinite(this.cadence) ? this.cadence : null,
      cadence: Number.isFinite(this.cadence) ? this.cadence : null,
      power: Number.isFinite(this.power) ? this.power : null,
      heartRate: Number.isFinite(this.heartRate) ? this.heartRate : null,
      speed: Number.isFinite(this.speed) ? this.speed : null,
      distance: Number.isFinite(this.distance) ? this.distance : null,
      revolutionCount: Number.isFinite(this.revolutionCount) ? this.revolutionCount : null,
      timestamp: Number.isFinite(this.timestamp) ? this.timestamp : this.lastSeen
    };
  }
}

export class DeviceManager {
  constructor() {
    this.devices = new Map(); // deviceId -> Device
  }

  updateDevice(deviceId, profile, rawData) {
    const id = slugifyId(deviceId);
    if (!id) return null;

    // Normalize raw ANT+ data
    const normalized = {
      id,
      profile,
      lastSeen: Date.now(),
      connectionState: 'connected'
    };

    // Map ANT+ fields to normalized fields
    if (rawData) {
      if (Number.isFinite(rawData.ComputedHeartRate)) {
        normalized.heartRate = rawData.ComputedHeartRate;
        normalized.type = 'heart_rate';
      }
      if (Number.isFinite(rawData.CalculatedCadence)) {
        normalized.cadence = rawData.CalculatedCadence;
        normalized.type = normalized.type || 'cadence';
      }
      if (Number.isFinite(rawData.InstantaneousPower)) {
        normalized.power = rawData.InstantaneousPower;
        normalized.type = 'power';
      }
      if (Number.isFinite(rawData.CumulativeCadenceRevolutionCount)) {
        normalized.revolutionCount = rawData.CumulativeCadenceRevolutionCount;
      }
      if (Number.isFinite(rawData.BatteryLevel)) {
        normalized.batteryLevel = rawData.BatteryLevel;
      }
      // Add other mappings as needed
    }

    return this.registerDevice(normalized);
  }

  registerDevice(data) {
    const id = slugifyId(data.id || data.deviceId);
    if (!id) return null;

    let device = this.devices.get(id);
    let isNew = false;
    if (!device) {
      device = new Device({ ...data, id });
      this.devices.set(id, device);
      isNew = true; // 5A: Flag for newly registered devices
    } else {
      device.update(data);
    }
    // 5A: Attach isNew flag to device object for caller to check
    device._isNew = isNew;
    return device;
  }

  removeDevice(deviceId) {
    const id = slugifyId(deviceId);
    if (!id) return false;
    return this.devices.delete(id);
  }

  getDevice(id) {
    return this.devices.get(slugifyId(id));
  }

  getAllDevices() {
    return Array.from(this.devices.values());
  }

  assignDeviceToUser(deviceId, userId) {
    const device = this.getDevice(deviceId);
    if (device) {
      // Unassign from other users if needed (optional policy)
      // For now, just set the user
      device.assignedUser = userId;
      return true;
    }
    return false;
  }

  unassignDevice(deviceId) {
    const device = this.getDevice(deviceId);
    if (device) {
      device.assignedUser = null;
      return true;
    }
    return false;
  }

  getDevicesForUser(userId) {
    return this.getAllDevices().filter(d => d.assignedUser === userId);
  }

  pruneStaleDevices(config = {}) {
    const now = Date.now();
    const staleIds = [];
    
    // Handle legacy signature (timeoutMs) or new config object
    const timeouts = typeof config === 'number' 
      ? { inactive: config, remove: config * 3, rpmZero: 12000 }
      : { 
          inactive: config.inactive || 60000, 
          remove: config.remove || 180000, 
          rpmZero: config.rpmZero || 12000 
        };

    for (const [id, device] of this.devices) {
      // Determine effective last activity time
      // For cadence devices, we use lastSignificantActivity to handle 0 RPM coasting
      // For others, we use lastSeen (which updates on every packet)
      const isCadence = device.type === 'cadence' || (device.cadence !== null && device.type !== 'heart_rate');
      
      // Use lastSignificantActivity for cadence devices so they timeout when stopped (even if connected)
      // Use lastSeen for HR/others so they only timeout when disconnected
      const effectiveLastActivity = isCadence ? (device.lastSignificantActivity || device.lastSeen) : device.lastSeen;
      
      const timeSinceActivity = now - effectiveLastActivity;

      // 0. Check for RPM Zeroing (stale data while connected)
      // If we haven't had significant activity (pedaling) for a while, reset display values to 0
      const timeSinceSignificant = now - (device.lastSignificantActivity || device.lastSeen);
      if (isCadence && timeSinceSignificant > timeouts.rpmZero) {
        if (device.cadence > 0 || device.power > 0 || device.speed > 0) {
          device.resetMetrics();
        }
      }
      
      // 1. Check for Inactivity (Connection Loss OR Stopped Pedaling)
      if (timeSinceActivity > timeouts.inactive) {
        if (!device.inactiveSince) {
          device.inactiveSince = now;
          device.removalAt = now + (timeouts.remove - timeouts.inactive);
        }
        
        // 2. Calculate Countdown
        if (device.removalAt) {
          const totalGracePeriod = timeouts.remove - timeouts.inactive;
          const remaining = device.removalAt - now;
          device.removalCountdown = Math.max(0, Math.min(1, remaining / totalGracePeriod));
        }
        
        // 3. Check for Removal
        if (now > device.removalAt) {
          staleIds.push(id);
        }
      } else {
        // Device is active or re-connected
        if (device.inactiveSince) {
          device.inactiveSince = null;
          device.removalAt = null;
          device.removalCountdown = null;
        }
      }
    }
    
    staleIds.forEach(id => this.devices.delete(id));
    return staleIds;
  }
  
  serialize() {
    return this.getAllDevices().map(d => d.serialize());
  }
  
  hydrate(data) {
      if (Array.isArray(data)) {
          data.forEach(d => this.registerDevice(d));
      }
  }
}
