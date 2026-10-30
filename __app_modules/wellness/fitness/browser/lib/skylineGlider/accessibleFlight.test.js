import { describe, it, expect } from 'vitest';
import { terrainBounds, terrainContact, firstHitAlong, safeBandAt } from './flightGeometry.js';
import { validateCourse, resolveCalibration } from './courseModel.js';
import { createFlightState, stepFlight } from './flightEngine.js';
import { projectCourseWindow } from './courseProjection.js';

const hill = { id: 'hill', type: 'lower-terrain', start_s: 2, end_s: 12, top: .9, profile: [{ at_s: 2, altitude: .9 }, { at_s: 7, altitude: .5 }, { at_s: 12, altitude: .9 }] };
const base = { schema: 'skyline-glider-course/v1', id: 'practice', version: 1, duration_s: 20,
  motion: { filter_s: .25, deadband_rpm: 2, response_s: .6, max_climb_rate: .3, max_descent_rate: .3, disconnect_grace_s: .75, stop_coast_s: 3 },
  rules: { lives: 3, invincibility_s: 1, restart_delay_s: 2 }, segments: [{ id: 'finish', type: 'finish', start_s: 20 }] };
const calibration = { lowRpm: 15, highRpm: 60 };
const input = (rpm) => ({ rpm, connected: true });

describe('accessible flight', () => {
  it('uses the same interpolated slope for contact, craft footprint and projectile sweeps', () => {
    const course = { segments: [hill] };
    expect(terrainBounds(hill, 4.5).bottom).toBeCloseTo(.7);
    expect(safeBandAt(course, 4.5).bottom).toBeCloseTo(.636);
    expect(terrainContact(course, 4.5, .61)).toBe(hill);
    expect(firstHitAlong([], course, 2, 7, .7)?.at).toBeCloseTo(4.5);
    expect(firstHitAlong([], course, 2, 7, .4)).toBeNull();
  });
  it('projects authored slope points and lava', () => {
    const p = projectCourseWindow({ segments: [hill, { id: 'lava', type: 'lava', start_s: 0, end_s: 20, top: .9 }] }, 2);
    expect(p.segments.find(s => s.id === 'hill').profilePoints[0]).toEqual({ x: 240, y: 540 });
    expect(p.segments.some(s => s.type === 'lava')).toBe(true);
  });
  it('carries a slow pedaling beginner over hills without collisions', () => {
    const course = { ...base, rules: { ...base.rules, assist_terrain: true }, segments: [hill, ...base.segments] };
    for (const rpm of [1, 15, 30]) {
      const state = stepFlight(createFlightState(course, { calibration }), input(rpm), 20, course);
      expect(state.phase).toBe('completed');
      expect(state.collisions).toBe(0);
    }
  });
  it('keeps positive slow pedaling above lava but sinks after a confirmed stop', () => {
    const course = { ...base, segments: [{ id: 'lava', type: 'lava', start_s: 0, end_s: 20, top: .9 }, ...base.segments] };
    let state = createFlightState(course, { calibration });
    state = stepFlight(state, input(1), 10, course);
    expect(state.collisions).toBe(0);
    expect(state.altitude).toBeCloseTo(.78);
    state = stepFlight(state, input(0), 1 / 60, course);
    expect(state.stalled).toBe(true);
    state = stepFlight(state, input(130), .5, course);
    expect(state.phase).toBe('crashed');
    expect(state.crashCause).toBe('stall');
  });
  it('protects a transport outage above lava instead of treating it as a stop', () => {
    const course = { ...base, segments: [{ id: 'lava', type: 'lava', start_s: 0, end_s: 20, top: .9 }, ...base.segments] };
    const state = stepFlight(createFlightState(course, { calibration }), { rpm: 0, connected: true, transportStalled: true }, 10, course);
    expect(state.pausedForSensor).toBe(true);
    expect(state.collisions).toBe(0);
  });
  it('validates slope endpoints and lava and resolves act calibration first', () => {
    const course = { ...base, rpm: { min: 15, max: 60 }, segments: [hill, ...base.segments] };
    expect(validateCourse(course).valid).toBe(true);
    expect(validateCourse({ ...course, segments: [{ ...hill, profile: [{ at_s: 3, altitude: .9 }] }, ...base.segments] }).valid).toBe(false);
    expect(validateCourse({ ...base, segments: [{ id: 'lava', type: 'lava', start_s: 0, end_s: 20, top: 'bad' }, ...base.segments] }).valid).toBe(false);
    expect(resolveCalibration({ rpm: { min: 30, max: 100 } }, course)).toEqual(calibration);
    expect(validateCourse({ ...course, rpm: { min: 60, max: 15 } }).valid).toBe(false);
  });
});

it('allows an explicitly bomb-required wall only with enabled weapons and enough basic ammunition', () => {
 const wall = { id: 'gate', class: 'solid', at_s: 10, altitude: 1, width_s: 1, height: .95, hit_points: 1, vulnerable_to: ['bomb'], required_weapon: 'bomb' };
 expect(validateCourse({ ...base, entities: [wall] }).valid).toBe(true);
 expect(validateCourse({ ...base, entities: [wall], rules: { ...base.rules, weapons: { enabled: false } } }).valid).toBe(false);
 expect(validateCourse({ ...base, entities: [wall], rules: { ...base.rules, weapons: { bombs: 0 } } }).valid).toBe(false);
});

it('restores partial target damage at checkpoint and refills wasted ammunition', () => {
 const course = { ...base, segments: [{ id: 'cp', type: 'checkpoint', start_s: 2, restart_altitude: .5 }, { id: 'wall', type: 'lower-terrain', start_s: 8, end_s: 9, top: .4 }, ...base.segments] };
 let state = { ...createFlightState(course, { calibration }), entityDamage: { target: 1 } };
 state = stepFlight(state, input(15), 3, course);
 expect(state.checkpoint.entityDamage).toEqual({ target: 1 });
 state = { ...state, entityDamage: { target: 2 }, bombsLeft: 0 };
 state = stepFlight(state, input(15), 4.4, course);
 expect(state.phase).toBe('crashed');
 state = stepFlight(state, input(15), 2.1, course);
 expect(state.entityDamage).toEqual({ target: 1 });
 expect(state.bombsLeft).toBe(5);
});

it('does not fire during missing-transport grace or replay the press on recovery', () => {
 const initial = createFlightState(base, { calibration });
 const paused = stepFlight(initial, { rpm: 0, connected: true, transportStalled: true, actions: ['laser', 'bomb'] }, .1, base);
 expect(paused.shotsFired).toBe(0);
 expect(paused.bombsDropped).toBe(0);
 expect(stepFlight(paused, input(30), .1, base).shotsFired).toBe(0);
});

it('rejects malformed slope points without crashing validation', () => {
 for (const profile of [[null, null], [null, { at_s: 12, altitude: .9 }], [{ at_s: 2, altitude: .9 }, null]]) {
  expect(() => validateCourse({ ...base, segments: [{ ...hill, profile }, ...base.segments] })).not.toThrow();
  expect(validateCourse({ ...base, segments: [{ ...hill, profile }, ...base.segments] }).valid).toBe(false);
 }
});
