# HR Simulation Panel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a localhost-only HR simulation control panel for testing fitness sessions, replacing the deprecated CLI simulation script.

**Architecture:** Browser-native FitnessSimulationController exposes to `window.__fitnessSimController` on localhost. Popup UI and Playwright tests both consume this API. Simulated HR data flows through normal WebSocket → FitnessContext pipeline.

**Tech Stack:** Plain JS controller class, vanilla HTML/CSS/JS popup, Playwright test helper wrapper.

---

## Task 1: FitnessSimulationController - Core Class Skeleton

**Files:**
- Create: `frontend/src/modules/Fitness/FitnessSimulationController.js`

### Step 1: Write the failing test

Create minimal test to verify controller can be instantiated:

```javascript
// Test in browser console after Step 3 integration
// For now, we'll validate via the integration test in Task 4
```

### Step 2: Create controller skeleton with constructor and state

```javascript
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
      const state = this.deviceState.get(device.deviceId) || {};
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
```

### Step 3: Commit

```bash
git add frontend/src/modules/Fitness/FitnessSimulationController.js
git commit -m "$(cat <<'EOF'
feat(fitness): add FitnessSimulationController skeleton

Core class structure with:
- Constructor accepting wsService, getSession, zoneConfig
- Zone midpoint calculation from config
- Device state tracking map
- getDevices/getActiveDevices query methods
- destroy cleanup method

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: FitnessSimulationController - Manual Control Methods

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessSimulationController.js`

### Step 1: Add ANT+ message builder

```javascript
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
```

### Step 2: Add manual control methods

```javascript
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
```

### Step 3: Commit

```bash
git add frontend/src/modules/Fitness/FitnessSimulationController.js
git commit -m "$(cat <<'EOF'
feat(fitness): add manual control methods to SimulationController

- setZone(deviceId, zone): Set to zone midpoint HR
- setHR(deviceId, bpm): Set exact HR value
- stopDevice(deviceId): Trigger dropout
- _buildHRMessage: ANT+ message format matching DeviceManager
- _sendHR: Send via wsService with state tracking

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: FitnessSimulationController - Automation Methods

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessSimulationController.js`

### Step 1: Add waveform automation (looping 3-min cycle)

```javascript
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
```

### Step 2: Add session automation (realistic progression, ends)

```javascript
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
```

### Step 3: Add bulk operations

```javascript
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
```

### Step 4: Commit

```bash
git add frontend/src/modules/Fitness/FitnessSimulationController.js
git commit -m "$(cat <<'EOF'
feat(fitness): add automation methods to SimulationController

- startAuto(deviceId): Looping 3-min waveform cycle
- startAutoSession(deviceId, opts): Realistic session with phases
  - Supports duration, intensity, phaseOffset options
  - Progresses through warmup/build/peak/cooldown
- stopAuto(deviceId): Stop device automation
- activateAll(zone): Activate all devices at zone
- startAutoSessionAll(opts): All devices with staggered offsets
- stopAll(): Stop all devices

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: FitnessSimulationController - Governance Methods

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessSimulationController.js`

### Step 1: Add governance state methods

```javascript
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

    return {
      phase,
      activeChallenge: this.challengeState ? {
        type: this.challengeState.type,
        targetZone: this.challengeState.targetZone,
        remainingSeconds: Math.max(0, Math.round(
          this.challengeState.duration - (Date.now() - this.challengeState.startTime) / 1000
        )),
        participantProgress: { ...this.challengeState.progress }
      } : null,
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
   * Check if governance is overridden
   */
  isGovernanceOverridden() {
    return this.governanceOverride !== null;
  }
```

### Step 2: Add challenge methods

```javascript
  /**
   * Trigger a challenge event
   */
  triggerChallenge(opts = {}) {
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
```

### Step 3: Update _sendHR to track challenge progress

Add this line to the end of `_sendHR` method (before the return):

```javascript
  _sendHR(deviceId, hr) {
    const message = this._buildHRMessage(deviceId, hr);
    this.wsService?.send?.(message);
    this._updateChallengeProgress(deviceId); // Add this line
    this._notifyStateChange();
    return { ok: true, hr, deviceId };
  }
```

### Step 4: Commit

```bash
git add frontend/src/modules/Fitness/FitnessSimulationController.js
git commit -m "$(cat <<'EOF'
feat(fitness): add governance methods to SimulationController

- enableGovernance(opts): Force-enable on any content
- disableGovernance(): Revert to content default
- getGovernanceState(): Current phase, challenge, stats
- triggerChallenge(opts): Start challenge with target zone
- completeChallenge(success): Manually end challenge
- Sticky progress tracking (once reached = reached)
- Zone overshoot handling (fire counts for hot target)
- Auto-fail timer for challenge timeout

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: FitnessContext Integration

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx`

### Step 1: Add controller exposure effect after line ~1092

Find the `reconnectFitnessWebSocket` callback (around line 1086-1092) and add the following effect after it:

```javascript
  // ═══════════════════════════════════════════════════════════════
  // HR Simulation Controller (localhost only)
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    if (!isLocalhost) return;

    let controller = null;

    import('../modules/Fitness/FitnessSimulationController.js')
      .then(({ FitnessSimulationController }) => {
        import('../services/WebSocketService.js').then(({ wsService }) => {
          controller = new FitnessSimulationController({
            wsService,
            getSession: () => fitnessSessionRef.current,
            zoneConfig: normalizedBaseZoneConfig
          });

          window.__fitnessSimController = controller;

          // Broadcast state changes for popup
          controller.onStateChange = () => {
            window.dispatchEvent(new CustomEvent('sim-state-change', {
              detail: controller.getDevices()
            }));
          };

          console.log('[FitnessContext] Simulation controller available on window.__fitnessSimController');
        });
      })
      .catch(err => {
        console.warn('[FitnessContext] Failed to load simulation controller:', err);
      });

    return () => {
      if (controller) {
        controller.destroy();
        delete window.__fitnessSimController;
      }
    };
  }, [normalizedBaseZoneConfig]);
```

