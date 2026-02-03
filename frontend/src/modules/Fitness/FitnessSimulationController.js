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
   * Start looping waveform automation (3-min cycle, repeats forever)
   * Phases: warmup → build → peak → cooldown
   */
  startAuto(deviceId) {
    const state = this._getOrCreateState(deviceId);

    // Stop any existing automation
    if (state.autoInterval) {
      clearInterval(state.autoInterval);
    }

    state.autoMode = 'waveform';
    state.startTime = Date.now();

    const phaseDur = 45; // 45s per phase, 180s total cycle

    const tick = () => {
      const elapsed = (Date.now() - state.startTime) / 1000;
      const phase = Math.floor(elapsed / phaseDur) % 4;
      const t = (elapsed % phaseDur) / phaseDur;

      let hr;
      switch (phase) {
        case 0: // Warmup: 80 → 110
          hr = 80 + t * 30;
          break;
        case 1: // Build: 110 → 150
          hr = 110 + t * 40;
          break;
        case 2: // Peak: 150 → 175 → 150
          hr = 150 + Math.sin(t * Math.PI) * 25;
          break;
        case 3: // Cooldown: 150 → 80
        default:
          hr = 150 - t * 70;
          break;
      }

      // Add small jitter
      hr += (Math.random() - 0.5) * 6;
      this._sendHR(deviceId, Math.round(hr));
    };

    // Send immediately and every 2 seconds
    tick();
    state.autoInterval = setInterval(tick, 2000);

    this._notifyStateChange();
    return { ok: true, deviceId, mode: 'waveform' };
  }

  /**
   * Start realistic session automation (ends after duration)
   *
   * @param {string} deviceId
   * @param {object} opts
   * @param {number} opts.duration - Total seconds (default 720 = 12 min)
   * @param {string} opts.intensity - 'easy' | 'moderate' | 'hard'
   * @param {number} opts.phaseOffset - Seconds to offset phase timing
   */
  startAutoSession(deviceId, opts = {}) {
    const {
      duration = 720,
      intensity = 'moderate',
      phaseOffset = 0
    } = opts;

    const state = this._getOrCreateState(deviceId);

    // Stop any existing automation
    if (state.autoInterval) {
      clearInterval(state.autoInterval);
    }

    state.autoMode = 'session';
    state.startTime = Date.now() - (phaseOffset * 1000);

    // Phase percentages of duration
    const phases = {
      warmup: 0.15,    // 15%: cool → active
      build: 0.25,     // 25%: active → warm → hot
      peak: 0.45,      // 45%: hot ↔ fire
      cooldown: 0.15   // 15%: → active → cool
    };

    // Intensity affects peak zone targets
    const peakHR = {
      easy: { low: 130, high: 150 },
      moderate: { low: 145, high: 170 },
      hard: { low: 160, high: 180 }
    }[intensity] || { low: 145, high: 170 };

    const tick = () => {
      const elapsed = (Date.now() - state.startTime) / 1000;

      // Session complete
      if (elapsed >= duration) {
        clearInterval(state.autoInterval);
        state.autoInterval = null;
        state.autoMode = null;
        this._notifyStateChange();
        return;
      }

      const progress = elapsed / duration;
      let hr;

      if (progress < phases.warmup) {
        // Warmup: 70 → 100
        const t = progress / phases.warmup;
        hr = 70 + t * 30;
      } else if (progress < phases.warmup + phases.build) {
        // Build: 100 → peakHR.low
        const t = (progress - phases.warmup) / phases.build;
        hr = 100 + t * (peakHR.low - 100);
      } else if (progress < phases.warmup + phases.build + phases.peak) {
        // Peak: oscillate between low and high
        const t = (progress - phases.warmup - phases.build) / phases.peak;
        hr = peakHR.low + Math.sin(t * Math.PI * 4) * ((peakHR.high - peakHR.low) / 2) + ((peakHR.high - peakHR.low) / 2);
      } else {
        // Cooldown: peakHR.low → 75
        const t = (progress - phases.warmup - phases.build - phases.peak) / phases.cooldown;
        hr = peakHR.low - t * (peakHR.low - 75);
      }

      // Add jitter
      hr += (Math.random() - 0.5) * 8;
      hr = Math.max(60, Math.min(185, hr));

      this._sendHR(deviceId, Math.round(hr));
    };

    tick();
    state.autoInterval = setInterval(tick, 2000);

    this._notifyStateChange();
    return { ok: true, deviceId, mode: 'session', duration };
  }

  /**
   * Stop automation for device
   */
  stopAuto(deviceId) {
    const state = this._getOrCreateState(deviceId);

    if (state.autoInterval) {
      clearInterval(state.autoInterval);
      state.autoInterval = null;
    }
    state.autoMode = null;

    this._notifyStateChange();
    return { ok: true, deviceId };
  }

  /**
   * Activate all configured devices at specified zone
   */
  activateAll(zone = 'active') {
    const devices = this.getDevices();
    const results = devices.map(d => this.setZone(d.deviceId, zone));
    return { ok: true, count: devices.length, results };
  }

  /**
   * Start auto session for all devices with random phase offsets
   */
  startAutoSessionAll(opts = {}) {
    const devices = this.getDevices();
    const results = devices.map((d, i) => {
      const offset = (i * 15) + Math.random() * 10; // Stagger by ~15-25s
      return this.startAutoSession(d.deviceId, { ...opts, phaseOffset: offset });
    });
    return { ok: true, count: devices.length, results };
  }

  /**
   * Stop all devices
   */
  stopAll() {
    const devices = this.getDevices();
    const results = devices.map(d => this.stopDevice(d.deviceId));
    return { ok: true, count: devices.length, results };
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
