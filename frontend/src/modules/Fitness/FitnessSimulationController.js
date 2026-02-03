// frontend/src/modules/Fitness/FitnessSimulationController.js

/**
 * FitnessSimulationController
 *
 * Localhost-only controller for simulating HR device data during testing.
 * Exposes methods for manual control, automation, and governance testing.
 *
 * Data flows through normal WebSocket pipeline to FitnessContext.
 */
export class FitnessSimulationController {
  constructor({ wsService, getSession, zoneConfig }) {
    this.wsService = wsService;
    this.getSession = getSession;
    this.zoneConfig = zoneConfig;

    // Per-device state tracking
    this.deviceState = new Map(); // deviceId -> { beatCount, autoInterval, autoMode, lastHR }

    // Governance override state
    this.governanceOverride = null;
    this.challengeState = null;
    this.stats = { challengesWon: 0, challengesFailed: 0 };

    // State change callback for popup sync
    this.onStateChange = null;

    this._computeZoneMidpoints();
  }

  /**
   * Compute midpoint HR for each zone from config
   * Midpoint = (thisZone.min + nextZone.min) / 2
   * For last zone: min + 15
   */
  _computeZoneMidpoints() {
    this.zoneMidpoints = {};
    const zones = this.zoneConfig?.zones || [];

    for (let i = 0; i < zones.length; i++) {
      const zone = zones[i];
      const nextZone = zones[i + 1];

      if (nextZone) {
        this.zoneMidpoints[zone.id] = Math.round((zone.min + nextZone.min) / 2);
      } else {
        // Last zone (fire): min + 15
        this.zoneMidpoints[zone.id] = zone.min + 15;
      }
    }
  }

  /**
   * Get configured devices from session
   */
  getDevices() {
    const session = this.getSession();
    if (!session?.deviceManager) return [];

    const hrDevices = session.deviceManager.getHeartRateDevices?.() || [];

    return hrDevices.map(device => {
      const state = this.deviceState.get(String(device.deviceId)) || {};
      return {
        deviceId: String(device.deviceId),
        name: device.userName || device.name || `Device ${device.deviceId}`,
        currentHR: state.lastHR || null,
        currentZone: this._hrToZone(state.lastHR),
        isActive: state.lastHR != null && Date.now() - (state.lastSent || 0) < 5000,
        autoMode: state.autoMode || null,
        beatCount: state.beatCount || 0
      };
    });
  }

  /**
   * Get only devices currently sending data
   */
  getActiveDevices() {
    return this.getDevices().filter(d => d.isActive);
  }

