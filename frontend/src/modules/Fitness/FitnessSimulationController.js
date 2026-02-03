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

  /**
   * Build ANT+ HR message in format expected by DeviceManager
   */
  _buildHRMessage(deviceId, hr) {
    const state = this._getOrCreateState(deviceId);
    const now = Date.now();
    const elapsedSeconds = Math.floor((now - (state.startTime || now)) / 1000);

    // Increment beat count based on HR (beats per second * 2 for ~2s interval)
    state.beatCount = (state.beatCount + Math.round(hr / 30)) % 256;
    state.lastHR = hr;
    state.lastSent = now;

    const beatTime = (elapsedSeconds * 1024) % 65536;

    return {
      topic: 'fitness',
      source: 'fitness-simulator',
      type: 'ant',
      timestamp: new Date().toISOString(),
      profile: 'HR',
      deviceId: String(deviceId),
      dongleIndex: 0,
      data: {
        ManId: 255,
        SerialNumber: parseInt(deviceId, 10),
        HwVersion: 5,
        SwVersion: 1,
        ModelNum: 2,
        BatteryLevel: 100,
        BatteryVoltage: 4.15625,
        BatteryStatus: 'Good',
        DeviceID: parseInt(deviceId, 10),
        Channel: 0,
        BeatTime: beatTime,
        BeatCount: state.beatCount,
        ComputedHeartRate: hr,
        PreviousBeat: beatTime - 1024,
        OperatingTime: elapsedSeconds * 1000
      }
    };
  }

  /**
   * Get or create device state entry
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
        startTime: Date.now()
      });
    }
    return this.deviceState.get(id);
  }

  /**
   * Send HR message via WebSocket
   */
  _sendHR(deviceId, hr) {
    const message = this._buildHRMessage(deviceId, hr);
    this.wsService?.send?.(message);
    this._notifyStateChange();
    return { ok: true, hr, deviceId };
  }

  /**
   * Notify listeners of state change
   */
  _notifyStateChange() {
    if (typeof this.onStateChange === 'function') {
      this.onStateChange();
    }
  }

  /**
   * Set device to specific zone's midpoint HR
   */
  setZone(deviceId, zone) {
    const hr = this.zoneMidpoints[zone];
    if (hr == null) {
      return { ok: false, error: `Invalid zone: ${zone}` };
    }
    return this._sendHR(deviceId, hr);
  }

  /**
   * Set device to exact HR value
   */
  setHR(deviceId, bpm) {
    if (bpm < 40 || bpm > 220) {
      return { ok: false, error: `HR out of range (40-220): ${bpm}` };
    }
    return this._sendHR(deviceId, Math.round(bpm));
  }

  /**
   * Stop sending data for device (triggers dropout)
   */
  stopDevice(deviceId) {
    const state = this._getOrCreateState(deviceId);

    // Stop any automation
    if (state.autoInterval) {
      clearInterval(state.autoInterval);
      state.autoInterval = null;
    }
    state.autoMode = null;
    state.lastHR = null;
    state.lastSent = null;

    this._notifyStateChange();
    return { ok: true, deviceId };
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
