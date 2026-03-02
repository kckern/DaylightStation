# Vibration Activity Tracker Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add real-time activity tracking for vibration-equipped fitness equipment (punching bag, step platform) with timeline recording, governance challenges, and live UI avatars.

**Architecture:** A new `VibrationActivityTracker` state machine (per equipment) ingests vibration WebSocket events, accumulates session/impact/intensity state, and exposes a snapshot consumed by `TimelineRecorder` (for persistence), `GovernanceEngine` (for challenges), and a new `VibrationActivityAvatar` component (for live UI). All config is YAML-driven with sensible hardcoded fallbacks.

**Tech Stack:** Vanilla JS (state machine), React (avatar component), Jest (tests), existing MQTT/WebSocket pipeline (no new backend changes).

**Design Doc:** `docs/_wip/plans/2026-03-02-vibration-activity-tracker-design.md`

---

## Task 1: VibrationActivityTracker — Core State Machine

**Files:**
- Create: `frontend/src/hooks/fitness/VibrationActivityTracker.js`
- Test: `tests/unit/fitness/VibrationActivityTracker.test.mjs`

### Step 1: Write the failing tests

Create `tests/unit/fitness/VibrationActivityTracker.test.mjs`:

```javascript
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  })
}));

const { VibrationActivityTracker } = await import('#frontend/hooks/fitness/VibrationActivityTracker.js');

describe('VibrationActivityTracker', () => {
  let tracker;

  beforeEach(() => {
    tracker = new VibrationActivityTracker('punching_bag', {
      idle_timeout_seconds: 2,
      session_reset_seconds: 5,
      impact_magnitude_threshold: 500,
      impact_multiplier: 2.0,
      intensity_levels: [500, 1000, 1500],
      history_window_seconds: 10
    });
  });

  describe('constructor', () => {
    it('starts in idle status', () => {
      expect(tracker.snapshot.status).toBe('idle');
    });

    it('has zero counters', () => {
      expect(tracker.snapshot.detectedImpacts).toBe(0);
      expect(tracker.snapshot.estimatedImpacts).toBe(0);
      expect(tracker.snapshot.sessionDurationMs).toBe(0);
      expect(tracker.snapshot.currentIntensity).toBe(0);
    });

    it('uses hardcoded defaults when no config provided', () => {
      const defaultTracker = new VibrationActivityTracker('test_device');
      expect(defaultTracker.snapshot.status).toBe('idle');
      // Should not throw
    });
  });

  describe('ingest()', () => {
    it('transitions to active on vibration event above threshold', () => {
      tracker.ingest({ vibration: true, x_axis: 600, y_axis: 0, z_axis: 0, timestamp: 1000 });
      expect(tracker.snapshot.status).toBe('active');
    });

    it('stays idle on vibration below magnitude threshold', () => {
      tracker.ingest({ vibration: true, x_axis: 100, y_axis: 0, z_axis: 0, timestamp: 1000 });
      expect(tracker.snapshot.status).toBe('idle');
    });

    it('stays idle when vibration flag is false', () => {
      tracker.ingest({ vibration: false, x_axis: 600, y_axis: 0, z_axis: 0, timestamp: 1000 });
      expect(tracker.snapshot.status).toBe('idle');
    });

    it('counts impacts above magnitude threshold', () => {
      tracker.ingest({ vibration: true, x_axis: 600, y_axis: 0, z_axis: 0, timestamp: 1000 });
      tracker.ingest({ vibration: true, x_axis: 800, y_axis: 0, z_axis: 0, timestamp: 3000 });
      expect(tracker.snapshot.detectedImpacts).toBe(2);
      expect(tracker.snapshot.estimatedImpacts).toBe(4); // 2 * multiplier 2.0
    });

    it('does not count impacts below magnitude threshold', () => {
      tracker.ingest({ vibration: true, x_axis: 600, y_axis: 0, z_axis: 0, timestamp: 1000 });
      tracker.ingest({ vibration: true, x_axis: 100, y_axis: 0, z_axis: 0, timestamp: 3000 });
      expect(tracker.snapshot.detectedImpacts).toBe(1);
    });

    it('tracks session duration while active', () => {
      tracker.ingest({ vibration: true, x_axis: 600, y_axis: 0, z_axis: 0, timestamp: 1000 });
      tracker.ingest({ vibration: true, x_axis: 600, y_axis: 0, z_axis: 0, timestamp: 4000 });
      expect(tracker.snapshot.sessionDurationMs).toBe(3000);
    });

    it('computes intensity as euclidean magnitude', () => {
      tracker.ingest({ vibration: true, x_axis: 300, y_axis: 400, z_axis: 0, timestamp: 1000 });
      expect(tracker.snapshot.currentIntensity).toBe(500); // sqrt(300^2 + 400^2)
    });

    it('tracks peak intensity per session', () => {
      tracker.ingest({ vibration: true, x_axis: 600, y_axis: 0, z_axis: 0, timestamp: 1000 });
      tracker.ingest({ vibration: true, x_axis: 1200, y_axis: 0, z_axis: 0, timestamp: 3000 });
      tracker.ingest({ vibration: true, x_axis: 800, y_axis: 0, z_axis: 0, timestamp: 5000 });
      expect(tracker.snapshot.peakIntensity).toBe(1200);
    });
  });

  describe('intensity levels', () => {
    it('returns "none" when idle', () => {
      expect(tracker.snapshot.intensityLevel).toBe('none');
    });

    it('returns "low" for magnitude between levels[0] and levels[1]', () => {
      tracker.ingest({ vibration: true, x_axis: 700, y_axis: 0, z_axis: 0, timestamp: 1000 });
      expect(tracker.snapshot.intensityLevel).toBe('low');
    });

    it('returns "medium" for magnitude between levels[1] and levels[2]', () => {
      tracker.ingest({ vibration: true, x_axis: 1200, y_axis: 0, z_axis: 0, timestamp: 1000 });
      expect(tracker.snapshot.intensityLevel).toBe('medium');
    });

    it('returns "high" for magnitude above levels[2]', () => {
      tracker.ingest({ vibration: true, x_axis: 1600, y_axis: 0, z_axis: 0, timestamp: 1000 });
      expect(tracker.snapshot.intensityLevel).toBe('high');
    });
  });

  describe('idle timeout', () => {
    it('transitions back to idle after idle_timeout_seconds with no events', () => {
      tracker.ingest({ vibration: true, x_axis: 600, y_axis: 0, z_axis: 0, timestamp: 1000 });
      expect(tracker.snapshot.status).toBe('active');
      // Simulate tick after idle timeout (2 seconds configured)
      tracker.tick(4000);
      expect(tracker.snapshot.status).toBe('idle');
    });

    it('stays active if events keep arriving within timeout', () => {
      tracker.ingest({ vibration: true, x_axis: 600, y_axis: 0, z_axis: 0, timestamp: 1000 });
      tracker.ingest({ vibration: true, x_axis: 600, y_axis: 0, z_axis: 0, timestamp: 2500 });
      tracker.tick(3000);
      expect(tracker.snapshot.status).toBe('active');
    });
  });

  describe('session reset', () => {
    it('resets counters after session_reset_seconds of idle', () => {
      tracker.ingest({ vibration: true, x_axis: 600, y_axis: 0, z_axis: 0, timestamp: 1000 });
      expect(tracker.snapshot.detectedImpacts).toBe(1);
      // Go idle
      tracker.tick(4000);
      expect(tracker.snapshot.status).toBe('idle');
      // Counters still held
      expect(tracker.snapshot.detectedImpacts).toBe(1);
      // After session_reset_seconds (5s) of idle
      tracker.tick(10000);
      expect(tracker.snapshot.detectedImpacts).toBe(0);
      expect(tracker.snapshot.sessionDurationMs).toBe(0);
    });
  });

  describe('recentIntensityHistory', () => {
    it('accumulates intensity readings in rolling window', () => {
      tracker.ingest({ vibration: true, x_axis: 600, y_axis: 0, z_axis: 0, timestamp: 1000 });
      tracker.ingest({ vibration: true, x_axis: 1200, y_axis: 0, z_axis: 0, timestamp: 3000 });
      expect(tracker.snapshot.recentIntensityHistory.length).toBe(2);
      expect(tracker.snapshot.recentIntensityHistory[0]).toBe(600);
      expect(tracker.snapshot.recentIntensityHistory[1]).toBe(1200);
    });

    it('trims entries older than history_window_seconds', () => {
      tracker.ingest({ vibration: true, x_axis: 600, y_axis: 0, z_axis: 0, timestamp: 1000 });
      tracker.ingest({ vibration: true, x_axis: 800, y_axis: 0, z_axis: 0, timestamp: 5000 });
      tracker.ingest({ vibration: true, x_axis: 1000, y_axis: 0, z_axis: 0, timestamp: 12000 });
      // history_window_seconds = 10, so the first entry (ts 1000) should be trimmed at ts 12000
      expect(tracker.snapshot.recentIntensityHistory).toEqual([800, 1000]);
    });
  });

  describe('reset()', () => {
    it('clears all state back to initial', () => {
      tracker.ingest({ vibration: true, x_axis: 600, y_axis: 0, z_axis: 0, timestamp: 1000 });
      tracker.reset();
      expect(tracker.snapshot.status).toBe('idle');
      expect(tracker.snapshot.detectedImpacts).toBe(0);
      expect(tracker.snapshot.sessionDurationMs).toBe(0);
      expect(tracker.snapshot.recentIntensityHistory).toEqual([]);
    });
  });

  describe('onStateChange callback', () => {
    it('fires callback on status transitions', () => {
      const cb = jest.fn();
      tracker.setOnStateChange(cb);
      tracker.ingest({ vibration: true, x_axis: 600, y_axis: 0, z_axis: 0, timestamp: 1000 });
      expect(cb).toHaveBeenCalled();
    });
  });
});
```

