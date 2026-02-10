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
  constructor({ wsService, getSession, zoneConfig, getUsersConfig }) {
    this.wsService = wsService;
    this.getSession = getSession;
    this.zoneConfig = zoneConfig;
    this.getUsersConfig = getUsersConfig;

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
   * Get configured devices from usersConfig.primary
   * Falls back to live session devices if config unavailable
   */
  getDevices() {
    // Get current usersConfig via getter (may change during session)
    const usersConfig = this.getUsersConfig?.() || {};

    // First try to get devices from usersConfig.primary (configured users)
    const primaryUsers = Array.isArray(usersConfig?.primary) ? usersConfig.primary : [];

    if (primaryUsers.length > 0) {
      return primaryUsers
        .filter(user => user.hr) // Only users with HR device configured
        .map(user => {
          const deviceId = String(user.hr);
          const state = this.deviceState.get(deviceId) || {};
          return {
            deviceId,
            name: user.name || `Device ${deviceId}`,
            currentHR: state.lastHR || null,
            currentZone: this._hrToZone(state.lastHR),
            isActive: state.lastHR != null && Date.now() - (state.lastSent || 0) < 5000,
            autoMode: state.autoMode || null,
            beatCount: state.beatCount || 0
          };
        });
    }

    // Fallback: get devices from live session deviceManager
    const session = this.getSession();
    if (!session?.deviceManager) return [];

    const allDevices = session.deviceManager.getAllDevices?.() || [];
    const hrDevices = allDevices.filter(d => d.type === 'heart_rate');

    return hrDevices.map(device => {
      const state = this.deviceState.get(String(device.id)) || {};
      return {
        deviceId: String(device.id),
        name: device.name || `Device ${device.id}`,
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
    this._updateChallengeProgress(deviceId);
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
   * Force-remove all devices from the device manager (for test cleanup)
   * This bypasses normal timeout behavior
   */
  clearAllDevices() {
    const session = this.getSession?.();
    if (!session?.deviceManager) {
      return { ok: false, error: 'No device manager available' };
    }
    const devices = session.deviceManager.getAllDevices();
    const removed = [];
    devices.forEach(d => {
      if (d.type === 'heart_rate') {
        session.deviceManager.removeDevice(d.deviceId);
        removed.push(d.deviceId);
      }
    });
    this._notifyStateChange();
    return { ok: true, removed, count: removed.length };
  }

  /**
   * Get current governance state
   */
  getGovernanceState() {
    if (!this.governanceOverride) {
      return { phase: undefined, activeChallenge: null, stats: this.stats };
    }

    const elapsed = (Date.now() - this.governanceOverride.startTime) / 1000;
    const { phases } = this.governanceOverride;

    let phase;
    if (elapsed < phases.warmup) {
      phase = 'warmup';
    } else if (phases.main === null || elapsed < phases.warmup + phases.main) {
      phase = 'main';
    } else {
      phase = 'cooldown';
    }

    // Check real GovernanceEngine state when challenge was delegated
    let activeChallenge = null;
    if (this.challengeState) {
      activeChallenge = {
        type: this.challengeState.type,
        targetZone: this.challengeState.targetZone,
        remainingSeconds: Math.max(0, Math.round(
          this.challengeState.duration - (Date.now() - this.challengeState.startTime) / 1000
        )),
        participantProgress: { ...this.challengeState.progress }
      };
    } else if (typeof window !== 'undefined' && window.__fitnessGovernance?.activeChallenge) {
      // Real governance engine handled the challenge — read from its state
      const realState = window.__fitnessGovernance;
      activeChallenge = {
        type: 'zone_target',
        targetZone: realState.activeChallenge,
        delegated: true
      };
    }

    return {
      phase,
      activeChallenge,
      stats: { ...this.stats }
    };
  }

  /**
   * Enable governance override on any content
   */
  enableGovernance(opts = {}) {
    if (this.governanceOverride) {
      return { ok: false, error: 'Governance already enabled. Call disableGovernance first.' };
    }

    const {
      phases = { warmup: 120, main: null, cooldown: 120 },
      challenges = { enabled: true, interval: 120, duration: 30 },
      targetZones = ['hot', 'fire']
    } = opts;

    this.governanceOverride = {
      startTime: Date.now(),
      phases,
      challenges,
      targetZones
    };

    this._notifyStateChange();
    return { ok: true };
  }

  /**
   * Disable governance override (revert to content default)
   */
  disableGovernance() {
    // Clear any active challenge
    if (this.challengeState?.timer) {
      clearTimeout(this.challengeState.timer);
    }
    this.challengeState = null;
    this.governanceOverride = null;

    this._notifyStateChange();
    return { ok: true };
  }

  /**
   * Reset stats counters (for test isolation)
   */
  resetStats() {
    this.stats = { challengesWon: 0, challengesFailed: 0 };
    this._notifyStateChange();
    return { ok: true };
  }

  /**
   * Check if governance is overridden
   */
  isGovernanceOverridden() {
    return this.governanceOverride !== null;
  }

  /**
   * Trigger a challenge event.
   *
   * If a real GovernanceEngine is available (window.__fitnessGovernance),
   * this delegates to it. Otherwise falls back to simulator-only behavior.
   */
  triggerChallenge(opts = {}) {
    // Check for real GovernanceEngine first - delegate to it if available
    const realGovernance = typeof window !== 'undefined' && window.__fitnessGovernance;
    if (realGovernance) {
      // The real GovernanceEngine is managing governance - delegate to it
      // GovernanceEngine.triggerChallenge expects a payload object
      const payload = {
        selection: {
          zone: opts.targetZone || opts.zone || 'active',
          rule: opts.rule || 'all',
          timeAllowedSeconds: opts.duration || opts.timeoutMs ? Math.ceil((opts.timeoutMs || 30000) / 1000) : 30,
          weight: 1,
          label: opts.label || 'Test Challenge'
        }
      };

      // Access the real engine via session if available
      const session = this.getSession?.();
      if (session?.governanceEngine?.triggerChallenge) {
        session.governanceEngine.triggerChallenge(payload);
        return { ok: true, delegated: true, ...opts };
      }

      // GovernanceEngine exposes state on window, but not the triggerChallenge method directly
      // We need to find the actual engine instance
      console.warn('[SimController] Real governance detected but triggerChallenge not accessible via session');
    }

    // Fallback to simulator-only behavior
    if (!this.governanceOverride) {
      return { ok: false, error: 'Governance not enabled. Call enableGovernance first.' };
    }

    if (this.challengeState) {
      return { ok: false, error: 'Challenge already active. Complete or wait for timeout.' };
    }

    const {
      type = 'zone_target',
      targetZone = 'hot',
      duration = 30
    } = opts;

    // Initialize progress tracking for all active devices
    const devices = this.getActiveDevices();
    const progress = {};

    // Check initial positions - devices already at target count as reached
    const targetZones = this._getZonesAtOrAbove(targetZone);
    devices.forEach(d => {
      progress[d.deviceId] = targetZones.includes(d.currentZone);
    });

    this.challengeState = {
      type,
      targetZone,
      duration,
      startTime: Date.now(),
      progress,
      // Track that once reached, always reached
      reached: new Set(Object.entries(progress).filter(([_, v]) => v).map(([k]) => k))
    };

    // Set timeout for auto-fail
    this.challengeState.timer = setTimeout(() => {
      this._completeChallenge(false);
    }, duration * 1000);

    this._notifyStateChange();
    return { ok: true, type, targetZone, duration };
  }

  /**
   * Get zones at or above the target (for overshoot handling)
   */
  _getZonesAtOrAbove(targetZone) {
    const zones = this.zoneConfig?.zones || [];
    const targetIndex = zones.findIndex(z => z.id === targetZone);
    if (targetIndex < 0) return [targetZone];
    return zones.slice(targetIndex).map(z => z.id);
  }

  /**
   * Update challenge progress when HR changes
   * Called internally after each _sendHR
   */
  _updateChallengeProgress(deviceId) {
    if (!this.challengeState) return;

    const device = this.getDevices().find(d => d.deviceId === String(deviceId));
    if (!device) return;

    const targetZones = this._getZonesAtOrAbove(this.challengeState.targetZone);

    // Once reached, always reached (sticky)
    if (targetZones.includes(device.currentZone)) {
      this.challengeState.reached.add(String(deviceId));
    }

    this.challengeState.progress[deviceId] = this.challengeState.reached.has(String(deviceId));
  }

  /**
   * Manually complete challenge (for testing)
   */
  completeChallenge(success) {
    if (!this.challengeState) {
      return { ok: false, error: 'No active challenge' };
    }
    return this._completeChallenge(success);
  }

  /**
   * Internal challenge completion
   */
  _completeChallenge(success) {
    if (!this.challengeState) return { ok: false };

    // Clear timer
    if (this.challengeState.timer) {
      clearTimeout(this.challengeState.timer);
    }

    // Update stats
    if (success) {
      this.stats.challengesWon++;
    } else {
      this.stats.challengesFailed++;
    }

    this.challengeState = null;
    this._notifyStateChange();

    return { ok: true, success, stats: { ...this.stats } };
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
