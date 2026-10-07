import { describe, expect, it } from 'vitest';
import { validateCourse } from './courseModel.js';
import { createFlightState, stepFlight } from './flightEngine.js';

const course = {
  duration_s: 20,
  motion: {
    response_s: 1.5, coast_s: 1, max_climb_rate: 0.3, max_descent_rate: 0.3,
    filter_s: 0.75, deadband_rpm: 2, disconnect_grace_s: 0.75,
    slow_signal_grace_s: 5, inferred_slowdown_s: 0.5,
  },
  rules: { lives: 3, invincibility_s: 1.25, restart_delay_s: 2 },
  segments: [
    { id: 'wall', type: 'lower-terrain', start_s: 2, end_s: 3, top: 0.5, safeBand: { top: 0.18, bottom: 0.5 } },
    { id: 'cp', type: 'checkpoint', start_s: 5, restart_altitude: 0.5 },
    { id: 'ring', type: 'collectible-path', start_s: 6, end_s: 7, collectibles: [{ id: 'r1', at_s: 6.2, altitude: 0.5 }] },
    { id: 'finish', type: 'finish', start_s: 20 },
  ],
};
const calibration = { lowRpm: 30, highRpm: 100 };
const fresh = (rpm, ts = 1) => ({ rpm, connected: true, transportStalled: false, ts });
const openCourse = {
  ...course,
  motion: { ...course.motion, response_s: 0.6 },
  segments: [{ id: 'finish', type: 'finish', start_s: 20 }],
};

const run = (state, seconds, input, dt = 1 / 60) => {
  let next = state;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i += 1) next = stepFlight(next, input, dt, course);
  return next;
};