### Step 2: Run tests to verify they fail

Run: `npx jest tests/unit/fitness/VibrationActivityTracker.test.mjs --no-coverage`
Expected: FAIL — module not found

### Step 3: Implement VibrationActivityTracker

Create `frontend/src/hooks/fitness/VibrationActivityTracker.js`:

```javascript
import getLogger from '../../lib/logging/Logger.js';

const DEFAULTS = {
  idle_timeout_seconds: 5,
  session_reset_seconds: 30,
  impact_magnitude_threshold: 400,
  impact_multiplier: 1.5,
  intensity_levels: [400, 800, 1200],
  history_window_seconds: 30
};

const computeMagnitude = (x, y, z) => {
  const nx = Number(x) || 0;
  const ny = Number(y) || 0;
  const nz = Number(z) || 0;
  return Math.round(Math.sqrt(nx * nx + ny * ny + nz * nz));
};

const classifyIntensity = (magnitude, levels) => {
  if (!Array.isArray(levels) || levels.length === 0 || magnitude <= 0) return 'none';
  if (levels.length >= 3 && magnitude >= levels[2]) return 'high';
  if (levels.length >= 2 && magnitude >= levels[1]) return 'medium';
  if (magnitude >= levels[0]) return 'low';
  return 'none';
};

export class VibrationActivityTracker {
  constructor(equipmentId, config = {}) {
    this._equipmentId = equipmentId;
    this._config = { ...DEFAULTS, ...config };
    this._onStateChange = null;

    // Internal mutable state
    this._status = 'idle';
    this._sessionStartedAt = null;
    this._lastEventAt = null;
    this._idleStartedAt = null;
    this._detectedImpacts = 0;
    this._currentIntensity = 0;
    this._peakIntensity = 0;
    this._intensityHistory = []; // Array of { magnitude, timestamp }
  }

  get snapshot() {
    const now = this._lastEventAt || Date.now();
    const sessionDurationMs = this._status === 'active' && this._sessionStartedAt
      ? now - this._sessionStartedAt
      : 0;

    return {
      equipmentId: this._equipmentId,
      status: this._status,
      sessionDurationMs,
      sessionStartedAt: this._sessionStartedAt,
      detectedImpacts: this._detectedImpacts,
      estimatedImpacts: Math.round(this._detectedImpacts * this._config.impact_multiplier),
      currentIntensity: this._currentIntensity,
      intensityLevel: classifyIntensity(this._currentIntensity, this._config.intensity_levels),
      peakIntensity: this._peakIntensity,
      recentIntensityHistory: this._getRecentHistory(now)
    };
  }

  setOnStateChange(callback) {
    this._onStateChange = typeof callback === 'function' ? callback : null;
  }

  ingest(payload) {
    if (!payload) return;

    const ts = Number(payload.timestamp) || Date.now();
    const vibration = Boolean(payload.vibration);
    const magnitude = computeMagnitude(payload.x_axis, payload.y_axis, payload.z_axis);

    // Always update last event time for tick() idle detection
    this._lastEventAt = ts;

    // Trim history window on each ingest
    this._trimHistory(ts);

    // Ignore non-vibration or below-threshold events
    const threshold = this._config.impact_magnitude_threshold;
    if (!vibration || magnitude < threshold) {
      this._currentIntensity = 0;
      return;
    }

    // Valid impact
    this._currentIntensity = magnitude;
    this._detectedImpacts += 1;

    if (magnitude > this._peakIntensity) {
      this._peakIntensity = magnitude;
    }

    // Record in history
    this._intensityHistory.push({ magnitude, timestamp: ts });

    // State transition: idle → active
    const prevStatus = this._status;
    if (this._status === 'idle') {
      this._status = 'active';
      this._sessionStartedAt = ts;
      this._idleStartedAt = null;
    }

    if (prevStatus !== this._status && this._onStateChange) {
      this._onStateChange(this.snapshot);
    }
  }

  /**
   * Called periodically (e.g., every timeline tick) to handle idle timeout.
   * @param {number} now - Current timestamp in ms
   */
  tick(now) {
    if (this._status !== 'active') {
      // Check session reset while idle
      if (this._idleStartedAt && this._detectedImpacts > 0) {
        const idleDuration = now - this._idleStartedAt;
        if (idleDuration >= this._config.session_reset_seconds * 1000) {
          this._resetSession();
        }
      }
      return;
    }

    const lastEvent = this._lastEventAt || 0;
    const elapsed = now - lastEvent;
    const idleTimeoutMs = this._config.idle_timeout_seconds * 1000;

    if (elapsed >= idleTimeoutMs) {
      this._status = 'idle';
      this._currentIntensity = 0;
      this._idleStartedAt = now;

      // Freeze session duration at last event
      // (sessionDurationMs getter returns 0 when idle)

      if (this._onStateChange) {
        this._onStateChange(this.snapshot);
      }
    }
  }

  reset() {
    this._status = 'idle';
    this._sessionStartedAt = null;
    this._lastEventAt = null;
    this._idleStartedAt = null;
    this._detectedImpacts = 0;
    this._currentIntensity = 0;
    this._peakIntensity = 0;
    this._intensityHistory = [];
  }

  _resetSession() {
    this._detectedImpacts = 0;
    this._peakIntensity = 0;
    this._sessionStartedAt = null;
    this._idleStartedAt = null;
    this._intensityHistory = [];
  }

  _getRecentHistory(now) {
    const windowMs = this._config.history_window_seconds * 1000;
    const cutoff = now - windowMs;
    return this._intensityHistory
      .filter(entry => entry.timestamp >= cutoff)
      .map(entry => entry.magnitude);
  }

  _trimHistory(now) {
    const windowMs = this._config.history_window_seconds * 1000;
    const cutoff = now - windowMs;
    this._intensityHistory = this._intensityHistory.filter(entry => entry.timestamp >= cutoff);
  }
}
```

