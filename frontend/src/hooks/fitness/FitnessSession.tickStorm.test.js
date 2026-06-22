/**
 * Regression guard: the HR-ingest path must not manufacture a timeline tick
 * storm. Telemetry from the garage UI freeze (session 20260622054305,
 * 2026-06-22) showed `fitness.tick_telemetry` anomaly HIGH_TICK_RATE with
 * actualTickRate ~76/sec and avgLoopIterations climbing 1.40 -> 7.84, vs an
 * expectedTickRate of 0.20/sec (5s interval).
 *
 * Over a simulated span of T seconds at a 5s tick interval, the timeline should
 * produce ~T/5 ticks. This drives BOTH tick sources (the 5s wall-clock timer
 * and the per-ingest catch-up loop) with fake timers and asserts the total
 * number of _collectTimelineTick calls stays proportional to elapsed wall time.
 *
 * NOTE: this guards the healthy steady-state path. It does not yet reproduce
 * the production storm (the exact trigger is still under investigation — see the
 * `fitness.tick_catchup.anomaly` instrumentation added to _maybeTickTimeline).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { FitnessSession } from './FitnessSession.js';

function hrPacket(deviceId, bpm, timestamp) {
  return {
    topic: 'fitness',
    type: 'ant',
    deviceId,
    profile: 'HR',
    data: { ComputedHeartRate: bpm, timestamp },
  };
}

describe('FitnessSession — HR ingest keeps timeline ticks proportional to wall time', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_782_133_000_000); // fixed epoch base (~2026-06-22)
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not over-fire _collectTimelineTick when timer + ingest both run', () => {
    const session = new FitnessSession();
    const deviceId = 'hr-storm-1';
    session.userManager.registerUser({ id: 'u1', name: 'U One', hr_device_id: deviceId });
    session.ensureStarted({ force: true, reason: 'tickStorm-guard' }); // starts the 5s timer

    const intervalMs = session.timeline?.timebase?.intervalMs || 5000;
    const collectSpy = vi.spyOn(session, '_collectTimelineTick');

    // Simulate 120 s of wall time: every 100 ms advance fake timers (the 5s
    // interval fires on schedule) and dispatch one HR packet stamped with now.
    const SIM_MS = 120_000;
    const STEP_MS = 100;
    for (let elapsed = 0; elapsed < SIM_MS; elapsed += STEP_MS) {
      vi.advanceTimersByTime(STEP_MS);
      session.ingestData(hrPacket(deviceId, 120, Date.now()));
    }

    const collectCalls = collectSpy.mock.calls.length;
    const expectedTicks = Math.ceil(SIM_MS / intervalMs); // ~24

    // Healthy: ~expectedTicks. Storm produced ~100x. Allow 5x slack for boundaries.
    expect(collectCalls).toBeLessThan(expectedTicks * 5);
  });
});