### Step 2: Verify the effect location

Run: `grep -n "reconnectFitnessWebSocket" frontend/src/context/FitnessContext.jsx`

The effect should be added after the `reconnectFitnessWebSocket` callback definition, before the `allDevicesRaw` memo.

### Step 3: Commit

```bash
git add frontend/src/context/FitnessContext.jsx
git commit -m "$(cat <<'EOF'
feat(fitness): expose SimulationController on localhost

- Dynamic import keeps controller out of production bundle
- Exposes on window.__fitnessSimController
- Broadcasts 'sim-state-change' events for popup sync
- Cleanup on unmount

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Playwright Test Helper

**Files:**
- Create: `tests/_lib/FitnessSimHelper.mjs`
- Modify: `tests/_lib/index.mjs`

### Step 1: Create FitnessSimHelper wrapper

```javascript
// tests/_lib/FitnessSimHelper.mjs

/**
 * FitnessSimHelper
 *
 * Playwright wrapper for FitnessSimulationController.
 * Provides clean async API for test automation.
 */
export class FitnessSimHelper {
  constructor(page) {
    this.page = page;
  }

  /**
   * Wait for controller to be available on window
   */
  async waitForController(timeout = 10000) {
    await this.page.waitForFunction(
      () => window.__fitnessSimController,
      { timeout }
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // Manual Control
  // ═══════════════════════════════════════════════════════════════

  async setZone(deviceId, zone) {
    return this.page.evaluate(
      ([id, z]) => window.__fitnessSimController.setZone(id, z),
      [deviceId, zone]
    );
  }

  async setHR(deviceId, bpm) {
    return this.page.evaluate(
      ([id, hr]) => window.__fitnessSimController.setHR(id, hr),
      [deviceId, bpm]
    );
  }

  async stopDevice(deviceId) {
    return this.page.evaluate(
      (id) => window.__fitnessSimController.stopDevice(id),
      deviceId
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // Automation
  // ═══════════════════════════════════════════════════════════════

  async startAuto(deviceId) {
    return this.page.evaluate(
      (id) => window.__fitnessSimController.startAuto(id),
      deviceId
    );
  }

  async startAutoSession(deviceId, opts = {}) {
    return this.page.evaluate(
      ([id, o]) => window.__fitnessSimController.startAutoSession(id, o),
      [deviceId, opts]
    );
  }

  async stopAuto(deviceId) {
    return this.page.evaluate(
      (id) => window.__fitnessSimController.stopAuto(id),
      deviceId
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // Bulk Operations
  // ═══════════════════════════════════════════════════════════════

  async activateAll(zone = 'active') {
    return this.page.evaluate(
      (z) => window.__fitnessSimController.activateAll(z),
      zone
    );
  }

  async startAutoSessionAll(opts = {}) {
    return this.page.evaluate(
      (o) => window.__fitnessSimController.startAutoSessionAll(o),
      opts
    );
  }

  async stopAll() {
    return this.page.evaluate(() => window.__fitnessSimController.stopAll());
  }

  // ═══════════════════════════════════════════════════════════════
  // Governance
  // ═══════════════════════════════════════════════════════════════

  async enableGovernance(opts = {}) {
    return this.page.evaluate(
      (o) => window.__fitnessSimController.enableGovernance(o),
      opts
    );
  }

  async disableGovernance() {
    return this.page.evaluate(() => window.__fitnessSimController.disableGovernance());
  }

  async triggerChallenge(opts = {}) {
    return this.page.evaluate(
      (o) => window.__fitnessSimController.triggerChallenge(o),
      opts
    );
  }

  async completeChallenge(success) {
    return this.page.evaluate(
      (s) => window.__fitnessSimController.completeChallenge(s),
      success
    );
  }

  async getGovernanceState() {
    return this.page.evaluate(() => window.__fitnessSimController.getGovernanceState());
  }

  // ═══════════════════════════════════════════════════════════════
  // Queries
  // ═══════════════════════════════════════════════════════════════

  async getDevices() {
    return this.page.evaluate(() => window.__fitnessSimController.getDevices());
  }

  async getActiveDevices() {
    return this.page.evaluate(() => window.__fitnessSimController.getActiveDevices());
  }

  // ═══════════════════════════════════════════════════════════════
  // Convenience Assertions
  // ═══════════════════════════════════════════════════════════════

  async waitForZone(deviceId, zone, timeout = 5000) {
    await this.page.waitForFunction(
      ([id, z]) => {
        const ctrl = window.__fitnessSimController;
        if (!ctrl) return false;
        const device = ctrl.getDevices().find(d => d.deviceId === id);
        return device?.currentZone === z;
      },
      [deviceId, zone],
      { timeout }
    );
  }

  async waitForActiveCount(count, timeout = 5000) {
    await this.page.waitForFunction(
      (c) => {
        const ctrl = window.__fitnessSimController;
        return ctrl && ctrl.getActiveDevices().length === c;
      },
      count,
      { timeout }
    );
  }
}
```

### Step 2: Export from index.mjs

Add to `tests/_lib/index.mjs`:

```javascript
export { FitnessSimHelper } from './FitnessSimHelper.mjs';
```

### Step 3: Commit

```bash
git add tests/_lib/FitnessSimHelper.mjs tests/_lib/index.mjs
git commit -m "$(cat <<'EOF'
feat(tests): add FitnessSimHelper for Playwright

Thin wrapper around FitnessSimulationController for clean test syntax:
- waitForController() with timeout
- Manual control: setZone, setHR, stopDevice
- Automation: startAuto, startAutoSession, stopAuto
- Bulk: activateAll, startAutoSessionAll, stopAll
- Governance: enable, disable, triggerChallenge, complete
- Queries: getDevices, getActiveDevices
- Assertions: waitForZone, waitForActiveCount

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Happy Path Simulation Tests (8-11)

**Files:**
- Modify: `tests/live/flow/fitness/fitness-happy-path.runtime.test.mjs`

### Step 1: Add import for FitnessSimHelper

Add after the existing imports (around line 20):

```javascript
import { FitnessSimHelper } from '#testlib/FitnessSimHelper.mjs';
```

### Step 2: Add Test 8 - Controller initializes

Add after existing tests (find the last test block):

```javascript
// ═══════════════════════════════════════════════════════════════
// TEST 8: Simulation controller initializes
// ═══════════════════════════════════════════════════════════════
test('simulation controller available on localhost', async () => {
  // Navigate to fitness app if not already there
  if (!sharedPage.url().includes('/fitness')) {
    await sharedPage.goto(`${BASE_URL}/fitness`);
    await sharedPage.waitForTimeout(2000);
  }

  const sim = new FitnessSimHelper(sharedPage);
  await sim.waitForController();

  const devices = await sim.getDevices();
  console.log(`Controller ready with ${devices.length} configured devices`);
  expect(devices.length).toBeGreaterThan(0);
});
```

### Step 3: Add Test 9 - Zone changes

```javascript
// ═══════════════════════════════════════════════════════════════
// TEST 9: Zone changes update participant state
// ═══════════════════════════════════════════════════════════════
test('setting zone updates participant state', async () => {
  const sim = new FitnessSimHelper(sharedPage);
  await sim.waitForController();

  const devices = await sim.getDevices();
  const device = devices[0];

  // Set to hot zone
  const result = await sim.setZone(device.deviceId, 'hot');
  expect(result.ok).toBe(true);

  // Wait for zone to register
  await sim.waitForZone(device.deviceId, 'hot');

  // Verify device state
  const updated = await sim.getDevices();
  const updatedDevice = updated.find(d => d.deviceId === device.deviceId);
  expect(updatedDevice.currentZone).toBe('hot');
  expect(updatedDevice.currentHR).toBeGreaterThan(140);

  console.log(`Device ${device.deviceId} now at ${updatedDevice.currentHR} bpm (${updatedDevice.currentZone})`);
});
```

### Step 4: Add Test 10 - Auto session progresses

```javascript
// ═══════════════════════════════════════════════════════════════
// TEST 10: Auto session progresses through zones
// ═══════════════════════════════════════════════════════════════
test('auto session progresses through zones', async () => {
  const sim = new FitnessSimHelper(sharedPage);
  await sim.waitForController();

  const devices = await sim.getDevices();
  const device = devices[0];

  // Start short auto session (30 seconds)
  await sim.startAutoSession(device.deviceId, { duration: 30 });

  // Should start in warmup (cool → active range)
  await sharedPage.waitForTimeout(3000);
  let state = await sim.getDevices();
  let d = state.find(x => x.deviceId === device.deviceId);
  console.log(`After 3s: ${d.currentHR} bpm (${d.currentZone})`);
  expect(d.autoMode).toBe('session');

  // Wait and check progression
  await sharedPage.waitForTimeout(5000);
  state = await sim.getDevices();
  d = state.find(x => x.deviceId === device.deviceId);
  console.log(`After 8s: ${d.currentHR} bpm (${d.currentZone})`);

  await sim.stopAuto(device.deviceId);
});
```

### Step 5: Add Test 11 - Governance and challenges

```javascript
// ═══════════════════════════════════════════════════════════════
// TEST 11: Governance override enables challenges
// ═══════════════════════════════════════════════════════════════
test('governance override enables challenges on any content', async () => {
  const sim = new FitnessSimHelper(sharedPage);
  await sim.waitForController();

  // Enable governance with short phases for testing
  await sim.enableGovernance({
    phases: { warmup: 3, main: 60, cooldown: 3 },
    challenges: { enabled: true, interval: 10, duration: 15 }
  });

  // Activate all participants
  await sim.activateAll('active');
  const devices = await sim.getDevices();
  await sim.waitForActiveCount(devices.length, 5000);
  console.log('All devices activated');

  // Wait for warmup, then trigger challenge
  await sharedPage.waitForTimeout(4000);

  const challengeResult = await sim.triggerChallenge({ targetZone: 'hot' });
  expect(challengeResult.ok).toBe(true);
  console.log('Challenge triggered');

  // Verify governance state shows active challenge
  const state = await sim.getGovernanceState();
  expect(state.activeChallenge).not.toBeNull();
  expect(state.activeChallenge.targetZone).toBe('hot');

  // Move all devices to target zone
  for (const d of devices) {
    await sim.setZone(d.deviceId, 'hot');
  }

  // Complete challenge successfully
  await sim.completeChallenge(true);

  // Verify win recorded
  const finalState = await sim.getGovernanceState();
  expect(finalState.stats.challengesWon).toBeGreaterThan(0);
  console.log(`Challenge completed. Wins: ${finalState.stats.challengesWon}`);

  // Cleanup
  await sim.disableGovernance();
  await sim.stopAll();
});
```

### Step 6: Commit

```bash
git add tests/live/flow/fitness/fitness-happy-path.runtime.test.mjs
git commit -m "$(cat <<'EOF'
test(fitness): add simulation happy path tests 8-11

- Test 8: Controller initializes on localhost
- Test 9: setZone updates participant state
- Test 10: Auto session progresses through zones
- Test 11: Governance override enables challenges

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Governance Simulation Test Suite (Exit Criteria)

**Files:**
- Create: `tests/live/flow/fitness/fitness-governance-simulation.runtime.test.mjs`

### Step 1: Create test file with setup

```javascript
/**
 * Fitness Governance Simulation Tests
 *
 * Exit criteria test suite - all 11 tests must pass.
 * Tests the FitnessSimulationController governance features.
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';
import { FitnessSimHelper } from '#testlib/FitnessSimHelper.mjs';

const BASE_URL = FRONTEND_URL;

let sharedPage;
let sharedContext;
let sim;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  sharedContext = await browser.newContext();
  sharedPage = await sharedContext.newPage();

  // Navigate to fitness app
  await sharedPage.goto(`${BASE_URL}/fitness`);
  await sharedPage.waitForTimeout(3000);

  sim = new FitnessSimHelper(sharedPage);
  await sim.waitForController();

  console.log('Governance simulation test suite initialized');
});

test.afterAll(async () => {
  // Cleanup
  if (sim) {
    await sim.disableGovernance().catch(() => {});
    await sim.stopAll().catch(() => {});
  }
  await sharedContext?.close();
});

test.afterEach(async () => {
  // Reset state between tests
  await sim.disableGovernance().catch(() => {});
  await sim.stopAll().catch(() => {});
  await sharedPage.waitForTimeout(500);
});
```

### Step 2: Add Tests 1-3

```javascript
// ═══════════════════════════════════════════════════════════════
// TEST 1: Challenge Win - All Participants Reach Target
// ═══════════════════════════════════════════════════════════════
test('challenge win - all participants reach target', async () => {
  await sim.enableGovernance();
  await sim.activateAll('active');

  const devices = await sim.getDevices();
  expect(devices.length).toBeGreaterThanOrEqual(2);
  const [device1, device2] = devices;

  // Before challenge
  const stateBefore = await sim.getGovernanceState();
  expect(stateBefore.activeChallenge).toBeNull();

  // Trigger challenge
  await sim.triggerChallenge({ targetZone: 'hot', duration: 30 });

  let activeChal = (await sim.getGovernanceState()).activeChallenge;
  expect(activeChal.targetZone).toBe('hot');
  expect(activeChal.participantProgress[device1.deviceId]).toBe(false);

  // Move devices to target
  await sim.setZone(device1.deviceId, 'hot');
  await sharedPage.waitForTimeout(100);

  activeChal = (await sim.getGovernanceState()).activeChallenge;
  expect(activeChal.participantProgress[device1.deviceId]).toBe(true);

  await sim.setZone(device2.deviceId, 'hot');
  await sharedPage.waitForTimeout(100);

  activeChal = (await sim.getGovernanceState()).activeChallenge;
  expect(activeChal.participantProgress[device2.deviceId]).toBe(true);

  // Complete challenge
  await sim.completeChallenge(true);

  const stateAfter = await sim.getGovernanceState();
  expect(stateAfter.activeChallenge).toBeNull();
  expect(stateAfter.stats.challengesWon).toBe(1);
  expect(stateAfter.stats.challengesFailed).toBe(0);
});

// ═══════════════════════════════════════════════════════════════
// TEST 2: Challenge Fail - Timeout Expires
// ═══════════════════════════════════════════════════════════════
test('challenge fail - timeout expires', async () => {
  await sim.enableGovernance();
  await sim.activateAll('active');

  const devices = await sim.getDevices();
  const [device1, device2] = devices;

  // Trigger short challenge with hard target
  await sim.triggerChallenge({ targetZone: 'fire', duration: 2 });

  // Move to warm only (not target)
  await sim.setZone(device1.deviceId, 'warm');
  // Leave device2 in active

  let activeChal = (await sim.getGovernanceState()).activeChallenge;
  expect(activeChal.participantProgress[device1.deviceId]).toBe(false);
  expect(activeChal.participantProgress[device2.deviceId]).toBe(false);

  // Wait for timeout
  await sharedPage.waitForTimeout(3000);

  const stateAfter = await sim.getGovernanceState();
  expect(stateAfter.activeChallenge).toBeNull();
  expect(stateAfter.stats.challengesWon).toBe(0);
  expect(stateAfter.stats.challengesFailed).toBe(1);
});

// ═══════════════════════════════════════════════════════════════
// TEST 3: Multi-Hurdle Sequential Challenges
// ═══════════════════════════════════════════════════════════════
test('multi-hurdle sequential challenges', async () => {
  await sim.enableGovernance({ challenges: { interval: 1 } });
  await sim.activateAll('cool');

  const devices = await sim.getDevices();

  // Hurdle 1: cool → active
  await sim.triggerChallenge({ targetZone: 'active' });
  for (const d of devices) await sim.setZone(d.deviceId, 'active');
  await sim.completeChallenge(true);
  expect((await sim.getGovernanceState()).stats.challengesWon).toBe(1);

  // Hurdle 2: active → warm
  await sim.triggerChallenge({ targetZone: 'warm' });
  for (const d of devices) await sim.setZone(d.deviceId, 'warm');
  await sim.completeChallenge(true);
  expect((await sim.getGovernanceState()).stats.challengesWon).toBe(2);

  // Hurdle 3: warm → hot
  await sim.triggerChallenge({ targetZone: 'hot' });
  for (const d of devices) await sim.setZone(d.deviceId, 'hot');
  await sim.completeChallenge(true);
  expect((await sim.getGovernanceState()).stats.challengesWon).toBe(3);

  // Hurdle 4: fail (don't move to fire)
  await sim.triggerChallenge({ targetZone: 'fire', duration: 1 });
  await sharedPage.waitForTimeout(1500);

  const finalState = await sim.getGovernanceState();
  expect(finalState.stats.challengesWon).toBe(3);
  expect(finalState.stats.challengesFailed).toBe(1);

  // Devices should be at hot (last successful zone)
  const finalDevices = await sim.getDevices();
  expect(finalDevices[0].currentZone).toBe('hot');
});
```

### Step 3: Add Tests 4-7

```javascript
// ═══════════════════════════════════════════════════════════════
// TEST 4: Partial Completion - Mixed Results
// ═══════════════════════════════════════════════════════════════
test('partial completion - mixed results', async () => {
  await sim.enableGovernance();
  await sim.activateAll('active');

  const devices = await sim.getDevices();
  expect(devices.length).toBeGreaterThanOrEqual(3);
  const [device1, device2, device3] = devices;

  await sim.triggerChallenge({ targetZone: 'hot', duration: 10 });

  // Move 2 of 3 to target
  await sim.setZone(device1.deviceId, 'hot');
  await sim.setZone(device2.deviceId, 'hot');
  // Leave device3 in active

  await sharedPage.waitForTimeout(100);

  const activeChal = (await sim.getGovernanceState()).activeChallenge;
  expect(activeChal.participantProgress[device1.deviceId]).toBe(true);
  expect(activeChal.participantProgress[device2.deviceId]).toBe(true);
  expect(activeChal.participantProgress[device3.deviceId]).toBe(false);

  const reachedTarget = Object.values(activeChal.participantProgress).filter(Boolean).length;
  expect(reachedTarget).toBe(2);

  const totalParticipants = Object.keys(activeChal.participantProgress).length;
  expect(totalParticipants).toBeGreaterThanOrEqual(3);

  await sim.completeChallenge(false); // Cleanup
});

// ═══════════════════════════════════════════════════════════════
// TEST 5: Participant Dropout Mid-Challenge
// ═══════════════════════════════════════════════════════════════
test('participant dropout mid-challenge', async () => {
  await sim.enableGovernance();
  await sim.activateAll('active');

  const devices = await sim.getDevices();
  const [device1, device2] = devices;

  await sim.triggerChallenge({ targetZone: 'hot', duration: 15 });

  // Device 1 reaches target
  await sim.setZone(device1.deviceId, 'hot');

  // Device 2 drops out
  await sim.stopDevice(device2.deviceId);

  await sharedPage.waitForTimeout(100);

  const activeChal = (await sim.getGovernanceState()).activeChallenge;
  expect(activeChal.participantProgress[device1.deviceId]).toBe(true);

  // Verify dropout
  const activeDevices = await sim.getActiveDevices();
  expect(activeDevices.length).toBe(1);
  expect(activeDevices[0].deviceId).toBe(device1.deviceId);

  // Challenge can still complete
  await sim.completeChallenge(true);
  expect((await sim.getGovernanceState()).activeChallenge).toBeNull();
});

// ═══════════════════════════════════════════════════════════════
// TEST 6: Zone Overshoot - Fire When Target Is Hot
// ═══════════════════════════════════════════════════════════════
test('zone overshoot - fire counts for hot target', async () => {
  await sim.enableGovernance();
  await sim.activateAll('active');

  const devices = await sim.getDevices();
  const device = devices[0];

  await sim.triggerChallenge({ targetZone: 'hot', duration: 10 });

  // Overshoot to fire
  await sim.setZone(device.deviceId, 'fire');
  await sharedPage.waitForTimeout(100);

  const activeChal = (await sim.getGovernanceState()).activeChallenge;
  expect(activeChal.participantProgress[device.deviceId]).toBe(true);

  // Verify actually in fire
  const updatedDevices = await sim.getDevices();
  expect(updatedDevices[0].currentZone).toBe('fire');
  expect(updatedDevices[0].currentHR).toBeGreaterThanOrEqual(160);

  await sim.completeChallenge(true);
});

// ═══════════════════════════════════════════════════════════════
// TEST 7: Zone Oscillation Around Boundary (Sticky Progress)
// ═══════════════════════════════════════════════════════════════
test('zone oscillation - once reached stays reached', async () => {
  await sim.enableGovernance();

  const devices = await sim.getDevices();
  const device = devices[0];

  // Start at boundary (warm zone, just below hot)
  await sim.setHR(device.deviceId, 138);
  await sharedPage.waitForTimeout(100);

  await sim.triggerChallenge({ targetZone: 'hot', duration: 15 });

  // At 139 - still warm
  await sim.setHR(device.deviceId, 139);
  await sharedPage.waitForTimeout(100);
  let state = await sim.getDevices();
  expect(state[0].currentZone).toBe('warm');
  let activeChal = (await sim.getGovernanceState()).activeChallenge;
  expect(activeChal.participantProgress[device.deviceId]).toBe(false);

  // At 141 - now hot
  await sim.setHR(device.deviceId, 141);
  await sharedPage.waitForTimeout(100);
  state = await sim.getDevices();
  expect(state[0].currentZone).toBe('hot');
  activeChal = (await sim.getGovernanceState()).activeChallenge;
  expect(activeChal.participantProgress[device.deviceId]).toBe(true);

  // Back to 138 - warm but still counts as reached (sticky)
  await sim.setHR(device.deviceId, 138);
  await sharedPage.waitForTimeout(100);
  state = await sim.getDevices();
  expect(state[0].currentZone).toBe('warm');
  activeChal = (await sim.getGovernanceState()).activeChallenge;
  expect(activeChal.participantProgress[device.deviceId]).toBe(true); // Still true!

  await sim.completeChallenge(true);
});
```

### Step 4: Add Tests 8-11

```javascript
// ═══════════════════════════════════════════════════════════════
// TEST 8: Challenge During Phase Transitions
// ═══════════════════════════════════════════════════════════════
test('challenge during phase transitions', async () => {
  await sim.enableGovernance({
    phases: { warmup: 2, main: 30, cooldown: 2 }
  });
  await sim.activateAll('active');

  // Initial phase should be warmup
  const initialState = await sim.getGovernanceState();
  expect(initialState.phase).toBe('warmup');

  // Wait for transition to main
  await sharedPage.waitForTimeout(2500);

  const stateAfterWait = await sim.getGovernanceState();
  expect(stateAfterWait.phase).toBe('main');

  // Trigger challenge during main
  await sim.triggerChallenge({ targetZone: 'hot' });
  const stateWithChallenge = await sim.getGovernanceState();
  expect(stateWithChallenge.activeChallenge).not.toBeNull();
  expect(stateWithChallenge.phase).toBe('main');

  await sim.completeChallenge(true);
});

// ═══════════════════════════════════════════════════════════════
// TEST 9: Governance Override On/Off
// ═══════════════════════════════════════════════════════════════
test('governance override on/off', async () => {
  await sim.activateAll('active');

  // Initially no governance
  const initialState = await sim.getGovernanceState();
  expect(initialState.phase).toBeUndefined();

  // Enable
  await sim.enableGovernance();
  const enabledState = await sim.getGovernanceState();
  expect(enabledState.phase).toBe('warmup');

  // Trigger and complete a challenge
  await sim.triggerChallenge({ targetZone: 'active' });
  await sim.completeChallenge(true);
  expect((await sim.getGovernanceState()).stats.challengesWon).toBe(1);

  // Disable
  await sim.disableGovernance();
  const disabledState = await sim.getGovernanceState();
  expect(disabledState.phase).toBeUndefined();

  // Trigger should fail when disabled
  const failedTrigger = await sim.triggerChallenge({ targetZone: 'hot' });
  expect(failedTrigger.ok).toBe(false);
  expect(failedTrigger.error).toContain('overnance');
});

// ═══════════════════════════════════════════════════════════════
// TEST 10: Rapid Challenge Succession
// ═══════════════════════════════════════════════════════════════
test('rapid challenge succession', async () => {
  await sim.enableGovernance();
  await sim.activateAll('active');

  // Challenge 1 - win
  await sim.triggerChallenge({ targetZone: 'active' });
  await sim.completeChallenge(true);
  const stateAfter1 = await sim.getGovernanceState();
  expect(stateAfter1.activeChallenge).toBeNull();

  // Challenge 2 - win
  await sim.triggerChallenge({ targetZone: 'active' });
  await sim.completeChallenge(true);
  const stateAfter2 = await sim.getGovernanceState();
  expect(stateAfter2.activeChallenge).toBeNull();

  // Challenge 3 - fail
  await sim.triggerChallenge({ targetZone: 'fire' });
  await sim.completeChallenge(false);
  const stateAfter3 = await sim.getGovernanceState();
  expect(stateAfter3.activeChallenge).toBeNull();

  // Verify stats
  expect(stateAfter3.stats.challengesWon).toBe(2);
  expect(stateAfter3.stats.challengesFailed).toBe(1);

  const total = stateAfter3.stats.challengesWon + stateAfter3.stats.challengesFailed;
  expect(total).toBe(3);
});

// ═══════════════════════════════════════════════════════════════
// TEST 11: Already In Target Zone When Challenge Starts
// ═══════════════════════════════════════════════════════════════
test('already in target zone when challenge starts', async () => {
  await sim.enableGovernance();

  const devices = await sim.getDevices();
  const [device1, device2] = devices;

  // Pre-position in hot
  await sim.setZone(device1.deviceId, 'hot');
  await sim.setZone(device2.deviceId, 'hot');
  await sharedPage.waitForTimeout(100);

  // Trigger challenge for zone they're already in
  await sim.triggerChallenge({ targetZone: 'hot' });

  // Should immediately show as reached
  const activeChal = (await sim.getGovernanceState()).activeChallenge;
  expect(activeChal.participantProgress[device1.deviceId]).toBe(true);
  expect(activeChal.participantProgress[device2.deviceId]).toBe(true);

  // Can complete immediately
  await sim.completeChallenge(true);
  expect((await sim.getGovernanceState()).stats.challengesWon).toBe(1);
});
```

### Step 5: Commit

```bash
git add tests/live/flow/fitness/fitness-governance-simulation.runtime.test.mjs
git commit -m "$(cat <<'EOF'
test(fitness): add governance simulation exit criteria suite

All 11 tests for FitnessSimulationController governance:
1. Challenge win - all reach target
2. Challenge fail - timeout expires
3. Multi-hurdle sequential challenges
4. Partial completion - mixed results
5. Participant dropout mid-challenge
6. Zone overshoot - fire counts for hot
7. Zone oscillation - sticky progress
8. Challenge during phase transitions
9. Governance override on/off
10. Rapid challenge succession
11. Pre-positioned at target zone

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: HRSimTrigger Button Component

**Files:**
- Create: `frontend/src/modules/Fitness/HRSimTrigger.jsx`
- Modify: `frontend/src/modules/Fitness/FitnessPlayer.jsx`

### Step 1: Create trigger component

```jsx
// frontend/src/modules/Fitness/HRSimTrigger.jsx

import React from 'react';

/**
 * HRSimTrigger
 *
 * Small gear button to open HR Simulation Panel.
 * Only renders on localhost.
 */
export function HRSimTrigger() {
  const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  if (!isLocalhost) return null;

  const openPanel = () => {
    window.open('/sim-panel.html', 'sim-panel', 'width=400,height=500');
  };

  return (
    <button
      type="button"
      className="hr-sim-trigger"
      onClick={openPanel}
      title="Open HR Simulation Panel"
      style={{
        position: 'fixed',
        bottom: '10px',
        left: '10px',
        width: '32px',
        height: '32px',
        borderRadius: '50%',
        border: 'none',
        background: 'rgba(100, 100, 100, 0.7)',
        color: '#ccc',
        cursor: 'pointer',
        fontSize: '16px',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      &#9881;
    </button>
  );
}

export default HRSimTrigger;
```

### Step 2: Add to FitnessPlayer

In `frontend/src/modules/Fitness/FitnessPlayer.jsx`:

Add import near top (around line 19):
```javascript
import HRSimTrigger from './HRSimTrigger.jsx';
```

Add component render inside the main return, after the FitnessPlayerFrame closing tag (around line 1530):
```jsx
      <HRSimTrigger />
```

### Step 3: Commit

```bash
git add frontend/src/modules/Fitness/HRSimTrigger.jsx frontend/src/modules/Fitness/FitnessPlayer.jsx
git commit -m "$(cat <<'EOF'
feat(fitness): add HRSimTrigger button component

Gear button in bottom-left corner of FitnessPlayer:
- Only renders on localhost
- Opens sim-panel.html popup on click
- Unobtrusive styling

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Simulation Panel Popup UI

**Files:**
- Create: `frontend/public/sim-panel.html`

### Step 1: Create popup HTML

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=400">
  <title>HR Simulation Panel</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a1a;
      color: #e0e0e0;
      padding: 12px;
      font-size: 13px;
    }
    h1 {
      font-size: 16px;
      font-weight: 500;
      margin-bottom: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .error {
      background: #8b0000;
      padding: 20px;
      border-radius: 8px;
      text-align: center;
    }
    .section {
      background: #252525;
      border-radius: 6px;
      padding: 10px;
      margin-bottom: 10px;
    }
    .section-title {
      font-size: 11px;
      text-transform: uppercase;
      color: #888;
      margin-bottom: 8px;
    }
    .gov-status {
      display: flex;
      gap: 12px;
      margin-bottom: 8px;
    }
    .gov-status span {
      font-size: 12px;
    }
    .btn-row {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    button {
      background: #3a3a3a;
      border: none;
      color: #e0e0e0;
      padding: 6px 10px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }
    button:hover { background: #4a4a4a; }
    button:active { background: #555; }
    button.danger { background: #6b2020; }
    button.danger:hover { background: #8b3030; }
    .device-list {
      max-height: 320px;
      overflow-y: auto;
    }
    .device {
      background: #2a2a2a;
      border-radius: 6px;
      padding: 10px;
      margin-bottom: 8px;
    }
    .device-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .device-name {
      font-weight: 500;
    }
    .device-hr {
      font-family: monospace;
      font-size: 14px;
    }
    .device-hr.inactive { color: #666; }
    .zone-buttons {
      display: flex;
      gap: 4px;
      margin-bottom: 8px;
    }
    .zone-btn {
      flex: 1;
      padding: 4px 2px;
      font-size: 10px;
      border-radius: 3px;
      text-align: center;
    }
    .zone-btn.cool { background: #2563eb; }
    .zone-btn.active { background: #059669; }
    .zone-btn.warm { background: #d97706; }
    .zone-btn.hot { background: #dc2626; }
    .zone-btn.fire { background: #7c2d12; }
    .zone-btn.selected { outline: 2px solid white; }
    .auto-buttons {
      display: flex;
      gap: 4px;
    }
    .auto-buttons button {
      flex: 1;
      font-size: 11px;
      padding: 4px;
    }
    .auto-indicator {
      background: #059669;
      color: white;
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 3px;
      margin-left: 6px;
    }
  </style>
</head>
<body>
  <div id="app">
    <h1>
      HR Simulation Panel
      <button onclick="window.close()">X</button>
    </h1>
    <div id="content">Loading...</div>
  </div>

  <script>
    let controller = null;

    function init() {
      if (!window.opener) {
        showError('Open this panel from FitnessPlayer');
        return;
      }

      controller = window.opener.__fitnessSimController;
      if (!controller) {
        showError('Simulation not available - reload FitnessPlayer');
        return;
      }

      // Listen for state changes
      window.opener.addEventListener('sim-state-change', render);

      render();
    }

    function showError(msg) {
      document.getElementById('content').innerHTML = `<div class="error">${msg}</div>`;
    }

    function render() {
      if (!controller) return;

      const devices = controller.getDevices();
      const govState = controller.getGovernanceState();

      let html = '';

      // Governance section
      html += `<div class="section">
        <div class="section-title">Governance</div>
        <div class="gov-status">
          <span>Phase: ${govState.phase || 'none'}</span>
          <span>Challenge: ${govState.activeChallenge ? govState.activeChallenge.targetZone : 'none'}</span>
        </div>
        <div class="btn-row">
          <button onclick="toggleGovernance()">${govState.phase ? 'Disable Gov' : 'Enable Gov'}</button>
          <button onclick="triggerChallenge()" ${!govState.phase ? 'disabled' : ''}>Trigger Challenge</button>
        </div>
      </div>`;

      // Bulk actions
      html += `<div class="section">
        <div class="section-title">Bulk Actions</div>
        <div class="btn-row">
          <button onclick="activateAll('active')">Activate All</button>
          <button onclick="autoSessionAll()">Auto Session All</button>
          <button onclick="stopAll()" class="danger">Stop All</button>
        </div>
      </div>`;

      // Device list
      html += `<div class="section">
        <div class="section-title">Devices (${devices.length})</div>
        <div class="device-list">`;

      for (const d of devices) {
        const hrDisplay = d.currentHR ? `${d.currentHR} bpm` : '-- bpm';
        const hrClass = d.isActive ? '' : 'inactive';
        const autoLabel = d.autoMode ? `<span class="auto-indicator">${d.autoMode}</span>` : '';

        html += `<div class="device">
          <div class="device-header">
            <span class="device-name">${d.name} (${d.deviceId})${autoLabel}</span>
            <span class="device-hr ${hrClass}">${hrDisplay}</span>
          </div>
          <div class="zone-buttons">
            ${['cool', 'active', 'warm', 'hot', 'fire'].map(z =>
              `<button class="zone-btn ${z} ${d.currentZone === z ? 'selected' : ''}"
                       onclick="setZone('${d.deviceId}', '${z}')">${z}</button>`
            ).join('')}
          </div>
          <div class="auto-buttons">
            <button onclick="startAuto('${d.deviceId}')">auto</button>
            <button onclick="startSession('${d.deviceId}')">session</button>
            <button onclick="stopDevice('${d.deviceId}')" class="danger">stop</button>
          </div>
        </div>`;
      }

      html += '</div></div>';

      document.getElementById('content').innerHTML = html;
    }

    // Actions
    function setZone(deviceId, zone) {
      controller.setZone(deviceId, zone);
    }

    function startAuto(deviceId) {
      controller.startAuto(deviceId);
    }

    function startSession(deviceId) {
      controller.startAutoSession(deviceId);
    }

    function stopDevice(deviceId) {
      controller.stopDevice(deviceId);
    }

    function activateAll(zone) {
      controller.activateAll(zone);
    }

    function autoSessionAll() {
      controller.startAutoSessionAll();
    }

    function stopAll() {
      controller.stopAll();
    }

    function toggleGovernance() {
      const state = controller.getGovernanceState();
      if (state.phase) {
        controller.disableGovernance();
      } else {
        controller.enableGovernance();
      }
      render();
    }

    function triggerChallenge() {
      controller.triggerChallenge({ targetZone: 'hot' });
      render();
    }

    // Initialize
    init();
  </script>
</body>
</html>
```

### Step 2: Commit

```bash
git add frontend/public/sim-panel.html
git commit -m "$(cat <<'EOF'
feat(fitness): add sim-panel.html popup UI

Vanilla HTML/CSS/JS popup for HR simulation:
- Governance status and toggle
- Bulk actions (activate all, auto session, stop)
- Per-device zone buttons with colored indicators
- Per-device auto/session/stop controls
- Real-time updates via sim-state-change events
- 400x500px resizable popup

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Deprecate CLI Simulation Script

**Files:**
- Modify: `_extensions/fitness/simulation.mjs`

### Step 1: Add deprecation notice at top of file

Add after the opening comment block (around line 1):

```javascript
/**
 * @deprecated This CLI simulation script is deprecated.
 * Use the browser-based FitnessSimulationController instead:
 * - For manual testing: Click gear button in FitnessPlayer (localhost only)
 * - For Playwright tests: Use FitnessSimHelper from tests/_lib/
 *
 * This file will be removed in a future release.
 * See docs/_wip/plans/2026-02-03-hr-simulation-panel-v2.md
 */
console.warn('⚠️  DEPRECATED: fitness/simulation.mjs is deprecated. Use browser-based simulation panel instead.');
```

### Step 2: Commit

```bash
git add _extensions/fitness/simulation.mjs
git commit -m "$(cat <<'EOF'
deprecate(fitness): mark CLI simulation.mjs as deprecated

Browser-based FitnessSimulationController replaces CLI script:
- Manual testing via popup panel
- Playwright tests via FitnessSimHelper
- Same data path through WebSocket pipeline

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Run Tests and Verify

### Step 1: Run happy path tests (8-11)

```bash
npx playwright test tests/live/flow/fitness/fitness-happy-path.runtime.test.mjs --reporter=line
```

Expected: All tests pass including new tests 8-11.

### Step 2: Run governance simulation tests (1-11)

```bash
npx playwright test tests/live/flow/fitness/fitness-governance-simulation.runtime.test.mjs --reporter=line
```

Expected: All 11 tests pass.

### Step 3: Manual verification

1. Start dev server: `npm run dev`
2. Open http://localhost:3111/fitness
3. Verify gear button visible in bottom-left
4. Click gear, verify popup opens
5. Test zone buttons, auto modes, governance toggle
6. Close popup, verify no console errors

### Step 4: Final commit if any fixes needed

```bash
git add -A
git commit -m "$(cat <<'EOF'
fix(fitness): address test feedback from verification

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Summary

| Task | Files | Purpose |
|------|-------|---------|
| 1 | FitnessSimulationController.js | Core skeleton |
| 2 | FitnessSimulationController.js | Manual control |
| 3 | FitnessSimulationController.js | Automation |
| 4 | FitnessSimulationController.js | Governance |
| 5 | FitnessContext.jsx | Context integration |
| 6 | FitnessSimHelper.mjs | Playwright helper |
| 7 | fitness-happy-path.runtime.test.mjs | Tests 8-11 |
| 8 | fitness-governance-simulation.runtime.test.mjs | Exit criteria |
| 9 | HRSimTrigger.jsx, FitnessPlayer.jsx | Trigger button |
| 10 | sim-panel.html | Popup UI |
| 11 | simulation.mjs | Deprecation notice |
| 12 | - | Verification |

**Exit Criteria:** All 11 governance simulation tests pass. Happy path tests 8-11 pass. Manual testing checklist complete.