### Step 4: Run tests to verify they pass

Run: `npx jest tests/unit/fitness/VibrationActivityTracker.test.mjs --no-coverage`
Expected: All PASS

### Step 5: Commit

```bash
git add frontend/src/hooks/fitness/VibrationActivityTracker.js tests/unit/fitness/VibrationActivityTracker.test.mjs
git commit -m "feat(fitness): add VibrationActivityTracker state machine with tests"
```

---

## Task 2: Wire VibrationActivityTracker into FitnessSession

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js`
- Test: `tests/unit/fitness/VibrationActivityTracker-session.test.mjs`

### Step 1: Write the failing tests

Create `tests/unit/fitness/VibrationActivityTracker-session.test.mjs`:

```javascript
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn(), child: jest.fn().mockReturnThis()
  })
}));

const { VibrationActivityTracker } = await import('#frontend/hooks/fitness/VibrationActivityTracker.js');

describe('FitnessSession vibration integration', () => {
  // Test the tracker map pattern in isolation (no full FitnessSession needed)

  describe('tracker map lifecycle', () => {
    let trackers;

    beforeEach(() => {
      trackers = new Map();
    });

    it('creates trackers from equipment config', () => {
      const equipment = [
        { id: 'punching_bag', sensor: { type: 'vibration' }, activity: { impact_multiplier: 2.0 } },
        { id: 'step_platform', sensor: { type: 'vibration' }, activity: { intensity_levels: [] } },
        { id: 'some_bike', type: 'bike' } // Not vibration — should be skipped
      ];

      equipment.forEach(item => {
        if (item.sensor?.type === 'vibration') {
          trackers.set(item.id, new VibrationActivityTracker(item.id, item.activity || {}));
        }
      });

      expect(trackers.size).toBe(2);
      expect(trackers.has('punching_bag')).toBe(true);
      expect(trackers.has('step_platform')).toBe(true);
      expect(trackers.has('some_bike')).toBe(false);
    });

    it('routes vibration events to correct tracker', () => {
      trackers.set('punching_bag', new VibrationActivityTracker('punching_bag', { impact_magnitude_threshold: 500 }));
      trackers.set('step_platform', new VibrationActivityTracker('step_platform', { impact_magnitude_threshold: 300 }));

      const payload = { equipmentId: 'punching_bag', vibration: true, x_axis: 600, y_axis: 0, z_axis: 0, timestamp: 1000 };
      const tracker = trackers.get(payload.equipmentId);
      if (tracker) tracker.ingest({ vibration: payload.vibration, x_axis: payload.x_axis, y_axis: payload.y_axis, z_axis: payload.z_axis, timestamp: payload.timestamp });

      expect(trackers.get('punching_bag').snapshot.status).toBe('active');
      expect(trackers.get('step_platform').snapshot.status).toBe('idle');
    });

    it('ignores events for unknown equipment', () => {
      trackers.set('punching_bag', new VibrationActivityTracker('punching_bag'));
      const tracker = trackers.get('unknown_device');
      expect(tracker).toBeUndefined();
      // Should not throw
    });

    it('resets all trackers', () => {
      trackers.set('punching_bag', new VibrationActivityTracker('punching_bag', { impact_magnitude_threshold: 500 }));
      trackers.get('punching_bag').ingest({ vibration: true, x_axis: 600, y_axis: 0, z_axis: 0, timestamp: 1000 });
      expect(trackers.get('punching_bag').snapshot.detectedImpacts).toBe(1);

      trackers.forEach(t => t.reset());
      expect(trackers.get('punching_bag').snapshot.detectedImpacts).toBe(0);
    });
  });
});
```

### Step 2: Run tests to verify they pass (these test the pattern, not FitnessSession mods)

Run: `npx jest tests/unit/fitness/VibrationActivityTracker-session.test.mjs --no-coverage`
Expected: PASS (tests the tracker map pattern)

### Step 3: Modify FitnessSession.js

Add these changes to `frontend/src/hooks/fitness/FitnessSession.js`:

**Add import (after line 13):**
```javascript
import { VibrationActivityTracker } from './VibrationActivityTracker.js';
```

**Add to constructor (after line 289, near `this.treasureBox = null`):**
```javascript
    this._vibrationTrackers = new Map(); // equipmentId -> VibrationActivityTracker
