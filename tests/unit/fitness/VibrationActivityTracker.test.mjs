// tests/unit/fitness/VibrationActivityTracker.test.mjs
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    sampled: jest.fn()
  }),
  getLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    sampled: jest.fn()
  })
}));

const { VibrationActivityTracker } = await import(
  '#frontend/hooks/fitness/VibrationActivityTracker.js'
);

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a vibration event payload */
const makeEvent = (x, y, z, vibration = true, timestamp = Date.now()) => ({
  vibration,
  x_axis: x,
  y_axis: y,
  z_axis: z,
  timestamp
});

/** Euclidean magnitude (matches the class implementation) */
const magnitude = (x, y, z) =>
  Math.round(Math.sqrt(x * x + y * y + z * z));

const EQUIP_ID = 'jumprope-sensor-1';

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('VibrationActivityTracker', () => {
  let tracker;

  beforeEach(() => {
    tracker = new VibrationActivityTracker(EQUIP_ID);
  });

  // ── Constructor ───────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('starts in idle status with zero counters', () => {
      const snap = tracker.snapshot;
      expect(snap.equipmentId).toBe(EQUIP_ID);
      expect(snap.status).toBe('idle');
      expect(snap.detectedImpacts).toBe(0);
      expect(snap.estimatedImpacts).toBe(0);
      expect(snap.currentIntensity).toBe(0);
      expect(snap.intensityLevel).toBe('none');
      expect(snap.peakIntensity).toBe(0);
      expect(snap.sessionDurationMs).toBe(0);
      expect(snap.sessionStartedAt).toBeNull();
      expect(snap.recentIntensityHistory).toEqual([]);
    });

    it('uses defaults when no config is provided', () => {
      const t = new VibrationActivityTracker('eq-2');
      // Should not throw; snapshot should be valid
      expect(t.snapshot.status).toBe('idle');
    });

    it('accepts config overrides', () => {
      const t = new VibrationActivityTracker('eq-3', {
        idle_timeout_seconds: 10,
        impact_magnitude_threshold: 200
      });
      // A magnitude of 300 is above 200 but below default 400
      const ts = Date.now();
      t.ingest(makeEvent(300, 0, 0, true, ts));
      expect(t.snapshot.status).toBe('active');
      expect(t.snapshot.detectedImpacts).toBe(1);
    });
  });

  // ── ingest() ──────────────────────────────────────────────────────────────

  describe('ingest()', () => {
    it('transitions to active on vibration=true and magnitude above threshold', () => {
      const ts = Date.now();
      // magnitude(300, 300, 200) = round(sqrt(90000+90000+40000)) = round(sqrt(220000)) ≈ 469
      tracker.ingest(makeEvent(300, 300, 200, true, ts));
      expect(tracker.snapshot.status).toBe('active');
    });

    it('stays idle when magnitude is below threshold', () => {
      const ts = Date.now();
      // magnitude(100, 100, 100) = round(sqrt(30000)) ≈ 173
      tracker.ingest(makeEvent(100, 100, 100, true, ts));
      expect(tracker.snapshot.status).toBe('idle');
      expect(tracker.snapshot.detectedImpacts).toBe(0);
    });

    it('stays idle when vibration=false regardless of magnitude', () => {
      const ts = Date.now();
      // magnitude(500, 500, 500) ≈ 866 — well above threshold, but vibration is false
      tracker.ingest(makeEvent(500, 500, 500, false, ts));
      expect(tracker.snapshot.status).toBe('idle');
      expect(tracker.snapshot.detectedImpacts).toBe(0);
    });

    it('counts impacts above threshold', () => {
      const ts = Date.now();
      tracker.ingest(makeEvent(300, 300, 200, true, ts));
      tracker.ingest(makeEvent(300, 300, 200, true, ts + 100));
      tracker.ingest(makeEvent(300, 300, 200, true, ts + 200));
      expect(tracker.snapshot.detectedImpacts).toBe(3);
    });

    it('does not count below-threshold events as impacts', () => {
      const ts = Date.now();
      // One above-threshold impact
      tracker.ingest(makeEvent(300, 300, 200, true, ts));
      // Two below-threshold events
      tracker.ingest(makeEvent(50, 50, 50, true, ts + 100));
      tracker.ingest(makeEvent(100, 100, 100, true, ts + 200));
      expect(tracker.snapshot.detectedImpacts).toBe(1);
    });

    it('computes magnitude as euclidean norm (rounded)', () => {
      const ts = Date.now();
      // magnitude(300, 400, 0) = sqrt(90000 + 160000) = sqrt(250000) = 500
      tracker.ingest(makeEvent(300, 400, 0, true, ts));
      expect(tracker.snapshot.currentIntensity).toBe(500);
    });

    it('tracks peak intensity per session', () => {
      const ts = Date.now();
      // First: magnitude ≈ 469
      tracker.ingest(makeEvent(300, 300, 200, true, ts));
      const mag1 = magnitude(300, 300, 200);

      // Second: magnitude = 500
      tracker.ingest(makeEvent(300, 400, 0, true, ts + 100));

      // Third: magnitude ≈ 469 again (lower than peak)
      tracker.ingest(makeEvent(300, 300, 200, true, ts + 200));

      expect(tracker.snapshot.peakIntensity).toBe(500);
    });

    it('computes estimatedImpacts as detectedImpacts * multiplier', () => {
      const ts = Date.now();
      tracker.ingest(makeEvent(300, 300, 200, true, ts));
      tracker.ingest(makeEvent(300, 300, 200, true, ts + 100));
      // Default multiplier is 1.5 → 2 * 1.5 = 3
      expect(tracker.snapshot.estimatedImpacts).toBe(3);
    });

    it('tracks session duration while active', () => {
      const t0 = 1000000;
      tracker.ingest(makeEvent(300, 300, 200, true, t0));
      // Session started at t0, check snapshot at t0 + 5000
      const snap = tracker.snapshot;
      expect(snap.sessionStartedAt).toBe(t0);
      // sessionDurationMs is computed dynamically; it should reflect time since sessionStartedAt
      // Since snapshot reads Date.now() internally, we test that sessionStartedAt is set correctly
      expect(snap.sessionStartedAt).toBe(t0);
      expect(snap.sessionDurationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Intensity levels ──────────────────────────────────────────────────────

  describe('intensity level classification', () => {
    it('returns "none" when idle', () => {
      expect(tracker.snapshot.intensityLevel).toBe('none');
    });

    it('returns "low" for magnitude >= levels[0] and < levels[1]', () => {
      const ts = Date.now();
      // Default levels: [400, 800, 1200]
      // magnitude(300, 300, 200) ≈ 469 → low (>= 400, < 800)
      tracker.ingest(makeEvent(300, 300, 200, true, ts));
      expect(tracker.snapshot.intensityLevel).toBe('low');
    });

    it('returns "medium" for magnitude >= levels[1] and < levels[2]', () => {
      const ts = Date.now();
      // magnitude(500, 500, 400) = round(sqrt(250000+250000+160000)) = round(sqrt(660000)) ≈ 812
      tracker.ingest(makeEvent(500, 500, 400, true, ts));
      expect(tracker.snapshot.intensityLevel).toBe('medium');
    });

    it('returns "high" for magnitude >= levels[2]', () => {
      const ts = Date.now();
      // magnitude(800, 700, 600) = round(sqrt(640000+490000+360000)) = round(sqrt(1490000)) ≈ 1221
      tracker.ingest(makeEvent(800, 700, 600, true, ts));
      expect(tracker.snapshot.intensityLevel).toBe('high');
    });

    it('returns "none" for below-threshold events (not counted as impact)', () => {
      const ts = Date.now();
      tracker.ingest(makeEvent(50, 50, 50, true, ts));
      expect(tracker.snapshot.intensityLevel).toBe('none');
    });
  });

  // ── tick() — idle timeout ─────────────────────────────────────────────────

  describe('idle timeout via tick()', () => {
    it('transitions from active to idle after idle_timeout_seconds', () => {
      const t0 = 1000000;
      tracker.ingest(makeEvent(300, 300, 200, true, t0));
      expect(tracker.snapshot.status).toBe('active');

      // tick at t0 + 3s — still within timeout (default 5s)
      tracker.tick(t0 + 3000);
      expect(tracker.snapshot.status).toBe('active');

      // tick at t0 + 6s — past 5s timeout
      tracker.tick(t0 + 6000);
      expect(tracker.snapshot.status).toBe('idle');
    });

    it('stays active if events keep arriving before timeout', () => {
      const t0 = 1000000;
      tracker.ingest(makeEvent(300, 300, 200, true, t0));
      tracker.tick(t0 + 3000);
      expect(tracker.snapshot.status).toBe('active');

      // Another event resets the idle timer
      tracker.ingest(makeEvent(300, 300, 200, true, t0 + 4000));
      tracker.tick(t0 + 8000);
      // 8s since first event, but only 4s since last event — still active
      expect(tracker.snapshot.status).toBe('active');

      // 10s since last event — now idle
      tracker.tick(t0 + 14000);
      expect(tracker.snapshot.status).toBe('idle');
    });
  });

  // ── tick() — session reset ────────────────────────────────────────────────

  describe('session reset after prolonged idle', () => {
    it('zeroes counters after session_reset_seconds of idle', () => {
      const t0 = 1000000;
      tracker.ingest(makeEvent(300, 300, 200, true, t0));
      tracker.ingest(makeEvent(300, 300, 200, true, t0 + 100));
      expect(tracker.snapshot.detectedImpacts).toBe(2);

      // Go idle (5s timeout)
      tracker.tick(t0 + 6000);
      expect(tracker.snapshot.status).toBe('idle');
      // Counters should still be held
      expect(tracker.snapshot.detectedImpacts).toBe(2);

      // Session reset after 30s of idle
      tracker.tick(t0 + 37000);
      expect(tracker.snapshot.detectedImpacts).toBe(0);
      expect(tracker.snapshot.estimatedImpacts).toBe(0);
      expect(tracker.snapshot.peakIntensity).toBe(0);
      expect(tracker.snapshot.sessionDurationMs).toBe(0);
      expect(tracker.snapshot.sessionStartedAt).toBeNull();
    });

    it('does not reset counters if activity resumes before session_reset_seconds', () => {
      const t0 = 1000000;
      tracker.ingest(makeEvent(300, 300, 200, true, t0));
      tracker.ingest(makeEvent(300, 300, 200, true, t0 + 100));

      // Go idle
      tracker.tick(t0 + 6000);
      expect(tracker.snapshot.status).toBe('idle');
      expect(tracker.snapshot.detectedImpacts).toBe(2);

      // Resume activity before session_reset_seconds (30s)
      tracker.ingest(makeEvent(300, 300, 200, true, t0 + 20000));
      expect(tracker.snapshot.status).toBe('active');
      expect(tracker.snapshot.detectedImpacts).toBe(3);
    });
  });

  // ── recentIntensityHistory ────────────────────────────────────────────────

  describe('recentIntensityHistory', () => {
    it('accumulates magnitudes from above-threshold events', () => {
      const ts = Date.now();
      tracker.ingest(makeEvent(300, 300, 200, true, ts));
      tracker.ingest(makeEvent(300, 400, 0, true, ts + 100));

      const history = tracker.snapshot.recentIntensityHistory;
      expect(history).toHaveLength(2);
      expect(history[0].magnitude).toBe(magnitude(300, 300, 200));
      expect(history[1].magnitude).toBe(magnitude(300, 400, 0));
    });

    it('trims entries outside history_window_seconds', () => {
      const t0 = 1000000;
      // Default history_window_seconds = 30
      tracker.ingest(makeEvent(300, 300, 200, true, t0));
      tracker.ingest(makeEvent(300, 400, 0, true, t0 + 100));

      // Event well after the window
      tracker.ingest(makeEvent(300, 300, 200, true, t0 + 35000));

      const history = tracker.snapshot.recentIntensityHistory;
      // First two events are 35s ago relative to the last event — outside 30s window
      expect(history).toHaveLength(1);
      expect(history[0].timestamp).toBe(t0 + 35000);
    });
  });

  // ── reset() ───────────────────────────────────────────────────────────────

  describe('reset()', () => {
    it('clears all state back to initial', () => {
      const ts = Date.now();
      tracker.ingest(makeEvent(300, 300, 200, true, ts));
      tracker.ingest(makeEvent(300, 300, 200, true, ts + 100));
      expect(tracker.snapshot.detectedImpacts).toBe(2);
      expect(tracker.snapshot.status).toBe('active');

      tracker.reset();

      const snap = tracker.snapshot;
      expect(snap.status).toBe('idle');
      expect(snap.detectedImpacts).toBe(0);
      expect(snap.estimatedImpacts).toBe(0);
      expect(snap.currentIntensity).toBe(0);
      expect(snap.intensityLevel).toBe('none');
      expect(snap.peakIntensity).toBe(0);
      expect(snap.sessionDurationMs).toBe(0);
      expect(snap.sessionStartedAt).toBeNull();
      expect(snap.recentIntensityHistory).toEqual([]);
    });
  });

  // ── setOnStateChange ──────────────────────────────────────────────────────

  describe('setOnStateChange()', () => {
    it('fires callback on idle → active transition', () => {
      const cb = jest.fn();
      tracker.setOnStateChange(cb);

      const ts = Date.now();
      tracker.ingest(makeEvent(300, 300, 200, true, ts));

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith('active', 'idle');
    });

    it('fires callback on active → idle transition via tick()', () => {
      const t0 = 1000000;
      tracker.ingest(makeEvent(300, 300, 200, true, t0));

      const cb = jest.fn();
      tracker.setOnStateChange(cb);

      tracker.tick(t0 + 6000);

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith('idle', 'active');
    });

    it('does not fire on repeated events that stay in the same state', () => {
      const cb = jest.fn();
      tracker.setOnStateChange(cb);

      const ts = Date.now();
      tracker.ingest(makeEvent(300, 300, 200, true, ts));
      // Should fire once for idle → active
      expect(cb).toHaveBeenCalledTimes(1);

      // More events while already active — no additional fires
      tracker.ingest(makeEvent(300, 300, 200, true, ts + 100));
      tracker.ingest(makeEvent(300, 300, 200, true, ts + 200));
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('does not fire on below-threshold events that keep state idle', () => {
      const cb = jest.fn();
      tracker.setOnStateChange(cb);

      const ts = Date.now();
      tracker.ingest(makeEvent(50, 50, 50, true, ts));
      tracker.ingest(makeEvent(100, 100, 100, true, ts + 100));

      expect(cb).toHaveBeenCalledTimes(0);
    });
  });
});
