import { describe, it, expect } from 'vitest';
import { createFlightState, stepFlight, retryFlightCheckpoint } from './flightEngine.js';

const calibration = { lowRpm: 30, highRpm: 130 };
const course = { duration_s: 20, motion: { response_s: .6, filter_s: .25, deadband_rpm: 2, max_climb_rate: .3, max_descent_rate: .3, disconnect_grace_s: .75, slow_signal_grace_s: 5, inferred_slowdown_s: .5 }, rules: { lives: 3, invincibility_s: 1, restart_delay_s: 2 }, segments: [{ id: 'finish', type: 'finish', start_s: 20 }] };
const fresh = rpm => ({ rpm, connected: true, ts: 101 });
const untilCrash = (state, input, act) => {
 for (let n = 0; n < 300 && state.phase === 'playing'; n++) state = stepFlight(state, input, 1 / 60, act);
 return state;
};

describe('unrecoverable zero-cadence stall', () => {
 for (const surface of ['open sky', 'assisted hill', 'lava']) {
  it(`falls irreversibly after zero over ${surface}, even if pedaling resumes`, () => {
   const act = { ...course, rules: { ...course.rules, assist_terrain: true }, segments: [
    ...(surface === 'open sky' ? [] : [{ id: 'ground', type: surface === 'lava' ? 'lava' : 'lower-terrain', start_s: 0, end_s: 20, top: .9 }]), ...course.segments,
   ] };
   const initial = createFlightState(act, { calibration, altitude: .4, courseTime: 2 });
   let state = stepFlight(initial, fresh(0), 1 / 60, act);
   expect(state.stalled).toBe(true);
   expect(state.targetAltitude).toBe(1);
   expect(state.altitude).toBeGreaterThan(initial.altitude);
   expect(state.courseTime).toBe(initial.courseTime);
   state = untilCrash(state, { ...fresh(130), actions: ['laser', 'bomb'] }, act);
   expect(state.phase).toBe('crashed');
   expect(state.crashCause).toBe('stall');
   expect(state.shotsFired).toBe(0);
   expect(state.bombsDropped).toBe(0);
  });
 }
 it('cannot turn a stalled fall into completion, a collectible or a new checkpoint', () => {
  const act = { ...course, segments: [{ id: 'checkpoint', type: 'checkpoint', start_s: 19.995 }, { id: 'bells', type: 'collectible-path', start_s: 19, end_s: 20, collectibles: [{ id: 'bell', at_s: 20, altitude: .5 }] }, ...course.segments] };
  let state = createFlightState(act, { calibration, altitude: .5, courseTime: 19.99 });
  state = stepFlight(state, fresh(0), 1 / 60, act);
  state = untilCrash(state, fresh(130), act);
  expect(state.phase).toBe('crashed');
  expect(state.checkpoint.id).toBe('start');
  expect(state.collectedIds).toEqual([]);
 });
 it('cannot cancel an existing stall by losing the transport', () => {
  let state = stepFlight(createFlightState(course, { calibration, altitude: .4 }), fresh(0), 1 / 60, course);
  state = untilCrash(state, { rpm: 130, connected: false, transportStalled: true }, course);
  expect(state.phase).toBe('crashed');
  expect(state.pausedForSensor).toBe(false);
 });
 it('protects missing transport and ignores an initial stale zero before arming', () => {
  const initial = createFlightState(course, { calibration, armedAtMs: 100 });
  let state = stepFlight(initial, { rpm: 0, connected: true, ts: 99 }, .5, course);
  expect(state.stalled).toBe(false);
  state = stepFlight(state, { rpm: 0, connected: false, transportStalled: true }, 5, course);
  expect(state.stalled).toBe(false);
  expect(state.pausedForSensor).toBe(true);
  state = stepFlight(state, fresh(0), 1 / 60, course);
  expect(state.stalled).toBe(true);
 });
 it('clears the stall only when the crash restarts at the checkpoint', () => {
  let state = createFlightState(course, { calibration, altitude: .5 });
  state.checkpoint = { ...state.checkpoint, id: 'saved', time: 5, restartAltitude: .5 };
  state = untilCrash(stepFlight(state, fresh(0), 1 / 60, course), fresh(130), course);
  state = stepFlight(state, fresh(130), 2.02, course);
  expect(state.phase).toBe('crashed');
  state = retryFlightCheckpoint(state, course);
  expect(state.stalled).toBe(false);
  expect(state.phase).toBe('playing');
  expect(state.courseTime).toBeGreaterThanOrEqual(5);
  expect(state.courseTime).toBeLessThan(5.05);
  expect(state.restarts).toBe(1);
 });
 it('maps 30 RPM exactly to the floor and 130 RPM exactly to the ceiling', () => {
  let state = createFlightState(course, { calibration, altitude: .5 });
  state.filteredRpm = 80;
  state = stepFlight(state, fresh(30), 1 / 60, course);
  expect(state.targetAltitude).toBe(.78);
  state = stepFlight(state, fresh(130), 1 / 60, course);
  expect(state.targetAltitude).toBeCloseTo(.18, 10);
  state = stepFlight(state, fresh(1), 1 / 60, course);
  expect(state.targetAltitude).toBe(.78);
  expect(state.stalled).toBe(false);
 });
});