```

**Add new method `initVibrationTrackers` (after `setEquipmentCatalog`, ~line 970):**
```javascript
  /**
   * Initialize vibration activity trackers from equipment config.
   * Called when equipment catalog is set.
   * @param {Array} equipmentList - Equipment config array
   */
  initVibrationTrackers(equipmentList = []) {
    this._vibrationTrackers.clear();
    equipmentList.forEach(item => {
      if (item?.sensor?.type === 'vibration' && item.id) {
        const tracker = new VibrationActivityTracker(item.id, item.activity || {});
        this._vibrationTrackers.set(String(item.id), tracker);
        getLogger().debug('fitness.vibration_tracker.created', {
          equipmentId: item.id,
          config: item.activity || {}
        });
      }
    });
  }
```

**Add new method `ingestVibration` (after `initVibrationTrackers`):**
```javascript
  /**
   * Route a vibration event to the appropriate tracker.
   * @param {string} equipmentId
   * @param {Object} payload - { vibration, x_axis, y_axis, z_axis, timestamp }
   */
  ingestVibration(equipmentId, payload) {
    if (!equipmentId || !payload) return;
    const tracker = this._vibrationTrackers.get(String(equipmentId));
    if (!tracker) return;
    tracker.ingest(payload);
  }

  /**
   * Get a vibration tracker by equipment ID.
   * @param {string} equipmentId
   * @returns {VibrationActivityTracker|null}
   */
  getVibrationTracker(equipmentId) {
    return this._vibrationTrackers.get(String(equipmentId)) || null;
  }

  /**
   * Get all vibration tracker snapshots.
   * @returns {Map<string, Object>}
   */
  getVibrationSnapshots() {
    const snapshots = new Map();
    this._vibrationTrackers.forEach((tracker, id) => {
      snapshots.set(id, tracker.snapshot);
    });
    return snapshots;
  }
```

**Modify `setEquipmentCatalog` (~line 967) to also init trackers:**
```javascript
  setEquipmentCatalog(equipmentList = []) {
    this._deviceRouter.setEquipmentCatalog(equipmentList);
    this.initVibrationTrackers(equipmentList);
  }
```

**Modify `reset()` (~line 1858) — add tracker reset after line 1881 (`this.governanceEngine.reset()`):**
```javascript
    this._vibrationTrackers.forEach(t => t.reset());
```

**Modify `destroy()` (~line 1906) — add tracker cleanup after line 1918:**
```javascript
    this._vibrationTrackers.clear();
    this._vibrationTrackers = null;
