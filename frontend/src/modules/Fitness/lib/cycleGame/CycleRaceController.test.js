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
  it('DNFs a no-show rider and finishes when all are finished-or-DNF', () => {
    // b never pedals → no-show; raceStartGraceS governs its DNF (10s here).
    const c = toRacing(distConfig({ startCountdownS: 0, raceStartGraceS: 10 }));
    // a reaches goal (21) tick1; b idle
    c.tick({ a: { rpm: 60, zoneId: 'hot' }, b: { rpm: 0 } }); // b no-show 5s
    expect(c.getState().phase).toBe('racing');
    c.tick({ a: { rpm: 0 }, b: { rpm: 0 } }); // b no-show 10s → DNF
    const s = c.getState();
    expect(s.dnf).toContain('b');
    expect(s.phase).toBe('finished');
  });
  // Magnetless cadence sensors (e.g. the COOSPO BK467 on the tricycle) can take
  // up to ~20s to lock onto rotation from a dead stop, reporting rpm 0 the whole
  // time even while the rider is pedalling. The start-grace window prevents that
  // lock-on lag from being scored as a no-show DNF.
  describe('start-grace (sensor lock-on)', () => {
    it('does NOT DNF a rider whose first reading is delayed past raceIdleDnfS but within the grace', () => {
      // raceIdleDnfS 10 (2 ticks) would DNF under the old logic; grace 30 (6 ticks) protects.
      const c = toRacing(distConfig({ startCountdownS: 0, goalM: 100000, raceIdleDnfS: 10, raceStartGraceS: 30 }));
      // a: sensor not locked → rpm 0 for 4 ticks (20s). b pedals normally so it never no-shows.
      for (let i = 0; i < 4; i += 1) c.tick({ a: { rpm: 0 }, b: { rpm: 60, zoneId: 'hot' } });
      expect(c.getState().dnf).not.toContain('a'); // 20s idle but never started → grace not yet exceeded
      // a's sensor finally locks on and it pedals — must stay in the race.
      c.tick({ a: { rpm: 80, zoneId: 'hot' }, b: { rpm: 60, zoneId: 'hot' } });
      expect(c.getState().dnf).not.toContain('a');
    });

    it('DNFs a true no-show only after raceStartGraceS, not raceIdleDnfS', () => {
      const c = toRacing(distConfig({ startCountdownS: 0, goalM: 100000, raceIdleDnfS: 10, raceStartGraceS: 30 }));
      for (let i = 0; i < 5; i += 1) c.tick({ a: { rpm: 60, zoneId: 'hot' }, b: { rpm: 0 } }); // b 25s
      expect(c.getState().dnf).not.toContain('b'); // 25s < 30s grace — still alive
      c.tick({ a: { rpm: 60, zoneId: 'hot' }, b: { rpm: 0 } }); // b 30s → no-show DNF
      expect(c.getState().dnf).toContain('b');
    });

    it('applies the normal raceIdleDnfS once a rider has registered movement', () => {
      const c = toRacing(distConfig({ startCountdownS: 0, goalM: 100000, raceIdleDnfS: 10, raceStartGraceS: 30 }));
      c.tick({ a: { rpm: 80, zoneId: 'hot' }, b: { rpm: 60, zoneId: 'hot' } }); // a started
      c.tick({ a: { rpm: 0 }, b: { rpm: 60, zoneId: 'hot' } }); // a idle 5s
      expect(c.getState().dnf).not.toContain('a');
      c.tick({ a: { rpm: 0 }, b: { rpm: 60, zoneId: 'hot' } }); // a idle 10s → DNF (started → idle clock)
      expect(c.getState().dnf).toContain('a');
    });
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

  it('boxes a rider pedalling at the green light and reports penalty detail', () => {
    const c = toRacing(distConfig({
      startCountdownS: 0, goalM: 100000, hotStartPenaltyS: 10,
      riders: [{ userId: 'a', wheelCircumferenceM: 2.1 }]
    }));
    c.tick({ a: { rpm: 60, zoneId: 'hot' } }); // hot start → boxed, no distance
    const s = c.getState();
    expect(s.engineState.riders.a.cumulativeDistanceM).toBe(0);
    expect(s.penalized).toContain('a');
    expect(s.penaltyInfo.a.totalS).toBe(10);
    expect(s.penaltyInfo.a.remainingS).toBe(5); // 10s − one 5s tick
    expect(s.penaltyInfo.a.awaitingStop).toBe(false);
  });

  it('keeps a rider boxed past the timer while they keep pedalling (awaiting RPM 0)', () => {
    const c = toRacing(distConfig({
      startCountdownS: 0, goalM: 100000, hotStartPenaltyS: 10,
      riders: [{ userId: 'a', wheelCircumferenceM: 2.1 }]
    }));
    c.tick({ a: { rpm: 60 } }); // remaining 5
    c.tick({ a: { rpm: 60 } }); // remaining 0
    c.tick({ a: { rpm: 60 } }); // time served but STILL pedalling → stay boxed
    const s = c.getState();
    expect(s.engineState.riders.a.cumulativeDistanceM).toBe(0); // no progress
    expect(s.penalized).toContain('a');
    expect(s.penaltyInfo.a.remainingS).toBe(0);
    expect(s.penaltyInfo.a.awaitingStop).toBe(true);
  });

  it('clears the box only after the timer AND a return to RPM 0, then distance accrues', () => {
    const c = toRacing(distConfig({
      startCountdownS: 0, goalM: 100000, hotStartPenaltyS: 10,
      riders: [{ userId: 'a', wheelCircumferenceM: 2.1 }]
    }));
    c.tick({ a: { rpm: 60 } }); // remaining 5
    c.tick({ a: { rpm: 60 } }); // remaining 0
    c.tick({ a: { rpm: 0 } });  // time served + RPM 0 → released (no distance at rest)
    expect(c.getState().penalized).not.toContain('a');
    expect(c.getState().engineState.riders.a.cumulativeDistanceM).toBe(0);
    c.tick({ a: { rpm: 60, zoneId: 'hot' } }); // now pedalling counts
    expect(c.getState().engineState.riders.a.cumulativeDistanceM).toBe(21);
  });

  it('does NOT release a rider who reaches RPM 0 before the timer is served', () => {
    const c = toRacing(distConfig({
      startCountdownS: 0, goalM: 100000, hotStartPenaltyS: 15,
      riders: [{ userId: 'a', wheelCircumferenceM: 2.1 }]
    }));
    c.tick({ a: { rpm: 60 } }); // remaining 10
    c.tick({ a: { rpm: 0 } });  // remaining 5 — owes time, RPM 0 isn't enough yet
    const s = c.getState();
    expect(s.penalized).toContain('a');
    expect(s.penaltyInfo.a.remainingS).toBe(5);
    expect(s.penaltyInfo.a.awaitingStop).toBe(false);
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
      startCountdownS: 0, raceIdleDnfS: 2, raceStartGraceS: 2,
      riders: [
        { userId: 'a', wheelCircumferenceM: 2.1 },
        { userId: 'g', ghostSeries: [2000], ghostIntervalS: 1 }
      ]
    });
    c.startCountdown();
    c.tick({ a: { rpm: 0 } }); // ghost → 2000 (finished); a no-show 1s
    c.tick({ a: { rpm: 0 } }); // a no-show 2s → DNF
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

describe('CycleRaceController — finishNow (forfeit)', () => {
  it('marks unfinished non-ghost riders as DNF and ends the race; finishers + ghosts untouched', () => {
    const c = new CycleRaceController(distConfig({
      startCountdownS: 0, goalM: 21,
      riders: [
        { userId: 'a', wheelCircumferenceM: 2.1 },
        { userId: 'b', wheelCircumferenceM: 2.1 },
        { userId: 'g', ghostSeries: [2000], ghostIntervalS: 1 }
      ]
    }));
    c.startCountdown();
    // One tick: 'a' crosses the 21m line (finishes); 'b' barely moves; ghost replays.
    c.tick({ a: { rpm: 60, zoneId: 'hot' }, b: { rpm: 1 } });
    const s = c.finishNow();
    expect(s.phase).toBe('finished');
    expect(s.dnf).toContain('b');     // unfinished real rider → forfeit
    expect(s.dnf).not.toContain('a'); // already finished → not a forfeit
    expect(s.dnf).not.toContain('g'); // ghost → never forfeits
  });

  it('is a no-op when not racing', () => {
    const c = new CycleRaceController(distConfig({ startCountdownS: 3 }));
    expect(c.finishNow().phase).toBe('staged');
  });
});

describe('CycleRaceController — distance-race mercy-kill (issue 2)', () => {
  // 'a' (wheel 2.1, hot zone, rpm 60) crosses the 21m line on the first 5s tick;
  // 'b' crawls at rpm 1 and never reaches the line.
  const crossFast = (c) => c.tick({ a: { rpm: 60, zoneId: 'hot' }, b: { rpm: 1 } });

  it('ends the race the configured seconds after the first finisher, DNFing stragglers', () => {
    const c = new CycleRaceController(distConfig({ startCountdownS: 0, raceMercyAfterWinnerS: 10 }));
    c.startCountdown();
    crossFast(c); // elapsed 5s: 'a' finishes
    expect(c.getState().engineState.riders.a.finishTimeS).toBe(5);
    expect(c.phase).toBe('racing'); // 'b' still going — race continues
    c.tick({ b: { rpm: 1 } }); // elapsed 10s — only 5s since winner (< 10)
    expect(c.phase).toBe('racing');
    c.tick({ b: { rpm: 1 } }); // elapsed 15s — 10s since winner → mercy fires
    expect(c.phase).toBe('finished');
    expect(c.getState().dnf).toContain('b');
  });

  it('does not mercy-end before the configured grace elapses', () => {
    const c = new CycleRaceController(distConfig({ startCountdownS: 0, raceMercyAfterWinnerS: 30 }));
    c.startCountdown();
    crossFast(c);
    c.tick({ b: { rpm: 1 } });
    c.tick({ b: { rpm: 1 } });
    expect(c.phase).toBe('racing');
  });

  it('is off by default — a distance race waits for all riders when unset', () => {
    const c = new CycleRaceController(distConfig({ startCountdownS: 0 }));
    c.startCountdown();
    crossFast(c);
    for (let i = 0; i < 20; i += 1) c.tick({ b: { rpm: 1 } });
    expect(c.phase).toBe('racing');
  });

  it('does not apply to time races', () => {
    const c = new CycleRaceController(distConfig({
      winCondition: 'time', timeCapS: 9999, startCountdownS: 0, raceMercyAfterWinnerS: 5
    }));
    c.startCountdown();
    crossFast(c);
    c.tick({ b: { rpm: 1 } });
    c.tick({ b: { rpm: 1 } });
    expect(c.phase).toBe('racing');
  });
});
