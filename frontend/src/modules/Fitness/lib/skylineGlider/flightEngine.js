import {
  HIGH_ALTITUDE,
  LOW_ALTITUDE,
  SKYLINE_CRAFT_GEOMETRY,
  pointOverlapsCraft,
  terrainBounds,
  terrainOverlappingCraft,
} from './flightGeometry.js';

const STEP = 1 / 60;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const moveToward = (value, target, amount) => value < target
  ? Math.min(target, value + amount)
  : Math.max(target, value - amount);

function targetForRpm(rpm, calibration) {
  const normalized = clamp((rpm - calibration.lowRpm) / (calibration.highRpm - calibration.lowRpm), 0, 1);
  return LOW_ALTITUDE + (HIGH_ALTITUDE - LOW_ALTITUDE) * normalized;
}

function crossingSegments(course, from, to, type) {
  return course.segments.filter((segment) => segment.type === type && segment.start_s > from && segment.start_s <= to);
}

function applyCourseEvents(state, previousTime, course) {
  let next = state;
  for (const checkpoint of crossingSegments(course, previousTime, next.courseTime, 'checkpoint')) {
    next = {
      ...next,
      checkpoint: {
        id: checkpoint.id,
        time: checkpoint.start_s,
        collectedIds: [...next.collectedIds],
      },
    };
  }
  const collected = new Set(next.collectedIds);
  for (const segment of course.segments.filter((entry) => entry.type === 'collectible-path')) {
    for (const item of segment.collectibles || []) {
      const reached = pointOverlapsCraft(item.at_s, next.courseTime);
      if (reached && Math.abs(next.altitude - item.altitude) <= 0.08) collected.add(item.id);
    }
  }
  next = { ...next, collectedIds: [...collected] };
  if (next.courseTime >= course.duration_s || crossingSegments(course, previousTime, next.courseTime, 'finish').length) {
    next = { ...next, phase: 'completed', courseTime: course.duration_s };
  }
  return next;
}

function collide(state, course) {
  if (state.collisionProtected || state.invincibleRemaining > 0 || state.phase !== 'playing') return state;
  const terrain = terrainOverlappingCraft(course, state.courseTime).find((segment) => {
    const bounds = terrainBounds(segment);
    return state.altitude - SKYLINE_CRAFT_GEOMETRY.radius < bounds.top
      || state.altitude + SKYLINE_CRAFT_GEOMETRY.radius > bounds.bottom;
  });
  if (!terrain) return state;
  const lives = state.lives - 1;
  if (lives <= 0) {
    return { ...state, lives: 0, phase: 'crashed', crashRemaining: course.rules.restart_delay_s, collisions: state.collisions + 1, lastCollisionSegmentId: terrain.id };
  }
  const bounds = terrainBounds(terrain);
  const centre = clamp((bounds.top + bounds.bottom) / 2, HIGH_ALTITUDE, LOW_ALTITUDE);
  return {
    ...state,
    lives,
    collisions: state.collisions + 1,
    lastCollisionSegmentId: terrain.id,
    altitude: moveToward(state.altitude, centre, 0.08),
    invincibleRemaining: course.rules.invincibility_s,
  };
}

function restartAtCheckpoint(state, course) {
  return {
    ...state,
    phase: 'playing',
    crashRemaining: 0,
    courseTime: state.checkpoint.time,
    lives: course.rules.lives,
    altitude: LOW_ALTITUDE,
    targetAltitude: LOW_ALTITUDE,
    filteredRpm: state.calibration.lowRpm,
    verticalRate: 0,
    zeroElapsed: 0,
    invincibleRemaining: 0,
    collectedIds: [...state.checkpoint.collectedIds],
    restarts: state.restarts + 1,
  };
}

