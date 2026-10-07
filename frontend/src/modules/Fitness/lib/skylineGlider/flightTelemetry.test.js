import { describe, expect, it } from 'vitest';
import { collectFlightTelemetry } from './flightTelemetry.js';

const course = {
  id: 'mountain-pass',
  version: 2,
  motion: { coast_s: 1 },
  segments: [
    { id: 'hill', type: 'lower-terrain', start_s: 10, end_s: 20, safeBand: { top: .18, bottom: .6 } },
  ],
};

const state = (overrides = {}) => ({
  phase: 'playing', courseTime: .9, rawRpm: 60, filteredRpm: 58,
  targetAltitude: .42, altitude: .5, verticalRate: -.12,
  calibration: { lowRpm: 30, highRpm: 100 }, lives: 3, collisions: 0,
  restarts: 0, collectedIds: [], checkpoint: { id: 'start', time: 0 },
  pausedForSensor: false, inputMode: 'measured', zeroElapsed: 0, ...overrides,
});

describe('flight telemetry', () => {
  it('emits exactly one complete state sample for each crossed course second', () => {
    const first = collectFlightTelemetry({
      previous: state(), next: state({ courseTime: 1.04 }),
      input: { rpm: 61, connected: true, transportStalled: false },
      previousInput: { rpm: 60, connected: true, transportStalled: false },
      lastSampleSecond: 0, course,
    });
    const duplicate = collectFlightTelemetry({
      previous: state({ courseTime: 1.04 }), next: state({ courseTime: 1.8 }),
      input: { rpm: 62, connected: true, transportStalled: false },
      previousInput: { rpm: 61, connected: true, transportStalled: false },
      lastSampleSecond: first.nextSampleSecond, course,
    });

    expect(first.sample).toMatchObject({
      courseSecond: 1, rawRpm: 61, filteredRpm: 58, altitude: .5,
      targetAltitude: .42, verticalRate: -.12, lives: 3, inputMode: 'measured',
      sensor: { connected: true, stalled: false, paused: false },
    });
    expect(first.nextSampleSecond).toBe(1);
    expect(duplicate.sample).toBeNull();
  });

  it('reports inferred slowdown start, recovery, and escalation transitions', () => {
    const started = collectFlightTelemetry({
      previous: state(), next: state({ inputMode: 'inferred-slowdown' }),
      input: { connected: false }, previousInput: { connected: true }, lastSampleSecond: 0, course,
    });
    const recovered = collectFlightTelemetry({
      previous: state({ inputMode: 'inferred-slowdown' }), next: state(),
      input: { connected: true }, previousInput: { connected: false }, lastSampleSecond: 0, course,
    });
    const escalated = collectFlightTelemetry({
      previous: state({ inputMode: 'inferred-slowdown' }),
      next: state({ inputMode: 'sensor-paused', pausedForSensor: true }),
      input: { connected: false }, previousInput: { connected: false }, lastSampleSecond: 0, course,
    });

    expect(started.events).toContainEqual({ type: 'inferred_slowdown.started', data: {} });
    expect(recovered.events).toContainEqual({ type: 'inferred_slowdown.recovered', data: {} });
    expect(escalated.events).toContainEqual({ type: 'inferred_slowdown.escalated', data: {} });
  });

  it('resets the sample cursor when checkpoint recovery rewinds course time', () => {
    const result = collectFlightTelemetry({
      previous: state({ courseTime: 110, restarts: 0 }),
      next: state({ courseTime: 75, restarts: 1 }),
      input: { rpm: 60, connected: true, transportStalled: false },
      previousInput: { rpm: 60, connected: true, transportStalled: false },
      lastSampleSecond: 110, course,
    });

    expect(result.sample).toMatchObject({ courseSecond: 75 });
    expect(result.nextSampleSecond).toBe(75);
  });

  it('reports connection and coasting state changes once', () => {
    const result = collectFlightTelemetry({
      previous: state({ zeroElapsed: .8 }), next: state({ courseTime: 1.1, zeroElapsed: 1.1 }),
      input: { rpm: 0, connected: false, transportStalled: true },
      previousInput: { rpm: 0, connected: true, transportStalled: false },
      lastSampleSecond: 0, course,
    });

    expect(result.events).toEqual([
      { type: 'input.disconnected', data: { connected: false, stalled: true } },
      { type: 'coast.started', data: {} },
    ]);
  });

  it('reports sensor pause and resume transitions', () => {
    const paused = collectFlightTelemetry({
      previous: state(), next: state({ pausedForSensor: true }),
      input: { connected: false, transportStalled: true },
      previousInput: { connected: false, transportStalled: true },
      lastSampleSecond: 0, course,
    });
    const resumed = collectFlightTelemetry({
      previous: state({ pausedForSensor: true }), next: state(),
      input: { connected: true, transportStalled: false },
      previousInput: { connected: true, transportStalled: false },
      lastSampleSecond: 0, course,
    });

    expect(paused.events).toContainEqual({ type: 'sensor.paused', data: {} });
    expect(resumed.events).toContainEqual({ type: 'sensor.resumed', data: {} });
  });

  it('reports collision, collectible, checkpoint, and crash transitions without claiming presentation effects', () => {
    const result = collectFlightTelemetry({
      previous: state({ courseTime: 9.9 }),
      next: state({
        courseTime: 10.1, phase: 'crashed', lives: 0, collisions: 1, lastCollisionSegmentId: 'nose-hit',
        collectedIds: ['bell-1'], checkpoint: { id: 'ridge', time: 10 },
      }),
      input: { rpm: 40, connected: true, transportStalled: false },
      previousInput: { rpm: 42, connected: true, transportStalled: false },
      lastSampleSecond: 9, course,
    });

    expect(result.events).toContainEqual({ type: 'collision', data: { count: 1, lives: 0, segmentId: 'nose-hit' } });
    expect(result.events).toContainEqual({ type: 'collectible', data: { collectibleId: 'bell-1' } });
    expect(result.events).toContainEqual({ type: 'checkpoint', data: { checkpointId: 'ridge', checkpointTime: 10 } });
    expect(result.events).toContainEqual({ type: 'crashed', data: {} });
  });

  it('reports restart and completion transitions', () => {
    const restarted = collectFlightTelemetry({
      previous: state({ phase: 'crashed', restarts: 0 }),
      next: state({ courseTime: 75, restarts: 1 }), input: { connected: true },
      previousInput: { connected: true }, lastSampleSecond: 74, course,
    });
    const completed = collectFlightTelemetry({
      previous: state({ courseTime: 299 }),
      next: state({ courseTime: 300, phase: 'completed' }), input: { connected: true },
      previousInput: { connected: true }, lastSampleSecond: 299, course,
    });

    expect(restarted.events).toContainEqual({ type: 'restarted', data: { restartCount: 1, checkpointId: 'start' } });
    expect(completed.events).toContainEqual({ type: 'completed', data: {} });
  });
});