```

### Step 4: Run existing tests to verify no regressions

Run: `npx jest tests/unit/fitness/ --no-coverage`
Expected: All PASS

### Step 5: Commit

```bash
git add frontend/src/hooks/fitness/FitnessSession.js tests/unit/fitness/VibrationActivityTracker-session.test.mjs
git commit -m "feat(fitness): wire VibrationActivityTracker into FitnessSession lifecycle"
```

---

## Task 3: Wire FitnessContext to Feed Vibration Events to Session

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx` (~line 1074-1136, `handleVibrationEvent`)

### Step 1: Read the existing handleVibrationEvent function

Read `frontend/src/context/FitnessContext.jsx` around lines 1074-1136 to see the exact current implementation.

### Step 2: Add session.ingestVibration call

Inside `handleVibrationEvent`, after the existing React state update (`setVibrationState`), add the session feed. Find the line after the `setVibrationState` call and before the timeout management. Add:

```javascript
      // Feed vibration data into session tracker for timeline/governance
      if (sessionRef.current) {
        sessionRef.current.ingestVibration(equipmentId, {
          vibration: data?.vibration ?? false,
          x_axis: axes?.x ?? data?.x_axis ?? 0,
          y_axis: axes?.y ?? data?.y_axis ?? 0,
          z_axis: axes?.z ?? data?.z_axis ?? 0,
          timestamp: timestamp || Date.now()
        });
      }
```

**Note for implementer:** The exact variable names (`sessionRef`, `axes`, `data`, `equipmentId`, `timestamp`) must match the existing destructured variables in `handleVibrationEvent`. Read the function first to confirm the names.

### Step 3: Verify dev server works

Start dev server (if not running), open the fitness app, confirm no console errors.

### Step 4: Commit

```bash
git add frontend/src/context/FitnessContext.jsx
git commit -m "feat(fitness): feed vibration events from context into session tracker"
```

---

## Task 4: Timeline Recording for Vibration Series

**Files:**
- Modify: `frontend/src/hooks/fitness/TimelineRecorder.js` (~line 268-348, after device metrics loop)
- Test: `tests/unit/fitness/VibrationActivityTracker-timeline.test.mjs`

### Step 1: Write the failing test

Create `tests/unit/fitness/VibrationActivityTracker-timeline.test.mjs`:

```javascript
import { describe, it, expect, jest } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  })
}));

const { VibrationActivityTracker } = await import('#frontend/hooks/fitness/VibrationActivityTracker.js');

describe('VibrationActivityTracker timeline series', () => {
  it('produces series-ready values from snapshot', () => {
    const tracker = new VibrationActivityTracker('punching_bag', {
      impact_magnitude_threshold: 500,
      impact_multiplier: 2.0,
      intensity_levels: [500, 1000, 1500]
    });

    // Idle state
    let snap = tracker.snapshot;
    expect(snap.status === 'active' ? 1 : 0).toBe(0);

    // Active state
    tracker.ingest({ vibration: true, x_axis: 800, y_axis: 0, z_axis: 0, timestamp: 1000 });
    snap = tracker.snapshot;
    expect(snap.status === 'active' ? 1 : 0).toBe(1);
    expect(snap.currentIntensity).toBe(800);
    expect(snap.estimatedImpacts).toBe(2);
  });
});
```

### Step 2: Run test to verify it passes (it tests the snapshot format)

Run: `npx jest tests/unit/fitness/VibrationActivityTracker-timeline.test.mjs --no-coverage`
Expected: PASS

### Step 3: Modify TimelineRecorder.js

Read `frontend/src/hooks/fitness/TimelineRecorder.js` to find the exact insertion point. After the device metrics loop (~line 307, after the last `assignMetric` for device heart_rate), add:

```javascript
    // Record vibration tracker series
    if (this._vibrationTrackers) {
      this._vibrationTrackers.forEach((tracker, equipmentId) => {
        tracker.tick(tickTimestamp);
        const snap = tracker.snapshot;
        assignMetric(`vib:${equipmentId}:active`, snap.status === 'active' ? 1 : 0);
        if (snap.currentIntensity > 0) {
          assignMetric(`vib:${equipmentId}:intensity`, snap.currentIntensity);
        }
        assignMetric(`vib:${equipmentId}:impacts`, snap.estimatedImpacts);
      });
    }
```

**Also add a setter method** to TimelineRecorder for the trackers reference:

```javascript
  /**
   * Set vibration trackers reference for timeline recording.
   * @param {Map<string, VibrationActivityTracker>} trackers
   */
  setVibrationTrackers(trackers) {
    this._vibrationTrackers = trackers || null;
  }
```

**Wire it in FitnessSession.ensureStarted()** (~line 1282, after `this._timelineRecorder.configure({...})`):

```javascript
    this._timelineRecorder.setVibrationTrackers(this._vibrationTrackers);
```

### Step 4: Run all fitness tests

Run: `npx jest tests/unit/fitness/ --no-coverage`
Expected: All PASS

### Step 5: Commit

```bash
git add frontend/src/hooks/fitness/TimelineRecorder.js frontend/src/hooks/fitness/FitnessSession.js tests/unit/fitness/VibrationActivityTracker-timeline.test.mjs
git commit -m "feat(fitness): record vibration series in timeline ticks"
```

---

## Task 5: Governance Engine — Vibration Challenge Support

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js` (~line 561 `_normalizePolicies`, ~line 1775 `_evaluateChallenges`)
- Test: `tests/unit/governance/GovernanceEngine-vibration.test.mjs`

### Step 1: Write the failing tests

Create `tests/unit/governance/GovernanceEngine-vibration.test.mjs`:

```javascript
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  })
}));

