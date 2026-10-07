const STEP = 1 / 60;
const PLAYER_RADIUS = 0.035;
const LOW_ALTITUDE = 0.78;
const HIGH_ALTITUDE = 0.18;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const moveToward = (value, target, amount) => value < target
  ? Math.min(target, value + amount)
  : Math.max(target, value - amount);

function targetForRpm(rpm, calibration) {
  const normalized = clamp((rpm - calibration.lowRpm) / (calibration.highRpm - calibration.lowRpm), 0, 1);
  return LOW_ALTITUDE + (HIGH_ALTITUDE - LOW_ALTITUDE) * normalized;
}

function activeTerrain(course, time) {
  return course.segments.find((segment) => segment.safeBand
    && time >= segment.start_s && time <= (segment.end_s ?? segment.start_s));
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
      const crossed = item.at_s > previousTime && item.at_s <= next.courseTime;
      if (crossed && Math.abs(next.altitude - item.altitude) <= 0.08) collected.add(item.id);
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
  const terrain = activeTerrain(course, state.courseTime);
  if (!terrain) return state;
  const hit = state.altitude - PLAYER_RADIUS < terrain.safeBand.top
    || state.altitude + PLAYER_RADIUS > terrain.safeBand.bottom;
  if (!hit) return state;
  const lives = state.lives - 1;
  if (lives <= 0) {
    return { ...state, lives: 0, phase: 'crashed', crashRemaining: course.rules.restart_delay_s, collisions: state.collisions + 1 };
  }
  const centre = (terrain.safeBand.top + terrain.safeBand.bottom) / 2;
  return {
    ...state,
    lives,
    collisions: state.collisions + 1,
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
    filteredRpm: 0,
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

export function createFlightState(course, { calibration, altitude = LOW_ALTITUDE, courseTime = 0 } = {}) {
  if (!calibration || calibration.highRpm <= calibration.lowRpm) throw new Error('Flight state requires valid calibration');
  return {
    phase: 'playing',
    courseTime,
    altitude,
    targetAltitude: altitude,
    rawRpm: 0,
    filteredRpm: 0,
    calibration: { ...calibration },
    lives: course.rules.lives,
    collisions: 0,
    restarts: 0,
    invincibleRemaining: 0,
    crashRemaining: 0,
    zeroElapsed: 0,
    sensorMissingFor: 0,
    pausedForSensor: false,
    collisionProtected: false,
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
