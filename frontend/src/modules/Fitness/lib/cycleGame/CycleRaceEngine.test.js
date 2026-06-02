import { describe, it, expect } from 'vitest';
import { CycleRaceEngine } from './CycleRaceEngine.js';

const HOT = [{ id: 'hot', distance_multiplier: 2 }];
const distRace = () => new CycleRaceEngine({
  winCondition: 'distance', goalM: 63, intervalMs: 5000, zones: HOT, hrlessMultiplier: 1,
  riders: [
    { userId: 'a', displayName: 'A', equipmentId: 'cycle_ace', wheelCircumferenceM: 2.1 },
    { userId: 'b', displayName: 'B', equipmentId: 'tricycle', wheelCircumferenceM: 1.2 }
  ]
});
const hotInputs = { a: { rpm: 60, zoneId: 'hot' }, b: { rpm: 60, zoneId: 'hot' } };

describe('CycleRaceEngine — distance race', () => {
  it('accumulates distance per rider per tick', () => {
    const e = distRace(); e.tick(hotInputs);
    const s = e.getState();
    expect(s.riders.a.cumulativeDistanceM).toBe(21);
    expect(s.riders.b.cumulativeDistanceM).toBe(12);
    expect(s.riders.a.distanceSeries).toEqual([21]);
  });
  it('stamps finishTimeS at goal, finishes when all cross', () => {
    const e = distRace();
    e.tick(hotInputs); e.tick(hotInputs); e.tick(hotInputs);
    let s = e.getState();
    expect(s.riders.a.finishTimeS).toBe(15);
    expect(s.riders.b.finishTimeS).toBeNull();
    expect(s.finished).toBe(false);
    e.tick(hotInputs); e.tick(hotInputs); e.tick(hotInputs);
    s = e.getState();
    expect(s.riders.b.finishTimeS).toBe(30);
    expect(s.finished).toBe(true);
    expect(s.standings[0].userId).toBe('a');
    expect(s.standings[0].placement).toBe(1);
    expect(s.standings[1].userId).toBe('b');
  });
  it('ignores ticks after finished', () => {
    const e = distRace();
    for (let i = 0; i < 6; i++) e.tick(hotInputs);
    const elapsed = e.getState().elapsedS;
    e.tick(hotInputs);
    expect(e.getState().elapsedS).toBe(elapsed);
  });
});

describe('CycleRaceEngine — time race', () => {
  it('finishes at time cap and ranks by distance', () => {
    const e = new CycleRaceEngine({
      winCondition: 'time', timeCapS: 10, intervalMs: 5000, zones: HOT,
      riders: [{ userId: 'a', wheelCircumferenceM: 2.0 }, { userId: 'b', wheelCircumferenceM: 1.0 }]
    });
    e.tick({ a: { rpm: 60, zoneId: 'hot' }, b: { rpm: 60, zoneId: 'hot' } });
    expect(e.getState().finished).toBe(false);
    e.tick({ a: { rpm: 60, zoneId: 'hot' }, b: { rpm: 60, zoneId: 'hot' } });
    const s = e.getState();
    expect(s.finished).toBe(true);
    expect(s.standings[0].userId).toBe('a');
  });
});

describe('CycleRaceEngine — HR-less rider', () => {
  it('uses hrless multiplier when zoneId is null', () => {
    const e = new CycleRaceEngine({
      winCondition: 'time', timeCapS: 100, intervalMs: 5000, zones: [], hrlessMultiplier: 1,
      riders: [{ userId: 'a', wheelCircumferenceM: 2.0 }]
    });
    e.tick({ a: { rpm: 60, zoneId: null } });
    expect(e.getState().riders.a.cumulativeDistanceM).toBe(10);
  });
});
