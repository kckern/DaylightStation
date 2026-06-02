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
