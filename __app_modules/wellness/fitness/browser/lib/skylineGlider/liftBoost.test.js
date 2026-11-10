import { describe, it, expect } from 'vitest';
import { initialBoostState, activateBoost, advanceBoost, boostRules, cameraTime, courseSpeed } from './liftBoost.js';
import { createFlightState, stepFlight, retryFlightCheckpoint } from './flightEngine.js';
import { fireWeapons, advanceWeapons } from './weapons.js';

const course = { duration_s: 100, motion: { response_s: .6, filter_s: .25, deadband_rpm: 2, max_climb_rate: .3, max_descent_rate: .3, disconnect_grace_s: .75, slow_signal_grace_s: 5 }, rules: { lives: 3, restart_delay_s: 2, weapons: { enabled: true } }, segments: [{ id: 'finish', type: 'finish', start_s: 100 }], entities: [] };
const initial = () => createFlightState(course, { calibration: { lowRpm: 30, highRpm: 130 }, altitude: .5 });
describe('four flight actions', () => {
  it('keeps laser separate and allows three wasted missiles with cooldown', () => {
    let state = fireWeapons(initial(), ['laser'], course, 3);
    expect(state.bombsLeft).toBe(5); expect(state.missilesLeft).toBe(3);
    state = fireWeapons(state, ['missile','missile'], course, 3);
    expect(state.missilesLeft).toBe(2); expect(state.missilesFired).toBe(1);
    expect(state.projectiles.find(p=>p.kind==='missile').power).toBe(3);
    for(let i=0;i<3;i++){ state=advanceWeapons(state,.8,course); state=fireWeapons(state,['missile'],course); }
    expect(state.missilesLeft).toBe(0); expect(state.missilesFired).toBe(3);
    expect(advanceWeapons(state,10,course).projectiles).toEqual([]);
  });
  it('guides toward deterministic forward targets and cannot break bomb-only walls', () => {
    const target = { id:'target',class:'breakable',at_s:3,altitude:.4,width_s:.4,height:.15,vulnerable_to:['missile'] };
    const wall = { id:'wall',class:'solid',at_s:2,altitude:.5,width_s:.2,height:1,vulnerable_to:['bomb'] };
    let state=fireWeapons(initial(),['missile'],{...course,entities:[target]},2);
    expect(state.projectiles[0].targetId).toBe('target');
    state=advanceWeapons(state,1,{...course,entities:[wall,target]});
    expect(state.destroyedIds).not.toContain('wall'); expect(state.destroyedIds).not.toContain('target');
  });
  it('dashes the craft ahead, holds, then drifts back; recharges eight seconds from activation', () => {
    let state=activateBoost({...initialBoostState(),phase:'playing',courseTime:0},course);
    expect(state.boostRemaining).toBe(1.6); expect(state.boostsUsed).toBe(1);
    expect(activateBoost(state,course)).toBe(state);
    state=advanceBoost(state,.5,course); expect(state.boostOffset).toBeCloseTo(2.8);
    state=advanceBoost(state,1.1,course); expect(state.boostOffset).toBeCloseTo(2.8); expect(state.boostRemaining).toBe(0);
    state=advanceBoost(state,2.5,course); expect(state.boostOffset).toBeGreaterThan(0); expect(state.boostOffset).toBeLessThan(2.8);
    state=advanceBoost(state,2.5,course); expect(state.boostOffset).toBe(0); expect(state.boostElapsed).toBeNull();
    expect(state.boostRechargeRemaining).toBeCloseTo(1.4);
    state=advanceBoost(state,1.4,course); expect(activateBoost(state,course).boostsUsed).toBe(2);
  });
  it('never drifts back faster than the scroll, so the craft never moves backwards along the course', () => {
    let state=activateBoost({...initialBoostState(),phase:'playing'},course);
    for(let i=0;i<60*7;i++){ state=advanceBoost(state,1/60,course); expect(courseSpeed(state)).toBeGreaterThan(0); }
    expect(boostRules({rules:{boost:{offset_s:3,return_s:1}}}).return_s).toBeGreaterThanOrEqual(5);
  });
  it('a boost fired mid-drift surges on from where the craft already is', () => {
    let state=activateBoost({...initialBoostState(),phase:'playing'},course);
    state=advanceBoost(state,3,course); const mid=state.boostOffset;
    state=activateBoost({...state,boostRechargeRemaining:0},course);
    state=advanceBoost(state,1/60,course);
    expect(state.boostOffset).toBeGreaterThanOrEqual(mid);
  });
  it('commits a zero stall before boost and waits for explicit retry', () => {
    let state=stepFlight(initial(),{rpm:0,connected:true,actions:['boost']},.02,course);
    expect(state.stalled).toBe(true); expect(state.boostsUsed).toBe(0);
    state=stepFlight(state,{rpm:130,connected:true},10,course);
    expect(state.phase).toBe('crashed'); expect(state.restarts).toBe(0);
    const retry=retryFlightCheckpoint({...state,missilesLeft:0,bombsLeft:0},course);
    expect(retry).toMatchObject({phase:'playing',stalled:false,missilesLeft:3,bombsLeft:5,restarts:1,boostRemaining:0,boostRechargeRemaining:0});
    expect(retryFlightCheckpoint(retry,course)).toBe(retry);
  });
  it('moves the craft forward on screen while the camera keeps scrolling at 1x', () => {
    const steady = { rpm: 80, connected: true };
    let plain = initial(), boosted = initial();
    for (let i = 0; i < 60; i++) { plain = stepFlight(plain, steady, 1/60, course); boosted = stepFlight(boosted, { ...steady, actions: i === 0 ? ['boost'] : undefined }, 1/60, course); }
    expect(plain.courseTime).toBeCloseTo(1, 5);
    expect(cameraTime(boosted)).toBeCloseTo(cameraTime(plain), 5);
    expect(boosted.courseTime - cameraTime(boosted)).toBeCloseTo(2.8, 1);
    expect(boosted.altitude).toBeCloseTo(plain.altitude, 6);
    for (let i = 0; i < 60 * 8; i++) boosted = stepFlight(boosted, steady, 1/60, course);
    expect(boosted.boostOffset).toBe(0);
    expect(cameraTime(boosted)).toBeCloseTo(boosted.courseTime, 9);
  });
  it('drops bombs in the world frame and fires lasers at the craft speed of the moment they leave the nose', () => {
    const dashing = { ...initial(), boostRate: 5 };
    const bomb = advanceWeapons(fireWeapons(dashing, ['bomb'], course), .1, course).projectiles[0];
    expect(bomb.at_s).toBeCloseTo(.1);
    const laser = fireWeapons(dashing, ['laser'], course).projectiles[0];
    expect(laser.speed).toBe(6);
    // Already downrange, it keeps that speed however the craft moves next.
    expect(advanceWeapons({ ...dashing, boostRate: 0, projectiles: [laser] }, .1, course).projectiles[0].at_s).toBeCloseTo(laser.at_s + .9);
  });
  it('recharges boost as a shutter starts its warning, so an early press is not fatal', () => {
    const shutter = { id: 's', class: 'solid', at_s: 20, altitude: .6, width_s: .8, height: .2, closes_at_s: 10, vulnerable_to: [] };
    const gated = { ...course, entities: [shutter] };
    let state = { ...initial(), courseTime: 6.9, boostRechargeRemaining: 5 };
    state = stepFlight(state, { rpm: 80, connected: true }, .2, gated);
    expect(state.boostRechargeRemaining).toBe(0);
  });
  it('holds the dash where it is through a sensor dropout', () => {
    let boosting = stepFlight(initial(), { rpm: 80, connected: true, actions: ['boost'] }, 1/60, course);
    boosting = stepFlight(boosting, { rpm: 80, connected: true }, .2, course);
    const next = stepFlight(boosting, { rpm: 80, connected: false }, 1/60, course);
    expect(next.courseTime - boosting.courseTime).toBeCloseTo(1/60, 9);
    expect(next.boostOffset).toBe(boosting.boostOffset);
  });
  it('retrying a checkpoint puts the craft back on its anchor', () => {
    const crashed = { ...initial(), phase: 'crashed', boostOffset: 2, boostElapsed: 1, boostsUsed: 3 };
    expect(retryFlightCheckpoint(crashed, course)).toMatchObject({ boostOffset: 0, boostElapsed: null, boostsUsed: 3 });
  });
  it('lets a running boost ease out across a checkpoint instead of snapping to 1x', () => {
    const withCheckpoint = { ...course, segments: [{ id: 'cp', type: 'checkpoint', start_s: 0.5 }, ...course.segments] };
    let state = stepFlight({ ...initial(), courseTime: 0.48 }, { rpm: 80, connected: true, actions: ['boost'] }, 1/60, withCheckpoint);
    for (let i = 0; i < 30; i++) state = stepFlight(state, { rpm: 80, connected: true }, 1/60, withCheckpoint);
    expect(state.checkpoint.id).toBe('cp');
    expect(state.boostRemaining).toBeGreaterThan(1);
    expect(state.boostOffset).toBeGreaterThan(2);
    expect(state.boostRechargeRemaining).toBe(0);
  });
  it('freezes boost when the transport is paused', () => {
    const state={...activateBoost(initial(),course),sensorMissingFor:1,pausedForSensor:true};
    const next=stepFlight(state,{rpm:0,connected:true,transportStalled:true},1,course);
    expect(next.boostRemaining).toBe(state.boostRemaining); expect(next.boostRechargeRemaining).toBe(state.boostRechargeRemaining);
  });
});
