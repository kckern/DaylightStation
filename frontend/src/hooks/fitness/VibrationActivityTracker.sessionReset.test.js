/**
 * Regression: VibrationActivityTracker.tick() must fire `session-reset` exactly
 * ONCE per idle period, not on every subsequent tick.
 *
 * Bug (garage UI freeze, session 20260622054305, 2026-06-22): `_resetCounters()`
 * deliberately preserves `_idleSince`, so once a tracker has been idle for
 * `session_reset_seconds`, the `idleDuration >= session_reset` branch stayed
 * true on EVERY following tick — re-running the reset + re-logging
 * `session-reset` forever (40,615 lines in ~8 min once the tick path ran hot).
 *
 * We spy on `_resetCounters` (the work each `session-reset` performs) and assert
 * it runs once per idle period.
 */
import { describe, it, expect, vi } from 'vitest';

import { VibrationActivityTracker } from './VibrationActivityTracker.js';

const CONFIG = {
  idle_timeout_seconds: 5,
  session_reset_seconds: 30,
  impact_magnitude_threshold: 400,
};

const impact = (timestamp) => ({ vibration: true, x_axis: 600, y_axis: 0, z_axis: 0, timestamp });

describe('VibrationActivityTracker — session-reset fires once per idle period', () => {
  it('does not re-fire the reset on every tick after the idle threshold', () => {
    const tracker = new VibrationActivityTracker('step_platform', CONFIG);
    const resetSpy = vi.spyOn(tracker, '_resetCounters');

    tracker.ingest(impact(1000));            // -> active
    expect(tracker.snapshot.status).toBe('active');

    tracker.tick(1000 + 5001);               // idle timeout -> idle
    expect(tracker.snapshot.status).toBe('idle');

    tracker.tick(6001 + 30001);              // idle >= 30s -> session reset #1
    expect(resetSpy).toHaveBeenCalledTimes(1);

    // Keep ticking while still idle — must NOT keep resetting.
    for (let i = 1; i <= 50; i += 1) {
      tracker.tick(6001 + 30001 + i * 1000);
    }
    expect(resetSpy).toHaveBeenCalledTimes(1);
  });

  it('fires again for a genuinely new idle period after re-activation', () => {
    const tracker = new VibrationActivityTracker('punching_bag', CONFIG);
    const resetSpy = vi.spyOn(tracker, '_resetCounters');

    tracker.ingest(impact(1000));
    tracker.tick(6001);                      // -> idle
    tracker.tick(36002);                     // reset #1
    tracker.tick(40000);                     // still idle, no re-fire
    expect(resetSpy).toHaveBeenCalledTimes(1);

    tracker.ingest(impact(50000));           // -> active again
    expect(tracker.snapshot.status).toBe('active');
    tracker.tick(55001);                     // -> idle
    tracker.tick(85002);                     // reset #2 (legitimate)
    expect(resetSpy).toHaveBeenCalledTimes(2);
  });
});