const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine vibration challenges', () => {
  let engine;
  let mockSession;
  let mockTracker;

  beforeEach(() => {
    mockTracker = {
      snapshot: {
        status: 'idle',
        sessionDurationMs: 0,
        estimatedImpacts: 0,
        currentIntensity: 0,
        recentIntensityHistory: []
      }
    };

    mockSession = {
      roster: [],
      zoneProfileStore: null,
      snapshot: {
        zoneConfig: [
          { id: 'cool', name: 'Cool', color: '#aaa' },
          { id: 'active', name: 'Active', color: '#f00' }
        ]
      },
      getActiveParticipantState: () => ({
        participants: ['alice'],
        zoneMap: { alice: 'active' },
        totalCount: 1
      }),
      getVibrationTracker: (id) => id === 'punching_bag' ? mockTracker : null
    };

    engine = new GovernanceEngine(mockSession);
  });

  describe('_normalizePolicies with vibration selections', () => {
    it('parses vibration selection from policy config', () => {
      const policies = engine._normalizePolicies({
        test_policy: {
          name: 'Test',
          base_requirement: [{ active: 'all' }],
          challenges: [{
            interval: [60, 120],
            selections: [{
              vibration: 'punching_bag',
              criteria: 'duration',
              target: 30,
              time_allowed: 60,
              label: 'Bag Work'
            }]
          }]
        }
      });

      expect(policies.length).toBe(1);
      const challenge = policies[0].challenges[0];
      expect(challenge.selections.length).toBe(1);
      const sel = challenge.selections[0];
      expect(sel.vibration).toBe('punching_bag');
      expect(sel.criteria).toBe('duration');
      expect(sel.target).toBe(30);
      expect(sel.label).toBe('Bag Work');
    });
  });

  describe('vibration challenge evaluation', () => {
    it('satisfies duration challenge when tracker shows enough duration', () => {
      mockTracker.snapshot.status = 'active';
      mockTracker.snapshot.sessionDurationMs = 31000; // 31 seconds > 30 target

      const satisfied = engine._evaluateVibrationChallenge({
        vibration: 'punching_bag',
        criteria: 'duration',
        target: 30
      });

      expect(satisfied).toBe(true);
    });

    it('fails duration challenge when tracker duration insufficient', () => {
      mockTracker.snapshot.status = 'active';
      mockTracker.snapshot.sessionDurationMs = 15000;

      const satisfied = engine._evaluateVibrationChallenge({
        vibration: 'punching_bag',
        criteria: 'duration',
        target: 30
      });

      expect(satisfied).toBe(false);
    });

    it('satisfies impacts challenge when estimated impacts meet target', () => {
      mockTracker.snapshot.estimatedImpacts = 12;

      const satisfied = engine._evaluateVibrationChallenge({
        vibration: 'punching_bag',
        criteria: 'impacts',
        target: 10
      });

      expect(satisfied).toBe(true);
    });

    it('satisfies intensity challenge when enough high-magnitude hits detected', () => {
      mockTracker.snapshot.recentIntensityHistory = [1600, 800, 1700, 500, 1800];

      const satisfied = engine._evaluateVibrationChallenge({
        vibration: 'punching_bag',
        criteria: 'intensity',
        target: 1500,
        count: 3
      });

      expect(satisfied).toBe(true);
    });

    it('fails intensity challenge when not enough high hits', () => {
      mockTracker.snapshot.recentIntensityHistory = [1600, 800, 500, 500, 1800];

      const satisfied = engine._evaluateVibrationChallenge({
        vibration: 'punching_bag',
        criteria: 'intensity',
        target: 1500,
        count: 3
      });

      expect(satisfied).toBe(false);
    });

    it('returns false for unknown equipment', () => {
      const satisfied = engine._evaluateVibrationChallenge({
        vibration: 'nonexistent',
        criteria: 'duration',
        target: 10
      });

      expect(satisfied).toBe(false);
    });
  });
});
```

### Step 2: Run tests to verify they fail

Run: `npx jest tests/unit/governance/GovernanceEngine-vibration.test.mjs --no-coverage`
Expected: FAIL — `_evaluateVibrationChallenge` not defined

### Step 3: Implement vibration challenge support

**Add `_evaluateVibrationChallenge` method to GovernanceEngine** (after `_describeRule`, ~line 1765):

```javascript
  /**
   * Evaluate a vibration-based challenge against the current tracker state.
   * @param {Object} selection - { vibration: equipmentId, criteria, target, count? }
   * @returns {boolean} Whether the challenge criteria are satisfied
   */
  _evaluateVibrationChallenge(selection) {
    if (!selection?.vibration || !this.session?.getVibrationTracker) return false;
    const tracker = this.session.getVibrationTracker(selection.vibration);
    if (!tracker) return false;

    const snap = tracker.snapshot;
    const criteria = selection.criteria;
    const target = Number(selection.target);

    if (!Number.isFinite(target) || target <= 0) return false;

    switch (criteria) {
      case 'duration':
        return snap.sessionDurationMs >= target * 1000;

      case 'impacts':
        return snap.estimatedImpacts >= target;

      case 'intensity': {
        const count = Number(selection.count) || 1;
        const hits = (snap.recentIntensityHistory || []).filter(m => m >= target);
        return hits.length >= count;
      }

      default:
        getLogger().warn('governance.vibration_challenge.unknown_criteria', { criteria });
        return false;
    }
  }
