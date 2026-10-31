import { describe, it, expect } from 'vitest';
import { initialBoostState, activateBoost, advanceBoost, boostTargetAltitude } from './liftBoost.js';
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
  it('uses two seconds of boost and recharges eight seconds from activation', () => {
    let state=activateBoost({...initialBoostState(),phase:'playing'},course);
    expect(state.boostRemaining).toBe(2); expect(state.boostsUsed).toBe(1);
    expect(boostTargetAltitude(state,.5,course)).toBeCloseTo(.37);
    expect(activateBoost(state,course)).toBe(state);
    state=advanceBoost(state,2,course); expect(state.boostRemaining).toBe(0);
    expect(state.boostRechargeRemaining).toBe(6);
    state=advanceBoost(state,6,course); expect(activateBoost(state,course).boostsUsed).toBe(2);
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
  it('freezes boost when the transport is paused', () => {
    const state={...activateBoost(initial(),course),sensorMissingFor:1,pausedForSensor:true};
    const next=stepFlight(state,{rpm:0,connected:true,transportStalled:true},1,course);
    expect(next.boostRemaining).toBe(state.boostRemaining); expect(next.boostRechargeRemaining).toBe(state.boostRechargeRemaining);
  });
});