describe('flight motion', () => {
  it('exposes signed vertical rate for presentation and telemetry', () => {
    let state = createFlightState(course, { calibration });
    expect(state.verticalRate).toBe(0);

    state = stepFlight(state, fresh(100), 1, course);
    expect(state.verticalRate).toBeLessThan(0);

    state = stepFlight(state, fresh(0), 2, course);
    expect(state.verticalRate).toBeGreaterThan(0);
  });

  it('maps low/high RPM into the altitude band and clamps above maximum', () => {
    let state = createFlightState(course, { calibration });
    state = stepFlight(state, fresh(30), 1 / 60, course);
    expect(state.targetAltitude).toBeCloseTo(0.78, 3);
    state = run(state, 5, fresh(140));
    expect(state.targetAltitude).toBeCloseTo(0.18, 3);
    expect(state.altitude).toBeGreaterThanOrEqual(0.18);
  });

  it('treats measured zero RPM as an immediate descent command', () => {
    let state = createFlightState(openCourse, { calibration });
    state = stepFlight(state, fresh(80), 3, openCourse);
    const before = state.altitude;
    state = stepFlight(state, fresh(0), 0.25, openCourse);
    expect(state.altitude).toBeGreaterThan(before);
    expect(state.targetAltitude).toBeCloseTo(0.78, 3);
  });

  it('infers intentional slowdown for five seconds and keeps descending with course motion', () => {
    let state = createFlightState(openCourse, { calibration, altitude: 0.18, courseTime: 10 });
    state = stepFlight(state, { rpm: 0, connected: false, transportStalled: false }, 1, openCourse);

    expect(state.inputMode).toBe('inferred-slowdown');
    expect(state.pausedForSensor).toBe(false);
    expect(state.collisionProtected).toBe(true);
    expect(state.courseTime).toBeCloseTo(11, 2);
    expect(state.altitude).toBeGreaterThanOrEqual(0.43);

    state = stepFlight(state, { rpm: 0, connected: false, transportStalled: false }, 4.25, openCourse);
    expect(state.inputMode).toBe('sensor-paused');
    expect(state.pausedForSensor).toBe(true);
    expect(state.courseTime).toBeCloseTo(15, 2);
  });

  it('recovers smoothly from inferred slowdown when measured cadence returns', () => {
    let state = createFlightState(openCourse, { calibration, altitude: 0.18, courseTime: 10 });
    state = stepFlight(state, { rpm: 0, connected: false, transportStalled: false }, 1, openCourse);
    const inferredAltitude = state.altitude;

    state = stepFlight(state, fresh(60, 2), 1 / 60, openCourse);

    expect(state.inputMode).toBe('measured');
    expect(state.pausedForSensor).toBe(false);
    expect(state.altitude - inferredAltitude).toBeLessThan(0.01);
  });

  it('protects collisions during disconnect grace then pauses', () => {
    let state = createFlightState(course, { calibration, altitude: 0.7 });
    state = run(state, 0.5, { rpm: 80, connected: false, transportStalled: true });
    expect(state.pausedForSensor).toBe(false);
    expect(state.collisionProtected).toBe(true);
    expect(state.inputMode).toBe('measured');
    const atGrace = state.courseTime;
    state = run(state, 0.5, { rpm: 80, connected: false, transportStalled: true });
    expect(state.pausedForSensor).toBe(true);
    expect(state.inputMode).toBe('transport-paused');
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
  it('does not collide with an invisible ceiling above lower terrain', () => {
    const lowerOnly = validateCourse({
      schema: 'skyline-glider-course/v1', id: 'lower-only', version: 1, name: 'Lower only',
      duration_s: 20, motion: course.motion, rules: course.rules,
      segments: [
        { id: 'hill', type: 'lower-terrain', start_s: 10, end_s: 19, top: 0.62 },
        { id: 'finish', type: 'finish', start_s: 20 },
      ],
    }).course;
    const state = createFlightState(lowerOnly, { calibration, altitude: 0.19, courseTime: 10 });

    const next = stepFlight(state, fresh(100), 1 / 60, lowerOnly);

    expect(next.lives).toBe(3);
  });

  it('does not collide with an invisible floor below upper terrain', () => {
    const upperOnly = validateCourse({
      schema: 'skyline-glider-course/v1', id: 'upper-only', version: 1, name: 'Upper only',
      duration_s: 20, motion: course.motion, rules: course.rules,
      segments: [
        { id: 'roof', type: 'upper-terrain', start_s: 10, end_s: 19, bottom: 0.42 },
        { id: 'finish', type: 'finish', start_s: 20 },
      ],
    }).course;
    const state = createFlightState(upperOnly, { calibration, altitude: 0.78, courseTime: 10 });

    const next = stepFlight(state, fresh(30), 1 / 60, upperOnly);

    expect(next.lives).toBe(3);
  });

  it('collides when the visible nose reaches terrain and clears after the tail leaves', () => {
    const sweptCourse = {
      ...course,
      segments: [
        { id: 'hill', type: 'lower-terrain', start_s: 10, end_s: 12, top: 0.62, safeBand: { top: 0, bottom: 0.62 } },
        { id: 'finish', type: 'finish', start_s: 20 },
      ],
    };
    const beforeNose = createFlightState(sweptCourse, { calibration, altitude: 0.7, courseTime: 9.18 });
    const atNose = createFlightState(sweptCourse, { calibration, altitude: 0.7, courseTime: 9.2 });
    const afterTail = createFlightState(sweptCourse, { calibration, altitude: 0.7, courseTime: 12.69 });

    expect(stepFlight(beforeNose, fresh(30), 1 / 60, sweptCourse).lives).toBe(3);
    expect(stepFlight(atNose, fresh(30), 1 / 60, sweptCourse).lives).toBe(2);
    expect(stepFlight(afterTail, fresh(30), 1 / 60, sweptCourse).lives).toBe(3);
  });

  it('collects a bell when the visible nose reaches it', () => {
    const bellCourse = {
      ...course,
      segments: [
        { id: 'bells', type: 'collectible-path', start_s: 10, end_s: 11, collectibles: [{ id: 'bell', at_s: 10, altitude: 0.5 }] },
        { id: 'finish', type: 'finish', start_s: 20 },
      ],
    };
    const state = createFlightState(bellCourse, { calibration, altitude: 0.5, courseTime: 9.2 });

    const next = stepFlight(state, fresh(65), 1 / 60, bellCourse);

    expect(next.collectedIds).toEqual(['bell']);
  });

  it('takes one life per contact and respects invincibility', () => {
    let state = createFlightState(course, { calibration, altitude: 0.7, courseTime: 2.1 });
    state = stepFlight(state, fresh(30), 1 / 60, course);
    expect(state.lives).toBe(2);
    const afterHit = stepFlight(state, fresh(30), 1 / 60, course);
    expect(afterHit.lives).toBe(2);
    expect(afterHit.invincibleRemaining).toBeGreaterThan(1);
  });

  it('does not take another life while continuously touching the same obstacle', () => {
    let state = createFlightState(course, { calibration, altitude: 0.7, courseTime: 2.1 });
    state = stepFlight(state, fresh(30), 1 / 60, course);
    expect(state.lives).toBe(2);

    state = run(state, 1.5, fresh(30));

    expect(state.lives).toBe(2);
    expect(state.contactSegmentId).toBe('wall');
  });

  it('allows a different obstacle to remove another life after the first is cleared', () => {
    const twoWalls = {
      ...course,
      duration_s: 12,
      segments: [
        { id: 'first', type: 'lower-terrain', start_s: 2, end_s: 3, top: 0.5, safeBand: { top: 0, bottom: 0.5 } },
        { id: 'second', type: 'lower-terrain', start_s: 6, end_s: 7, top: 0.5, safeBand: { top: 0, bottom: 0.5 } },
        { id: 'finish', type: 'finish', start_s: 12 },
      ],
    };
    let state = createFlightState(twoWalls, { calibration, altitude: 0.7, courseTime: 2.1 });
    state = stepFlight(state, fresh(30), 1 / 60, twoWalls);
    state = stepFlight({ ...state, courseTime: 6.1, invincibleRemaining: 0 }, fresh(30), 1 / 60, twoWalls);

    expect(state.lives).toBe(1);
    expect(state.contactSegmentId).toBe('second');
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
    expect(state.altitude).toBeCloseTo(0.5, 1);
    expect(state.filteredRpm).toBeGreaterThan(calibration.lowRpm);
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

describe('fresh input and shipped response', () => {
  it('holds course time at zero until a post-arm cadence packet arrives', () => {
    let state = createFlightState(course, { calibration, armedAtMs: 1000 });

    state = stepFlight(state, fresh(60, 999), 1, course);
    expect(state.courseTime).toBe(0);
    expect(state.inputReady).toBe(false);

    state = stepFlight(state, fresh(60, 1001), 1 / 60, course);
    expect(state.courseTime).toBeCloseTo(1 / 60, 4);
    expect(state.inputReady).toBe(true);
    expect(state.lastInputTs).toBe(1001);
  });

  it('responds promptly to a normal cadence correction with shipped tuning', () => {
    const tuned = { ...course, motion: { ...course.motion, filter_s: 0.25, response_s: 0.6 } };
    let state = createFlightState(tuned, { calibration });

    for (let index = 0; index < 60; index += 1) {
      state = stepFlight(state, fresh(65, index + 1), 1 / 60, tuned);
    }

    expect(state.altitude).toBeCloseTo(0.57, 2);
  });
});
