import { describe, expect, it } from 'vitest';
import { validateCourse } from "./courseModel.js";
import { createFlightState, stepFlight, retryFlightCheckpoint } from "./flightEngine.js";

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

  it('treats measured zero RPM as an immediate unrecoverable stall', () => {
    let state = createFlightState(openCourse, { calibration });
    state = stepFlight(state, fresh(80), 3, openCourse);
    const before = state.altitude;
    state = stepFlight(state, fresh(0), 0.25, openCourse);
    expect(state.altitude).toBeGreaterThan(before);
    expect(state.targetAltitude).toBe(1);
    expect(state.stalled).toBe(true);
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

  it('crashes when the visible nose reaches terrain and not before', () => {
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

    expect(stepFlight(beforeNose, fresh(30), 1 / 60, sweptCourse).phase).toBe('playing');
    expect(stepFlight(atNose, fresh(30), 1 / 60, sweptCourse)).toMatchObject({ phase: 'crashed', crashCause: 'terrain', lastCollisionSegmentId: 'hill' });
    expect(stepFlight(afterTail, fresh(30), 1 / 60, sweptCourse).phase).toBe('playing');
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

  it('never lets a low rider fly through the ground: touching it is a crash even while invincible', () => {
    let state = createFlightState(course, { calibration, altitude: 0.7, courseTime: 2.1 });
    state = stepFlight({ ...state, invincibleRemaining: 1 }, fresh(30), 1 / 60, course);

    expect(state).toMatchObject({ phase: 'crashed', lives: 0, crashCause: 'terrain', lastCollisionSegmentId: 'wall' });
  });

  it('holds a sensor-paused craft above the ground instead of crashing or sinking into it', () => {
    let state = createFlightState(course, { calibration, altitude: 0.47, courseTime: 2.1 });
    const lost = { rpm: 0, connected: false, transportStalled: false, ts: 1 };
    state = run(state, 0.6, lost);

    expect(state.phase).toBe('playing');
    expect(state.altitude).toBeLessThanOrEqual(0.5 - 0.035 + 1e-9);
  });

  it('restores three lives and checkpoint state after a crash', () => {
    let state = createFlightState(course, { calibration, altitude: 0.4, courseTime: 4.99 });
    state = stepFlight(state, fresh(70), 1 / 60, course);
    expect(state.checkpoint.id).toBe('cp');
    state = { ...state, altitude: 0.7, courseTime: 2.1, lives: 2, invincibleRemaining: 0 };
    state = stepFlight(state, fresh(30), 1 / 60, course);
    expect(state.phase).toBe('crashed');
    state = retryFlightCheckpoint(run(state, 2.1, fresh(50)), course);
    expect(state.phase).toBe('playing');
    expect(state.lives).toBe(3);
    expect(state.courseTime).toBeGreaterThanOrEqual(5);
    expect(state.courseTime).toBeLessThan(5.2);
    expect(state.altitude).toBeCloseTo(0.5, 1);
    expect(state.filteredRpm).toBeGreaterThan(calibration.lowRpm);
  });
});

describe('entities', () => {
  const entityCourse = {
    ...course,
    segments: [
      { id: 'cp', type: 'checkpoint', start_s: 5, restart_altitude: 0.5 },
      { id: 'finish', type: 'finish', start_s: 20 },
    ],
    entities: [
      { id: 'tree-a', class: 'breakable', at_s: 3, altitude: 0.78, width_s: 0.5, height: 0.2 },
      { id: 'tree-b', class: 'breakable', at_s: 8, altitude: 0.78, width_s: 0.5, height: 0.2 },
      { id: 'tree-c', class: 'breakable', at_s: 10, altitude: 0.78, width_s: 0.5, height: 0.2 },
      { id: 'rock', class: 'solid', at_s: 14, altitude: 0.78, width_s: 0.8, height: 0.2 },
      { id: 'sign', class: 'scenery', at_s: 16, altitude: 0.78, width_s: 0.3, height: 0.2 },
    ],
  };
  const at = (courseTime, altitude, over = {}) => ({ ...createFlightState(entityCourse, { calibration, altitude, courseTime }), ...over });

  it('destroys a breakable on contact for one life, then flies on', () => {
    const next = stepFlight(at(2.5, 0.7), fresh(30), 1 / 60, entityCourse);

    expect(next).toMatchObject({ phase: 'playing', lives: 2, collisions: 1, destroyedIds: ['tree-a'], lastCollisionEntityId: 'tree-a' });
    expect(next.invincibleRemaining).toBeGreaterThan(1);
    expect(stepFlight({ ...next, invincibleRemaining: 0 }, fresh(30), 1 / 60, entityCourse).lives).toBe(2);
  });

  it('still destroys a breakable while blinking but charges nothing', () => {
    const next = stepFlight(at(2.5, 0.7, { invincibleRemaining: 1 }), fresh(30), 1 / 60, entityCourse);

    expect(next).toMatchObject({ lives: 3, collisions: 0, destroyedIds: ['tree-a'] });
  });

  it('crashes when a breakable takes the last life', () => {
    const next = stepFlight(at(9.5, 0.7, { lives: 1 }), fresh(30), 1 / 60, entityCourse);

    expect(next).toMatchObject({ phase: 'crashed', crashCause: 'lives', collisions: 1, lastCollisionEntityId: 'tree-c' });
  });

  it('crashes on a solid entity even while invincible and ignores scenery', () => {
    expect(stepFlight(at(13.5, 0.7, { invincibleRemaining: 1 }), fresh(30), 1 / 60, entityCourse))
      .toMatchObject({ phase: 'crashed', crashCause: 'entity', lastCollisionEntityId: 'rock' });
    expect(stepFlight(at(16, 0.7), fresh(30), 1 / 60, entityCourse)).toMatchObject({ phase: 'playing', lives: 3 });
  });

  it('flies clear over an entity', () => {
    expect(stepFlight(at(2.5, 0.5), fresh(70), 1 / 60, entityCourse)).toMatchObject({ lives: 3, destroyedIds: [] });
  });

  it('brings back breakables destroyed after the checkpoint on restart', () => {
    let state = at(4.99, 0.5);
    state = stepFlight({ ...state, destroyedIds: ['tree-a'] }, fresh(70), 1 / 60, entityCourse);
    expect(state.checkpoint.destroyedIds).toEqual(['tree-a']);
    state = stepFlight({ ...state, courseTime: 7.5, altitude: 0.7 }, fresh(30), 1 / 60, entityCourse);
    expect(state.destroyedIds).toEqual(['tree-a', 'tree-b']);
    state = stepFlight({ ...state, courseTime: 13.5, invincibleRemaining: 0 }, fresh(30), 1 / 60, entityCourse);
    state = retryFlightCheckpoint(run(state, 2.1, fresh(50)), entityCourse);

    expect(state.phase).toBe('playing');
    expect(state.destroyedIds).toEqual(['tree-a']);
  });
});

describe('completion', () => {
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

describe('weapons', () => {
  const armed = {
    ...course,
    segments: [
      { id: 'cp', type: 'checkpoint', start_s: 5, restart_altitude: 0.5 },
      { id: 'finish', type: 'finish', start_s: 20 },
    ],
    entities: [{ id: 'tree', class: 'breakable', at_s: 3, altitude: 0.78, width_s: 0.5, height: 0.3 }],
  };
  const start = (over = {}) => ({ ...createFlightState(armed, { calibration, altitude: 0.6, courseTime: 1 }), ...over });
  const fly = (state, seconds, input) => {
    let next = state;
    for (let i = 0; i < Math.round(seconds * 60); i += 1) next = stepFlight(next, input, 1 / 60, armed);
    return next;
  };
  const hold = fresh(55);

  it('starts armed and fills weapon fields on an older saved state', () => {
    expect(start()).toMatchObject({ projectiles: [], bombsLeft: 5, destroyedBy: {} });
    const { projectiles, bombsLeft, destroyedBy, ...legacy } = start();
    expect(stepFlight(legacy, hold, 1 / 60, armed)).toMatchObject({ projectiles: [], bombsLeft: 5 });
  });

  it('fires only on the first sub-step of a frame', () => {
    // 0.5 s outlasts the 0.3 s laser cooldown, so a press repeated on every sub-step would fire twice.
    const next = stepFlight(start(), { ...hold, actions: ['laser'] }, 0.5, armed);
    expect(next.shotsFired).toBe(1);
  });

  it('shoots a tree down without costing a life', () => {
    let next = stepFlight(start(), { ...hold, actions: ['laser'] }, 1 / 60, armed);
    next = fly(next, 0.5, hold);
    expect(next).toMatchObject({ lives: 3, collisions: 0, destroyedIds: ['tree'], destroyedBy: { tree: 'laser' } });
  });

  it('records a crash-broken breakable as broken by crash', () => {
    const next = stepFlight(start({ courseTime: 2.5, altitude: 0.7 }), fresh(30), 1 / 60, armed);
    expect(next.destroyedBy).toEqual({ tree: 'crash' });
  });

  it('cannot fire while paused for the sensor', () => {
    const paused = { ...createFlightState(armed, { calibration, armedAtMs: 10 }), courseTime: 1 };
    expect(stepFlight(paused, { rpm: 60, connected: false, ts: 5, actions: ['laser'] }, 1 / 60, armed).shotsFired).toBe(0);
  });

  it('flies through the box of a solid it has bombed', () => {
    const rocky = { ...armed, entities: [{ id: 'rock', class: 'solid', at_s: 4, altitude: 0.78, width_s: 0.8, height: 0.12 }] };
    let next = stepFlight(start({ courseTime: 3.4, altitude: 0.55 }), { ...fresh(30), actions: ['bomb'] }, 1 / 60, rocky);
    for (let i = 0; i < 90; i += 1) next = stepFlight(next, fresh(30), 1 / 60, rocky);
    expect(next.destroyedBy).toEqual({ rock: 'bomb' });
    expect(next.altitude + 0.035).toBeGreaterThan(0.66);
    expect(next).toMatchObject({ phase: 'playing', collisions: 0 });
  });

  it('refills bombs at a checkpoint and on restart, and clears shots on crash', () => {
    let next = stepFlight(start({ courseTime: 4.9, bombsLeft: 1 }), hold, 0.2, armed);
    expect(next.bombsLeft).toBe(5);
    const crashed = stepFlight({ ...next, bombsLeft: 0, projectiles: [{ id: 'laser-9', kind: 'laser', at_s: 6, origin_s: 6, altitude: 0.6 }], blasts: [{ id: 'bomb-9', at_s: 6, altitude: 0.7, remaining: 0.5 }], altitude: 0.99 }, hold, 1 / 60, { ...armed, segments: [...armed.segments.slice(0, 1), { id: 'floor', type: 'lower-terrain', start_s: 5, end_s: 8, top: 0.7 }, armed.segments[1]] });
    expect(crashed).toMatchObject({ phase: 'crashed', projectiles: [], blasts: [] });
    const restarted = retryFlightCheckpoint(stepFlight(crashed, hold, armed.rules.restart_delay_s + 0.05, armed), armed);
    expect(restarted).toMatchObject({ phase: 'playing', bombsLeft: 5, projectiles: [], blasts: [] });
  });
});
