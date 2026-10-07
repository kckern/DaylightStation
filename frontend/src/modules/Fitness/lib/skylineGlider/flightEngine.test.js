import { describe, expect, it } from 'vitest';
import { createFlightState, stepFlight } from './flightEngine.js';

const course = {
  duration_s: 20,
  motion: {
    response_s: 1.5, coast_s: 1, max_climb_rate: 0.3, max_descent_rate: 0.22,
    filter_s: 0.75, deadband_rpm: 2, disconnect_grace_s: 0.75,
  },
  rules: { lives: 3, invincibility_s: 1.25, restart_delay_s: 2 },
  segments: [
    { id: 'wall', type: 'lower-terrain', start_s: 2, end_s: 3, top: 0.5, safeBand: { top: 0.18, bottom: 0.5 } },
    { id: 'cp', type: 'checkpoint', start_s: 5 },
    { id: 'ring', type: 'collectible-path', start_s: 6, end_s: 7, collectibles: [{ id: 'r1', at_s: 6.2, altitude: 0.5 }] },
    { id: 'finish', type: 'finish', start_s: 20 },
  ],
};
const calibration = { lowRpm: 30, highRpm: 100 };
const fresh = (rpm) => ({ rpm, connected: true, transportStalled: false });

const run = (state, seconds, input, dt = 1 / 60) => {
  let next = state;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i += 1) next = stepFlight(next, input, dt, course);
  return next;
};

describe('flight motion', () => {
  it('maps low/high RPM into the altitude band and clamps above maximum', () => {
    let state = createFlightState(course, { calibration });
    state = stepFlight(state, fresh(30), 1 / 60, course);
    expect(state.targetAltitude).toBeCloseTo(0.78, 3);
    state = run(state, 5, fresh(140));
    expect(state.targetAltitude).toBeCloseTo(0.18, 3);
    expect(state.altitude).toBeGreaterThanOrEqual(0.18);
  });

  it('coasts at connected zero RPM before descending', () => {
    let state = run(createFlightState(course, { calibration }), 3, fresh(80));
    const before = state.altitude;
    state = run(state, 0.75, fresh(0));
    expect(Math.abs(state.altitude - before)).toBeLessThan(0.03);
    state = run(state, 1, fresh(0));
    expect(state.altitude).toBeGreaterThan(before);
  });

  it('protects collisions during disconnect grace then pauses', () => {
    let state = createFlightState(course, { calibration, altitude: 0.7 });
    state = run(state, 0.5, { rpm: 80, connected: false, transportStalled: true });
    expect(state.pausedForSensor).toBe(false);
    expect(state.collisionProtected).toBe(true);
    const atGrace = state.courseTime;
    state = run(state, 0.5, { rpm: 80, connected: false, transportStalled: true });
    expect(state.pausedForSensor).toBe(true);
    expect(state.courseTime).toBeCloseTo(atGrace + 0.25, 2);
    state = stepFlight(state, fresh(70), 1 / 60, course);
    expect(state.pausedForSensor).toBe(false);
  });

  it('is stable across different caller frame sizes', () => {
    const a = run(createFlightState(course, { calibration }), 1, fresh(75), 1 / 60);
    const b = run(createFlightState(course, { calibration }), 1, fresh(75), 1 / 20);
    expect(b.altitude).toBeCloseTo(a.altitude, 4);
    expect(b.filteredRpm).toBeCloseTo(a.filteredRpm, 4);
  });
});

describe('collisions, checkpoints, and completion', () => {
  it('takes one life per contact and respects invincibility', () => {
    let state = createFlightState(course, { calibration, altitude: 0.7, courseTime: 2.1 });
    state = stepFlight(state, fresh(30), 1 / 60, course);
    expect(state.lives).toBe(2);
    const afterHit = stepFlight(state, fresh(30), 1 / 60, course);
    expect(afterHit.lives).toBe(2);
    expect(afterHit.invincibleRemaining).toBeGreaterThan(1);
  });

  it('restores three lives and checkpoint state after the final collision', () => {
    let state = createFlightState(course, { calibration, altitude: 0.4, courseTime: 4.99 });
    state = stepFlight(state, fresh(70), 1 / 60, course);
    expect(state.checkpoint.id).toBe('cp');
    state = { ...state, altitude: 0.7, courseTime: 2.1, lives: 1, invincibleRemaining: 0 };
    state = stepFlight(state, fresh(30), 1 / 60, course);
    expect(state.phase).toBe('crashed');
    state = run(state, 2.1, fresh(50));
    expect(state.phase).toBe('playing');
    expect(state.lives).toBe(3);
    expect(state.courseTime).toBeGreaterThanOrEqual(5);
    expect(state.courseTime).toBeLessThan(5.2);
  });

  it('collects stable ids once and completes at the finish', () => {
    let state = createFlightState(course, { calibration, altitude: 0.5, courseTime: 6.15 });
    state = run(state, 0.2, fresh(65));
    expect(state.collectedIds).toEqual(['r1']);
    state = { ...state, courseTime: 6.15 };
    state = run(state, 0.2, fresh(65));
    expect(state.collectedIds).toEqual(['r1']);
    state = { ...state, courseTime: 19.99 };
    state = run(state, 0.1, fresh(65));
    expect(state.phase).toBe('completed');
  });
});
