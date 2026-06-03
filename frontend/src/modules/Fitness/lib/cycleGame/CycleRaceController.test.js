import { describe, it, expect } from 'vitest';
import { CycleRaceController } from './CycleRaceController.js';

const HOT = [{ id: 'hot', distance_multiplier: 2 }];
const distConfig = (over = {}) => ({
  winCondition: 'distance', goalM: 21, intervalMs: 5000, zones: HOT, hrlessMultiplier: 1,
  startCountdownS: 3, raceIdleDnfS: 10,
  riders: [
    { userId: 'a', wheelCircumferenceM: 2.1 },
    { userId: 'b', wheelCircumferenceM: 1.2 }
  ],
  ...over
});

describe('CycleRaceController — lifecycle', () => {
  it('starts staged', () => {
    expect(new CycleRaceController(distConfig()).getState().phase).toBe('staged');
  });
  it('runs the countdown then enters racing', () => {
    const c = new CycleRaceController(distConfig());
    expect(c.startCountdown().phase).toBe('countdown');
    expect(c.getState().countdownRemaining).toBe(3);
    c.countdownTick(); c.countdownTick();
    expect(c.getState().phase).toBe('countdown');
    expect(c.countdownTick().phase).toBe('racing');
  });
  it('skips countdown when startCountdownS is 0', () => {
    const c = new CycleRaceController(distConfig({ startCountdownS: 0 }));
    expect(c.startCountdown().phase).toBe('racing');
  });
  it('cancel moves to cancelled from any active phase', () => {
    const c = new CycleRaceController(distConfig());
    expect(c.cancel().phase).toBe('cancelled');
  });
});

describe('CycleRaceController — racing + DNF', () => {
  const toRacing = (cfg) => { const c = new CycleRaceController(cfg); c.startCountdown(); return c; };

  it('accumulates via the engine while racing', () => {
    const c = toRacing(distConfig({ startCountdownS: 0, goalM: 1000 }));
    c.tick({ a: { rpm: 60, zoneId: 'hot' }, b: { rpm: 60, zoneId: 'hot' } });
    expect(c.getState().engineState.riders.a.cumulativeDistanceM).toBe(21);
  });
  it('DNFs an idle rider and finishes when all are finished-or-DNF', () => {
    const c = toRacing(distConfig({ startCountdownS: 0 }));
    // a reaches goal (21) tick1; b idle
    c.tick({ a: { rpm: 60, zoneId: 'hot' }, b: { rpm: 0 } }); // b idle 5s
    expect(c.getState().phase).toBe('racing');
    c.tick({ a: { rpm: 0 }, b: { rpm: 0 } }); // b idle 10s → DNF
    const s = c.getState();
    expect(s.dnf).toContain('b');
    expect(s.phase).toBe('finished');
  });
  it('ignores ticks once finished and exposes results via showResults()', () => {
    const c = toRacing(distConfig({ startCountdownS: 0 }));
    c.tick({ a: { rpm: 60, zoneId: 'hot' }, b: { rpm: 60, zoneId: 'hot' } }); // both >=21 tick1? a=21,b=12
    c.tick({ a: { rpm: 60, zoneId: 'hot' }, b: { rpm: 60, zoneId: 'hot' } }); // b=24 → both finished
    expect(c.getState().phase).toBe('finished');
    expect(c.showResults().phase).toBe('results');
  });
});

