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

describe('CycleRaceEngine — ghost replay', () => {
  it('replays a ghost cumulative-distance series instead of using rpm', () => {
    const e = new CycleRaceEngine({
      winCondition: 'distance', goalM: 1000, intervalMs: 1000,
      riders: [{ userId: 'g', ghostSeries: [10, 20, 30], ghostIntervalS: 1 }]
    });
    e.tick({}); // t=1s → 10
    expect(e.getState().riders.g.cumulativeDistanceM).toBe(10);
    e.tick({}); // t=2s → 20
    expect(e.getState().riders.g.cumulativeDistanceM).toBe(20);
    e.tick({}); // t=3s → 30
    expect(e.getState().riders.g.cumulativeDistanceM).toBe(30);
    e.tick({}); // beyond the recording → clamps to last sample
    expect(e.getState().riders.g.cumulativeDistanceM).toBe(30);
  });

  it('interpolates a ghost recorded at a different interval', () => {
    const e = new CycleRaceEngine({
      winCondition: 'time', timeCapS: 10, intervalMs: 1000,
      riders: [{ userId: 'g', ghostSeries: [100], ghostIntervalS: 2 }]
    });
    e.tick({}); // t=1s, sample at 2s → linear half → 50
    expect(e.getState().riders.g.cumulativeDistanceM).toBe(50);
  });

  it('flags ghost riders in state', () => {
    const e = new CycleRaceEngine({
      winCondition: 'distance', goalM: 1000, intervalMs: 1000,
      riders: [{ userId: 'a', wheelCircumferenceM: 2 }, { userId: 'g', ghostSeries: [50] }]
    });
    expect(e.getState().riders.g.isGhost).toBe(true);
    expect(e.getState().riders.a.isGhost).toBe(false);
  });
});

describe('CycleRaceEngine — HR series', () => {
  it('records each tick\'s heart rate into hrSeries and exposes latest heartRate', () => {
    const e = new CycleRaceEngine({
      winCondition: 'time', timeCapS: 30, intervalMs: 1000,
      riders: [{ userId: 'a', wheelCircumferenceM: 2 }]
    });
    e.tick({ a: { rpm: 60, zoneId: 'hot', heartRate: 150 } });
    e.tick({ a: { rpm: 60, zoneId: 'hot', heartRate: 162 } });
    const s = e.getState();
    expect(s.riders.a.hrSeries).toEqual([150, 162]);
    expect(s.riders.a.heartRate).toBe(162);
  });

  it('records null when no heart rate is present', () => {
    const e = new CycleRaceEngine({
      winCondition: 'time', timeCapS: 30, intervalMs: 1000,
      riders: [{ userId: 'a', wheelCircumferenceM: 2 }]
    });
    e.tick({ a: { rpm: 60, zoneId: 'hot' } });
    expect(e.getState().riders.a.hrSeries).toEqual([null]);
    expect(e.getState().riders.a.heartRate).toBeNull();
  });
});

describe('CycleRaceEngine — ghost HR replay', () => {
  it('replays a ghost hr series sampled at the elapsed time', () => {
    const e = new CycleRaceEngine({
      winCondition: 'time', timeCapS: 30, intervalMs: 1000,
      riders: [{ userId: 'g', ghostSeries: [10, 20, 30], ghostHrSeries: [140, 150, 160], ghostIntervalS: 1 }]
    });
    e.tick({}); // t=1s
    expect(e.getState().riders.g.heartRate).toBe(140);
    e.tick({}); // t=2s
    expect(e.getState().riders.g.heartRate).toBe(150);
  });

  it('reports null ghost HR when no hr series was recorded', () => {
    const e = new CycleRaceEngine({
      winCondition: 'time', timeCapS: 30, intervalMs: 1000,
      riders: [{ userId: 'g', ghostSeries: [10, 20], ghostIntervalS: 1 }]
    });
    e.tick({});
    expect(e.getState().riders.g.heartRate).toBeNull();
  });
});