```

**Modify `_normalizePolicies` (~line 614-636) to handle vibration selections.** In the selection mapping function, after the existing zone-based parsing, add an alternative path. Replace the selection mapping logic to also handle vibration selections:

Find the selection mapping block (around line 614-636). The current logic does:
```javascript
const zone = selectionValue.zone || selectionValue.zoneId || selectionValue.zone_id;
if (!zone) return null;
```

Change this to allow vibration selections to pass through without a zone:

```javascript
              const zone = selectionValue.zone || selectionValue.zoneId || selectionValue.zone_id;
              const vibration = selectionValue.vibration;

              // Either zone-based or vibration-based selection required
              if (!zone && !vibration) return null;

              const rule = selectionValue.min_participants ?? selectionValue.minParticipants ?? selectionValue.rule ?? 'all';
              const timeAllowed = Number(selectionValue.time_allowed ?? selectionValue.timeAllowed);
              if (!Number.isFinite(timeAllowed) || timeAllowed <= 0) return null;

              const weight = Number(selectionValue.weight ?? 1);

              return {
                id: `${policyId}_${index}_${selectionIndex}`,
                zone: zone ? String(zone) : null,
                vibration: vibration ? String(vibration) : null,
                criteria: selectionValue.criteria || null,
                target: Number(selectionValue.target) || null,
                count: Number(selectionValue.count) || null,
                rule,
                timeAllowedSeconds: Math.max(1, Math.round(timeAllowed)),
                weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
                label: selectionValue.label || selectionValue.name || null
              };