describe('CycleRaceController — no RPM-abuse disqualification', () => {
  const toRacing = (cfg) => { const c = new CycleRaceController(cfg); c.startCountdown(); return c; };

  // The over-RPM "abuse" DQ was removed: a small-wheeled bike (tricycle) spins
  // past any old threshold under legitimate hard pedaling, and the gate punished
  // real effort. There is no DQ concept anymore.
  it('never disqualifies a rider sustaining very high RPM — keeps accumulating distance', () => {
    const c = toRacing(distConfig({
      startCountdownS: 0, goalM: 100000,
      riders: [{ userId: 'a', wheelCircumferenceM: 1.2 }]
    }));
    expect(c.getState().dq).toBeUndefined();
    let prev = 0;
    for (let i = 0; i < 12; i++) {
      c.tick({ a: { rpm: 200, zoneId: 'hot' } }); // would have tripped the old gate
      const dist = c.getState().engineState.riders.a.cumulativeDistanceM;
      expect(dist).toBeGreaterThan(prev); // distance keeps growing — never frozen
      prev = dist;
    }
    expect(c.getState().dq).toBeUndefined();
  });
});

describe('CycleRaceController — hot-start penalty', () => {
  const toRacing = (cfg) => { const c = new CycleRaceController(cfg); c.startCountdown(); return c; };

  it('disables the meter of a rider already pedalling at the green light', () => {
    const c = toRacing(distConfig({
      startCountdownS: 0, goalM: 100000, hotStartPenaltyS: 10,
      riders: [{ userId: 'a', wheelCircumferenceM: 2.1 }]
    }));
    c.tick({ a: { rpm: 60, zoneId: 'hot' } }); // hot start → penalised, no distance
    expect(c.getState().engineState.riders.a.cumulativeDistanceM).toBe(0);
    expect(c.getState().penalized).toContain('a');
    c.tick({ a: { rpm: 60, zoneId: 'hot' } }); // penalty window still consuming
    expect(c.getState().engineState.riders.a.cumulativeDistanceM).toBe(0);
    c.tick({ a: { rpm: 60, zoneId: 'hot' } }); // penalty over → distance accrues
    expect(c.getState().engineState.riders.a.cumulativeDistanceM).toBe(21);
  });

  it('does not penalise a rider who starts from rest', () => {
    const c = toRacing(distConfig({
      startCountdownS: 0, goalM: 100000, hotStartPenaltyS: 10,
      riders: [{ userId: 'a', wheelCircumferenceM: 2.1 }]
    }));
    c.tick({ a: { rpm: 0 } }); // at rest at green light → no penalty
    expect(c.getState().penalized).not.toContain('a');
    c.tick({ a: { rpm: 60, zoneId: 'hot' } }); // counts immediately
    expect(c.getState().engineState.riders.a.cumulativeDistanceM).toBe(21);
  });
});

describe('CycleRaceController — ghost rider', () => {
  it('never DNFs a ghost (it replays a recording) and the race still finishes', () => {
    const c = new CycleRaceController({
      winCondition: 'distance', goalM: 1000, intervalMs: 1000, zones: HOT, hrlessMultiplier: 1,
      startCountdownS: 0, raceIdleDnfS: 2,
      riders: [
        { userId: 'a', wheelCircumferenceM: 2.1 },
        { userId: 'g', ghostSeries: [2000], ghostIntervalS: 1 }
      ]
    });
    c.startCountdown();
    c.tick({ a: { rpm: 0 } }); // ghost → 2000 (finished); a idle 1s
    c.tick({ a: { rpm: 0 } }); // a idle 2s → DNF
    const s = c.getState();
    expect(s.dnf).toContain('a');
    expect(s.dnf).not.toContain('g');
    expect(s.phase).toBe('finished');
  });
});

describe('CycleRaceController — time race', () => {
  it('finishes at the time cap', () => {
    const c = new CycleRaceController({
      winCondition: 'time', timeCapS: 10, intervalMs: 5000, zones: HOT, startCountdownS: 0,
      riders: [{ userId: 'a', wheelCircumferenceM: 2.0 }]
    });
    c.startCountdown();
    c.tick({ a: { rpm: 60, zoneId: 'hot' } });
    expect(c.getState().phase).toBe('racing');
    c.tick({ a: { rpm: 60, zoneId: 'hot' } });
    expect(c.getState().phase).toBe('finished');
  });
});
