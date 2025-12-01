import { slugifyId, resolveDisplayLabel, deepClone } from './types';

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
      heartRate: this.heartRate,
      cadence: this.cadence,
      power: this.power,
      speed: this.speed,
      distance: this.distance
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
    if (!device) {
      device = new Device({ ...data, id });
      this.devices.set(id, device);
    } else {
      device.update(data);
    }
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

  pruneStaleDevices(timeoutMs = 60000) {
    const now = Date.now();
    const staleIds = [];
    for (const [id, device] of this.devices) {
      if (now - device.lastSeen > timeoutMs && device.connectionState !== 'connected') {
        staleIds.push(id);
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