  /**
   * Convert HR to zone ID
   */
  _hrToZone(hr) {
    if (hr == null) return null;
    const zones = this.zoneConfig?.zones || [];
    for (let i = zones.length - 1; i >= 0; i--) {
      if (hr >= zones[i].min) return zones[i].id;
    }
    return zones[0]?.id || null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Manual Control Methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Build ANT+ HR message format
   * @param {string} deviceId - Device ID
   * @param {number} hr - Heart rate in BPM
   * @returns {object} - ANT+ formatted message
   */
  _buildHRMessage(deviceId, hr) {
    const state = this._getOrCreateState(deviceId);
    state.beatCount = (state.beatCount || 0) + 1;

    const now = Date.now();
    const beatTime = Math.round((now % 65536) * 1.024); // ANT+ 1/1024s resolution

    return {
      topic: 'fitness/hr',
      source: 'simulation',
      type: 'hr',
      timestamp: now,
      profile: 'HeartRate',
      deviceId: parseInt(deviceId, 10),
      dongleIndex: 0,
      data: {
        ManId: 1,
        SerialNumber: parseInt(deviceId, 10),
        HwVersion: 1,
        SwVersion: 1,
        ModelNum: 1,
        BatteryLevel: 100,
        BatteryVoltage: 3.0,
        BatteryStatus: 'Good',
        DeviceID: parseInt(deviceId, 10),
        Channel: 0,
        BeatTime: beatTime,
        BeatCount: state.beatCount,
        ComputedHeartRate: hr,
        PreviousBeat: state.lastBeatTime || beatTime - 1000,
        OperatingTime: Math.floor((now - (state.startTime || now)) / 1000)
      }
    };
  }

  /**
   * Get or create device state entry
   * @param {string} deviceId - Device ID
   * @returns {object} - Device state object
   */
  _getOrCreateState(deviceId) {
    const id = String(deviceId);
    if (!this.deviceState.has(id)) {
      this.deviceState.set(id, {
        beatCount: 0,
        autoInterval: null,
        autoMode: null,
        lastHR: null,
        lastSent: null,
        lastBeatTime: null,
        startTime: Date.now()
      });
    }
    return this.deviceState.get(id);
  }

  /**
   * Send HR message via WebSocket
   * @param {string} deviceId - Device ID
   * @param {number} hr - Heart rate in BPM
   */
  _sendHR(deviceId, hr) {
    const message = this._buildHRMessage(deviceId, hr);
    const state = this._getOrCreateState(deviceId);

    state.lastHR = hr;
    state.lastSent = Date.now();
    state.lastBeatTime = message.data.BeatTime;

    if (this.wsService?.send) {
      this.wsService.send(message);
    }
  }

  /**
   * Notify listeners of state change
   */
  _notifyStateChange() {
    if (typeof this.onStateChange === 'function') {
      this.onStateChange(this.getDevices());
    }
  }

  /**
   * Set device to zone's midpoint HR
   * @param {string} deviceId - Device ID
   * @param {string} zone - Zone ID (e.g., 'rest', 'warmup', 'cardio', 'peak', 'fire')
   * @returns {{ ok: boolean, deviceId?: string, zone?: string, hr?: number, error?: string }}
   */
  setZone(deviceId, zone) {
    const hr = this.zoneMidpoints[zone];
    if (hr == null) {
      return { ok: false, error: `Unknown zone: ${zone}` };
    }

    this._sendHR(deviceId, hr);
    this._notifyStateChange();

    return { ok: true, deviceId: String(deviceId), zone, hr };
  }

  /**
   * Set device to exact HR value
   * @param {string} deviceId - Device ID
   * @param {number} bpm - Heart rate in BPM (valid range: 40-220)
   * @returns {{ ok: boolean, deviceId?: string, hr?: number, error?: string }}
   */
  setHR(deviceId, bpm) {
    const hr = parseInt(bpm, 10);
    if (isNaN(hr) || hr < 40 || hr > 220) {
      return { ok: false, error: `Invalid HR: ${bpm}. Must be between 40 and 220.` };
    }

    this._sendHR(deviceId, hr);
    this._notifyStateChange();

    return { ok: true, deviceId: String(deviceId), hr };
  }

  /**
   * Stop sending data for device (triggers dropout)
   * @param {string} deviceId - Device ID
   * @returns {{ ok: boolean, deviceId?: string, error?: string }}
   */
  stopDevice(deviceId) {
    const id = String(deviceId);
    const state = this.deviceState.get(id);

    if (!state) {
      return { ok: false, error: `Device not found: ${deviceId}` };
    }

    // Clear any auto interval
    if (state.autoInterval) {
      clearInterval(state.autoInterval);
      state.autoInterval = null;
    }

    // Clear state to trigger dropout detection
    state.lastHR = null;
    state.lastSent = null;
    state.autoMode = null;

    this._notifyStateChange();

    return { ok: true, deviceId: id };
  }

  /**
   * Cleanup on destroy
   */
  destroy() {
    // Clear all auto intervals
    for (const state of this.deviceState.values()) {
      if (state.autoInterval) {
        clearInterval(state.autoInterval);
      }
    }
    this.deviceState.clear();

    // Clear challenge timers
    if (this.challengeState?.timer) {
      clearTimeout(this.challengeState.timer);
    }
    this.challengeState = null;
    this.governanceOverride = null;
  }
}