```

**Modify `buildChallengeSummary` (~line 2007) to handle vibration challenges.** At the top of `buildChallengeSummary`, add an early return for vibration challenges:

```javascript
    const buildChallengeSummary = (challenge) => {
        if (!challenge) return null;

        // Vibration-based challenge — no zone/participant evaluation
        if (challenge.vibration) {
          const satisfied = this._evaluateVibrationChallenge(challenge);
          const tracker = this.session?.getVibrationTracker?.(challenge.vibration);
          const snap = tracker?.snapshot || {};
          return {
            satisfied,
            metUsers: satisfied ? activeParticipants : [],
            missingUsers: satisfied ? [] : activeParticipants,
            actualCount: satisfied ? 1 : 0,
            requiredCount: 1,
            zoneLabel: challenge.label || challenge.vibration,
            vibrationSnapshot: snap
          };
        }

        // Existing zone-based logic follows...
```

### Step 4: Run tests to verify they pass

Run: `npx jest tests/unit/governance/ --no-coverage`
Expected: All PASS

### Step 5: Commit

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js tests/unit/governance/GovernanceEngine-vibration.test.mjs
git commit -m "feat(governance): add vibration challenge evaluation (duration/impacts/intensity)"
```

---

## Task 6: VibrationActivityAvatar Component

**Files:**
- Create: `frontend/src/modules/Fitness/components/VibrationActivityAvatar.jsx`
- Create: `frontend/src/modules/Fitness/components/VibrationActivityAvatar.scss`

### Step 1: Implement the component

Create `frontend/src/modules/Fitness/components/VibrationActivityAvatar.jsx`:

```jsx
import React, { useRef, useEffect, useMemo } from 'react';
import PropTypes from 'prop-types';
import './VibrationActivityAvatar.scss';

const DEFAULT_RING_COLORS = {
  none: 'var(--color-muted, #666)',
  low: 'var(--color-success, #4caf50)',
  medium: 'var(--color-warning, #ff9800)',
  high: 'var(--color-danger, #f44336)',
  active: 'var(--color-info, #2196f3)'
};

const formatDuration = (ms) => {
  if (!ms || ms <= 0) return '0:00';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
};

const VibrationActivityAvatar = ({
  snapshot = {},
  avatarSrc,
  avatarAlt = '',
  fallbackSrc = '',
  showIntensityRing = false,
  showActivityBar = false,
  showTimer = true,
  ringColorMap = DEFAULT_RING_COLORS,
  size = 80,
  className = '',
  style
}) => {
  const ringRef = useRef(null);
  const prevIntensityRef = useRef('none');

  const {
    status = 'idle',
    sessionDurationMs = 0,
    intensityLevel = 'none',
    currentIntensity = 0,
    recentIntensityHistory = [],
    estimatedImpacts = 0,
    peakIntensity = 0
  } = snapshot;

  const isActive = status === 'active';
  const ringColor = showIntensityRing
    ? (ringColorMap[intensityLevel] || ringColorMap.none)
    : (isActive ? (ringColorMap.active || DEFAULT_RING_COLORS.active) : ringColorMap.none);

  // Pulse animation via Web Animations API (CSS transitions killed by TVApp)
  useEffect(() => {
    if (!ringRef.current) return;
    const prev = prevIntensityRef.current;
    prevIntensityRef.current = intensityLevel;

    if (intensityLevel !== prev && intensityLevel !== 'none') {
      ringRef.current.animate([
        { transform: 'scale(1.15)', opacity: 1 },
        { transform: 'scale(1)', opacity: 0.8 }
      ], { duration: 300, easing: 'ease-out' });
    }
  }, [intensityLevel]);

  // Activity bar: normalize heights to peak
  const barData = useMemo(() => {
    if (!showActivityBar || recentIntensityHistory.length === 0) return [];
    const max = Math.max(...recentIntensityHistory, 1);
    return recentIntensityHistory.map(v => ({
      height: Math.max(2, Math.round((v / max) * 100)),
      value: v
    }));
  }, [showActivityBar, recentIntensityHistory]);

  const rootClass = ['vibration-activity-avatar', isActive ? 'is-active' : 'is-idle', className]
    .filter(Boolean).join(' ');

  return (
    <div className={rootClass} style={{ '--vib-size': `${size}px`, ...style }}>
      <div className="vib-avatar-ring" ref={ringRef} style={{ borderColor: ringColor }}>
        <div className="vib-avatar-content">
          {avatarSrc ? (
            <img
              src={avatarSrc}
              alt={avatarAlt}
              className="vib-avatar-image"
              onError={(e) => {
                if (fallbackSrc) e.currentTarget.src = fallbackSrc;
                else e.currentTarget.style.display = 'none';
              }}
            />
          ) : (
            <div className="vib-avatar-placeholder" />
          )}
        </div>
      </div>

      {showTimer && (
        <div className="vib-timer">
          {isActive ? formatDuration(sessionDurationMs) : '--:--'}
        </div>
      )}

      {showActivityBar && barData.length > 0 && (
        <div className="vib-activity-bar">
          {barData.map((bar, i) => (
            <div
              key={i}
              className="vib-bar-segment"
              style={{
                height: `${bar.height}%`,
                backgroundColor: ringColor
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
};

VibrationActivityAvatar.propTypes = {
  snapshot: PropTypes.shape({
    status: PropTypes.string,
    sessionDurationMs: PropTypes.number,
    intensityLevel: PropTypes.string,
    currentIntensity: PropTypes.number,
    recentIntensityHistory: PropTypes.arrayOf(PropTypes.number),
    estimatedImpacts: PropTypes.number,
    peakIntensity: PropTypes.number
  }),
  avatarSrc: PropTypes.string,
  avatarAlt: PropTypes.string,
  fallbackSrc: PropTypes.string,
  showIntensityRing: PropTypes.bool,
  showActivityBar: PropTypes.bool,
  showTimer: PropTypes.bool,
  ringColorMap: PropTypes.object,
  size: PropTypes.number,
  className: PropTypes.string,
  style: PropTypes.object
};

export default VibrationActivityAvatar;
```

Create `frontend/src/modules/Fitness/components/VibrationActivityAvatar.scss`:

```scss
.vibration-activity-avatar {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: var(--vib-size, 80px);

  &.is-active .vib-avatar-ring {
    border-width: 3px;
    opacity: 1;
  }

  &.is-idle .vib-avatar-ring {
    border-width: 2px;
    opacity: 0.5;
  }
}

.vib-avatar-ring {
  width: var(--vib-size, 80px);
  height: var(--vib-size, 80px);
  border-radius: 50%;
  border: 2px solid var(--color-muted, #666);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.vib-avatar-content {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.vib-avatar-image {
  width: 60%;
  height: 60%;
  object-fit: contain;
}

.vib-avatar-placeholder {
  width: 40%;
  height: 40%;
  border-radius: 50%;
  background: var(--color-muted, #666);
}

.vib-timer {
  font-size: 0.7em;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-secondary, #aaa);
  text-align: center;
}

.vib-activity-bar {
  display: flex;
  align-items: flex-end;
  gap: 1px;
  height: 20px;
  width: 100%;
  overflow: hidden;
}

.vib-bar-segment {
  flex: 1;
  min-width: 2px;
  border-radius: 1px 1px 0 0;
}
```

### Step 2: Verify it renders (manual)

Import and render the component temporarily in a test page or the existing VibrationCard to see it visually. This is a visual component — automated tests add little value here.

### Step 3: Commit

```bash
git add frontend/src/modules/Fitness/components/VibrationActivityAvatar.jsx frontend/src/modules/Fitness/components/VibrationActivityAvatar.scss
git commit -m "feat(fitness): add VibrationActivityAvatar component"
```

---

## Task 7: Integrate Avatar into FitnessSidebar

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/VibrationCard.jsx`
- Modify: `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/index.js` (if needed)

### Step 1: Read VibrationCard.jsx and understand the current rendering

Read `frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/VibrationCard.jsx` to understand the current component structure. The avatar should be integrated into the existing card layout, replacing or supplementing the current icon/intensity display.

### Step 2: Add VibrationActivityAvatar to VibrationCard

Modify `VibrationCard.jsx` to import and render the avatar. The card already receives equipment context — add the tracker snapshot from the fitness context.

**The exact modification depends on how VibrationCard currently receives its props.** The implementer should:

1. Import `VibrationActivityAvatar` from `../components/VibrationActivityAvatar`
2. Access the vibration tracker snapshot from the session (via context or passed as prop)
3. Render `VibrationActivityAvatar` with props configured by equipment type:
   - Punching bag: `showIntensityRing={true} showActivityBar={true}`
   - Step platform: `showIntensityRing={false} showActivityBar={false}`
4. Keep the existing `BaseRealtimeCard` wrapper for consistent sidebar layout

### Step 3: Test visually with the vibration simulator

Run: `node _extensions/fitness/vibration-simulation.mjs workout`

This sends realistic vibration data through MQTT → WebSocket → frontend. Verify:
- Avatar appears in sidebar during active session
- Ring pulses on punching bag impacts
- Timer counts up during activity
- Activity bar shows sparkline for punching bag
- Stepper shows simple active/idle glow

### Step 4: Commit

```bash
git add frontend/src/modules/Fitness/FitnessSidebar/RealtimeCards/VibrationCard.jsx
git commit -m "feat(fitness): integrate VibrationActivityAvatar into sidebar cards"
```

---

## Task 8: End-to-End Verification

### Step 1: Run all unit tests

Run: `npx jest tests/unit/ --no-coverage`
Expected: All PASS

### Step 2: Run vibration simulation with full stack

1. Start dev server: `npm run dev`
2. Open fitness app in browser
3. Run simulator: `node _extensions/fitness/vibration-simulation.mjs workout`
4. Verify:
   - Vibration events arrive (check console for `fitness.vibration_tracker.created` log)
   - Tracker transitions to active (check `session.getVibrationSnapshots()` in console)
   - Timeline records `vib:*` series (check timeline object in console)
   - Avatar updates in sidebar

### Step 3: Test governance challenge (manual config)

Temporarily add a vibration challenge to the fitness config for the active policy and verify it triggers and evaluates correctly when the simulator runs.

### Step 4: Final commit

```bash
git add -A
git commit -m "feat(fitness): vibration activity tracker - end-to-end integration"
```