function singleStep(state, input, dt, course) {
  if (state.phase === 'completed') return state;
  if (state.phase === 'crashed') {
    const crashRemaining = Math.max(0, state.crashRemaining - dt);
    return crashRemaining === 0 ? restartAtCheckpoint({ ...state, crashRemaining }, course) : { ...state, crashRemaining };
  }

  const missing = !input?.connected || input?.transportStalled;
  const inputTs = Number(input?.ts);
  if (!state.inputReady) {
    const freshAfterArm = !missing && Number.isFinite(inputTs) && inputTs > state.armedAtMs;
    if (!freshAfterArm) {
      return {
        ...state,
        rawRpm: Math.max(0, Number(input?.rpm) || 0),
        lastInputTs: Number.isFinite(inputTs) ? inputTs : state.lastInputTs,
        pausedForSensor: true,
        collisionProtected: true,
      };
    }
    state = { ...state, inputReady: true, pausedForSensor: false, collisionProtected: false, lastInputTs: inputTs };
  }
  if (missing) {
    const missingFor = state.sensorMissingFor + dt;
    if (missingFor - course.motion.disconnect_grace_s > 1e-9) {
      return { ...state, sensorMissingFor: missingFor, pausedForSensor: true, collisionProtected: true };
    }
  }

  const previousTime = state.courseTime;
  const rawRpm = Math.max(0, Number(input?.rpm) || 0);
  const zeroElapsed = !missing && rawRpm === 0 ? state.zeroElapsed + dt : 0;
  let filteredRpm = state.filteredRpm;
  const delta = rawRpm - filteredRpm;
  if (!missing && Math.abs(delta) > course.motion.deadband_rpm) {
    const alpha = 1 - Math.exp(-dt / course.motion.filter_s);
    filteredRpm += delta * alpha;
  }

  let targetAltitude = state.targetAltitude;
  if (!missing && rawRpm > 0) targetAltitude = targetForRpm(filteredRpm, state.calibration);
  if (!missing && rawRpm === 0 && zeroElapsed > course.motion.coast_s) targetAltitude = 0.95;

  const desiredRate = (targetAltitude - state.altitude) / course.motion.response_s;
  const rate = clamp(desiredRate, -course.motion.max_climb_rate, course.motion.max_descent_rate);
  const altitude = clamp(state.altitude + rate * dt, HIGH_ALTITUDE, LOW_ALTITUDE);
  let next = {
    ...state,
    rawRpm,
    filteredRpm,
    targetAltitude,
    altitude,
    verticalRate: rate,
    lastInputTs: Number.isFinite(inputTs) ? inputTs : state.lastInputTs,
    zeroElapsed,
    sensorMissingFor: missing ? state.sensorMissingFor + dt : 0,
    pausedForSensor: false,
    collisionProtected: missing,
    invincibleRemaining: Math.max(0, state.invincibleRemaining - dt),
    courseTime: state.courseTime + dt,
  };
  next = applyCourseEvents(next, previousTime, course);
  return collide(next, course);
}

export function createFlightState(course, {
  calibration, altitude = LOW_ALTITUDE, courseTime = 0, armedAtMs = null,
} = {}) {
  if (!calibration || calibration.highRpm <= calibration.lowRpm) throw new Error('Flight state requires valid calibration');
  return {
    phase: 'playing',
    courseTime,
    altitude,
    targetAltitude: altitude,
    rawRpm: 0,
    filteredRpm: calibration.lowRpm,
    verticalRate: 0,
    calibration: { ...calibration },
    lives: course.rules.lives,
    collisions: 0,
    lastCollisionSegmentId: null,
    restarts: 0,
    invincibleRemaining: 0,
    crashRemaining: 0,
    zeroElapsed: 0,
    sensorMissingFor: 0,
    pausedForSensor: false,
    collisionProtected: false,
    armedAtMs: Number.isFinite(Number(armedAtMs)) ? Number(armedAtMs) : 0,
    inputReady: armedAtMs == null,
    lastInputTs: null,
    collectedIds: [],
    checkpoint: { id: 'start', time: 0, collectedIds: [] },
  };
}

export function stepFlight(state, input, elapsedSeconds, course) {
  let remaining = Math.max(0, Number(elapsedSeconds) || 0);
  let next = state;
  while (remaining > 1e-9) {
    const dt = Math.min(STEP, remaining);
    next = singleStep(next, input, dt, course);
    remaining -= dt;
  }
  return next;
}
