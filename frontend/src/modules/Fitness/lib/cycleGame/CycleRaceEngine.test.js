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

describe('CycleRaceEngine — distance finish-line lock', () => {
  it('freezes a finished rider at exactly goalM; later ticks add no distance', () => {
    const e = distRace(); // goalM 63, a gains 21/tick, b gains 12/tick
    e.tick(hotInputs); e.tick(hotInputs); e.tick(hotInputs); // a: 63 at t=15
    expect(e.getState().riders.a.cumulativeDistanceM).toBe(63);
    expect(e.getState().riders.a.finishTimeS).toBe(15);
    e.tick(hotInputs); // a finished → frozen, b advances to 48
    const s = e.getState();
    expect(s.riders.a.cumulativeDistanceM).toBe(63); // not 84
    expect(s.riders.b.cumulativeDistanceM).toBe(48);
  });
  it('clamps an overshooting crossing to goalM (no overshoot recorded)', () => {
    // b crosses on tick 6 (72 >= 63) — must record 63, not 72.
    const e = distRace();
    for (let i = 0; i < 6; i++) e.tick(hotInputs);
    const s = e.getState();
    expect(s.riders.b.cumulativeDistanceM).toBe(63);
    expect(s.riders.b.finishTimeS).toBe(30);
    expect(s.riders.b.distanceSeries[s.riders.b.distanceSeries.length - 1]).toBe(63);
  });
  it('records rpm 0 / zone null for a parked finished rider', () => {
    const e = distRace();
    e.tick(hotInputs); e.tick(hotInputs); e.tick(hotInputs); // a finished
    e.tick(hotInputs); // a parked this tick
    const a = e.getState().riders.a;
    expect(a.rpm).toBe(0);
    expect(a.zoneId).toBeNull();
  });
  it('freezes a ghost at the line too', () => {
    const e = new CycleRaceEngine({
      winCondition: 'distance', goalM: 25, intervalMs: 1000,
      riders: [{ userId: 'g', ghostSeries: [10, 20, 30, 40], ghostIntervalS: 1 }]
    });
    e.tick({}); e.tick({}); e.tick({}); // t=3s → recorded 30 ≥ 25 → clamp 25, finish at 3
    const s = e.getState();
    expect(s.riders.g.cumulativeDistanceM).toBe(25);
    expect(s.riders.g.finishTimeS).toBe(3);
  });
});

describe('CycleRaceEngine — rpm + zone series', () => {
  it('records each tick rpm and zoneId for a live rider', () => {
    const e = new CycleRaceEngine({
      winCondition: 'time', timeCapS: 30, intervalMs: 1000, zones: HOT,
      riders: [{ userId: 'a', wheelCircumferenceM: 2 }]
    });
    e.tick({ a: { rpm: 80, zoneId: 'hot', heartRate: 150 } });
    e.tick({ a: { rpm: 92, zoneId: 'hot', heartRate: 160 } });
    const a = e.getState().riders.a;
    expect(a.rpmSeries).toEqual([80, 92]);
    expect(a.zoneSeries).toEqual(['hot', 'hot']);
    expect(a.rpm).toBe(92);
    expect(a.zoneId).toBe('hot');
  });
  it('records rpm 0 / zone null when inputs are absent', () => {
    const e = new CycleRaceEngine({
      winCondition: 'time', timeCapS: 30, intervalMs: 1000,
      riders: [{ userId: 'a', wheelCircumferenceM: 2 }]
    });
    e.tick({ a: {} });
    const a = e.getState().riders.a;
    expect(a.rpmSeries).toEqual([0]);
    expect(a.zoneSeries).toEqual([null]);
  });
});

describe('CycleRaceEngine — ghost rpm + zone replay', () => {
  it('replays a ghost rpm and zone series sampled at elapsed time', () => {
    const e = new CycleRaceEngine({
      winCondition: 'time', timeCapS: 30, intervalMs: 1000,
      riders: [{
        userId: 'g',
        ghostSeries: [10, 20, 30],
        ghostRpmSeries: [70, 85, 95],
        ghostZoneSeries: ['warm', 'hot', 'hot'],
        ghostIntervalS: 1
      }]
    });
    e.tick({}); // t=1s
    expect(e.getState().riders.g.rpm).toBe(70);
    expect(e.getState().riders.g.zoneId).toBe('warm');
    e.tick({}); // t=2s
    expect(e.getState().riders.g.rpm).toBe(85);
    expect(e.getState().riders.g.zoneId).toBe('hot');
  });
  it('reports rpm 0 / zone null when no rpm/zone series recorded (old record)', () => {
    const e = new CycleRaceEngine({
      winCondition: 'time', timeCapS: 30, intervalMs: 1000,
      riders: [{ userId: 'g', ghostSeries: [10, 20], ghostIntervalS: 1 }]
    });
    e.tick({});
    expect(e.getState().riders.g.rpm).toBe(0);
    expect(e.getState().riders.g.zoneId).toBeNull();
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

describe('CycleRaceEngine lap splits', () => {
  it('records interpolated lap-crossing times when lapLengthM is set', () => {
    // 1 rider, wheel 1m/rotation, hrless mult 1, 1s ticks, lap = 100m.
    // 6000 rpm = 100 rotations/sec = 100 m/s → crosses 100m at exactly t=1s.
    const eng = new CycleRaceEngine({
      winCondition: 'time', timeCapS: 10, intervalMs: 1000, lapLengthM: 100,
      hrlessMultiplier: 1,
      riders: [{ userId: 'a', wheelCircumferenceM: 1 }]
    });
    eng.tick({ a: { rpm: 6000 } }); // +100m → 1 lap at t=1
    eng.tick({ a: { rpm: 6000 } }); // +100m → 2 laps at t=2
    const st = eng.getState();
    expect(st.riders.a.lapSplits.length).toBe(2);
    expect(st.riders.a.lapSplits[0]).toBeCloseTo(1, 2);
    expect(st.riders.a.lapSplits[1]).toBeCloseTo(2, 2);
  });

  it('interpolates a mid-tick crossing', () => {
    // 3000 rpm = 50 m/s. After 1 tick = 50m (no lap). After 2 ticks = 100m → lap
    // crossing exactly at t=2. After a faster tick we cross mid-interval.
    const eng = new CycleRaceEngine({
      winCondition: 'time', timeCapS: 10, intervalMs: 1000, lapLengthM: 100,
      hrlessMultiplier: 1, riders: [{ userId: 'a', wheelCircumferenceM: 1 }]
    });
    eng.tick({ a: { rpm: 3000 } }); // 50m, t=1
    eng.tick({ a: { rpm: 6000 } }); // +100m → 150m at t=2; crosses 100m mid-tick
    const st = eng.getState();
    // d0=50, d1=150 over [t=1,t=2]; boundary 100 at frac 0.5 → t≈1.5
    expect(st.riders.a.lapSplits[0]).toBeCloseTo(1.5, 2);
  });

  it('records nothing when laps are disabled (no lapLengthM)', () => {
    const eng = new CycleRaceEngine({
      winCondition: 'time', timeCapS: 10, intervalMs: 1000,
      hrlessMultiplier: 1, riders: [{ userId: 'a', wheelCircumferenceM: 1 }]
    });
    eng.tick({ a: { rpm: 6000 } });
    expect(eng.getState().riders.a.lapSplits).toEqual([]);
  });
});
