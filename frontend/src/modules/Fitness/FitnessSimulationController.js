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
