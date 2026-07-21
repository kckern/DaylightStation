/**
 * Regression guard for DEFECT 2: `fitness.tick_telemetry` cried wolf every 30s.
 *
 * Evidence: homeserver.local media/logs/fitness/2026-07-21T17-53-37.jsonl — for
 * 100 minutes EVERY window reported `actualTicks: 0`, `actualTickRate: "0.0/sec"`
 * and `avgLoopIterations: "0.00"` against `expectedTickRate: "0.20/sec"`, while
 * `tickCount` in the SAME payload advanced 1,7,14,20,25,32,38,44,50,56,62,68,73
 * — i.e. exactly 0.2/sec. Ticks were healthy; the counter was lying.
 *
 * Root cause: `actualTicks` was only incremented inside the per-ingest catch-up
 * loop in `_maybeTickTimeline`. In steady state that loop runs zero iterations
 * because the 5s wall-clock `setInterval` in `_startTickTimer` already produced
 * the tick, so the counter never moved.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const warnSpy = vi.fn();
const sampledSpy = vi.fn();
vi.mock('../../lib/logging/Logger.js', () => ({
  default: () => ({
    warn: warnSpy, info: vi.fn(), debug: vi.fn(), error: vi.fn(), sampled: sampledSpy,
    child: () => ({ warn: warnSpy, info: vi.fn(), debug: vi.fn(), error: vi.fn(), sampled: sampledSpy })
  }),
  __esModule: true
}));

import { FitnessSession } from './FitnessSession.js';

function hrPacket(deviceId, bpm, timestamp) {
  return {
    topic: 'fitness',
    type: 'ant',
    deviceId,
    profile: 'HR',
    data: { ComputedHeartRate: bpm, timestamp }
  };
}

/** Payloads from BOTH channels — healthy windows go to sampled, anomalies to warn. */
function tickTelemetryPayloads() {
  return [...sampledSpy.mock.calls, ...warnSpy.mock.calls]
    .filter(([ev]) => ev === 'fitness.tick_telemetry')
    .map(([, payload]) => payload);
}

/** Anomaly channel only. */
function tickTelemetryWarnings() {
  return warnSpy.mock.calls
    .filter(([ev]) => ev === 'fitness.tick_telemetry')
    .map(([, payload]) => payload);
}

/** Drive both tick sources (5s timer + per-ingest catch-up) for `ms` of wall time. */
function simulate(session, deviceId, ms, stepMs = 100) {
  for (let elapsed = 0; elapsed < ms; elapsed += stepMs) {
    vi.advanceTimersByTime(stepMs);
    session.ingestData(hrPacket(deviceId, 120, Date.now()));
  }
}

describe('FitnessSession — tick telemetry reflects reality', () => {
  beforeEach(() => {
    warnSpy.mockClear();
    sampledSpy.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(1_784_000_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('counts ticks produced by the wall-clock timer, not just the catch-up loop', () => {
    const session = new FitnessSession();
    const deviceId = 'hr-telemetry-1';
    session.userManager.registerUser({ id: 'u1', name: 'U One', hr_device_id: deviceId });
    session.ensureStarted({ force: true, reason: 'tickTelemetry-guard' });

    simulate(session, deviceId, 90_000);

    const payloads = tickTelemetryPayloads();
    expect(payloads.length).toBeGreaterThan(0);

    // The production bug: every window said 0 while tickCount advanced.
    for (const p of payloads) {
      expect(p.actualTicks).toBeGreaterThan(0);
    }
  });

  it('reports an actualTickRate consistent with the advancing tickCount', () => {
    const session = new FitnessSession();
    const deviceId = 'hr-telemetry-2';
    session.userManager.registerUser({ id: 'u2', name: 'U Two', hr_device_id: deviceId });
    session.ensureStarted({ force: true, reason: 'tickTelemetry-rate' });

    simulate(session, deviceId, 90_000);

    const payloads = tickTelemetryPayloads();
    const p = payloads[payloads.length - 1];
    const expected = parseFloat(p.expectedTickRate);
    const actual = parseFloat(p.actualTickRate);

    // 5s interval => 0.20/sec. Allow generous slack for window boundaries, but
    // 0.0/sec against 0.20/sec (the production reading) must fail.
    expect(actual).toBeGreaterThan(expected * 0.5);
    expect(actual).toBeLessThan(expected * 2);
  });

  it('does not raise a warn-level alarm when tick rate is healthy', () => {
    const session = new FitnessSession();
    const deviceId = 'hr-telemetry-3';
    session.userManager.registerUser({ id: 'u3', name: 'U Three', hr_device_id: deviceId });
    session.ensureStarted({ force: true, reason: 'tickTelemetry-quiet' });

    simulate(session, deviceId, 90_000);

    // A healthy session logged this warn 100+ times over 100 minutes, training
    // the user to ignore the warn channel. Healthy windows must not warn.
    const warned = warnSpy.mock.calls.filter(([ev]) => ev === 'fitness.tick_telemetry');
    expect(warned).toHaveLength(0);
  });

  it('still surfaces a genuine anomaly at warn level', () => {
    const session = new FitnessSession();
    const deviceId = 'hr-telemetry-4';
    session.userManager.registerUser({ id: 'u4', name: 'U Four', hr_device_id: deviceId });
    session.ensureStarted({ force: true, reason: 'tickTelemetry-anomaly' });

    simulate(session, deviceId, 40_000);
    warnSpy.mockClear();

    // Forge a storm: far more ticks than the window could legitimately hold.
    const tel = session._tickTelemetry;
    tel.actualTicks = 5000;
    tel.maybeTickCalls = 5000;
    tel.loopIterationsTotal = 5000;
    tel.lastLogAt = 0;
    session._maybeLogTickTelemetry(Date.now());

    const warned = tickTelemetryWarnings();
    expect(warned).toHaveLength(1);
    expect(warned[0].anomaly).toBe('HIGH_TICK_RATE');
  });

  it('separates catch-up ticks from timer ticks so the source is visible', () => {
    const session = new FitnessSession();
    const deviceId = 'hr-telemetry-5';
    session.userManager.registerUser({ id: 'u5', name: 'U Five', hr_device_id: deviceId });
    session.ensureStarted({ force: true, reason: 'tickTelemetry-source' });

    simulate(session, deviceId, 90_000);

    const payloads = sampledSpy.mock.calls
      .filter(([ev]) => ev === 'fitness.tick_telemetry')
      .map(([, p]) => p);
    expect(payloads.length).toBeGreaterThan(0);
    const p = payloads[payloads.length - 1];
    expect(p).toHaveProperty('catchupTicks');
    // Steady state: ticks come from the timer, catch-up contributes ~none.
    expect(p.actualTicks).toBeGreaterThan(p.catchupTicks);
  });

  it('does not double-count a tick that the catch-up loop produced', () => {
    const session = new FitnessSession();
    const deviceId = 'hr-telemetry-6';
    session.userManager.registerUser({ id: 'u6', name: 'U Six', hr_device_id: deviceId });
    session.ensureStarted({ force: true, reason: 'tickTelemetry-nodouble' });

    const collectSpy = vi.spyOn(session, '_collectTimelineTick');
    simulate(session, deviceId, 60_000);

    // Every recorded tick corresponds to exactly one _collectTimelineTick that
    // actually recorded (calls that no-op on a dead session are not counted).
    expect(session._tickTelemetry.actualTicks).toBeLessThanOrEqual(collectSpy.mock.calls.length);
  });
});
