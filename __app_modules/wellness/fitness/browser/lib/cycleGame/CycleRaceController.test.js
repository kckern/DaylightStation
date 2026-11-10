import { describe, it, expect } from 'vitest';
import { CycleRaceController } from "./CycleRaceController.js";

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

describe('CycleRaceController — racing + parking', () => {
  const toRacing = (cfg) => { const c = new CycleRaceController(cfg); c.startCountdown(); return c; };

  it('accumulates via the engine while racing', () => {
    const c = toRacing(distConfig({ startCountdownS: 0, goalM: 1000 }));
    c.tick({ a: { rpm: 60, zoneId: 'hot' }, b: { rpm: 60, zoneId: 'hot' } });
    expect(c.getState().engineState.riders.a.cumulativeDistanceM).toBe(21);
  });
  it('parks a no-show rider, who stops holding the race open once somebody has finished', () => {
    // b never pedals → no-show; raceStartGraceS governs when it parks (10s here).
    const c = toRacing(distConfig({ startCountdownS: 0, raceStartGraceS: 10 }));
    // a reaches goal (21) tick1; b idle
    c.tick({ a: { rpm: 60, zoneId: 'hot' }, b: { rpm: 0 } }); // b no-show 5s
    expect(c.getState().phase).toBe('racing');
    c.tick({ a: { rpm: 0 }, b: { rpm: 0 } }); // b no-show 10s → parked
    const s = c.getState();
    expect(s.parked).toContain('b');
    expect(s.dnf).toEqual([]);
    expect(s.phase).toBe('finished');
  });
  // Magnetless cadence sensors (e.g. the COOSPO BK467 on the tricycle) can take
  // up to ~20s to lock onto rotation from a dead stop, reporting rpm 0 the whole
  // time even while the rider is pedalling. The start-grace window prevents that
  // lock-on lag from parking a rider who is pedalling.
  describe('start-grace (sensor lock-on)', () => {
    it('does NOT park a rider whose first reading is delayed past raceIdleDnfS but within the grace', () => {
      // raceIdleDnfS 10 (2 ticks) would park without the grace; grace 30 (6 ticks) protects.
      const c = toRacing(distConfig({ startCountdownS: 0, goalM: 100000, raceIdleDnfS: 10, raceStartGraceS: 30 }));
      // a: sensor not locked → rpm 0 for 4 ticks (20s). b pedals normally so it never no-shows.
      for (let i = 0; i < 4; i += 1) c.tick({ a: { rpm: 0 }, b: { rpm: 60, zoneId: 'hot' } });
      expect(c.getState().parked).not.toContain('a'); // 20s idle but never started → grace not yet exceeded
      // a's sensor finally locks on and it pedals — never parked.
      c.tick({ a: { rpm: 80, zoneId: 'hot' }, b: { rpm: 60, zoneId: 'hot' } });
      expect(c.getState().parked).not.toContain('a');
    });

    it('parks a true no-show only after raceStartGraceS, not raceIdleDnfS', () => {
      const c = toRacing(distConfig({ startCountdownS: 0, goalM: 100000, raceIdleDnfS: 10, raceStartGraceS: 30 }));
      for (let i = 0; i < 5; i += 1) c.tick({ a: { rpm: 60, zoneId: 'hot' }, b: { rpm: 0 } }); // b 25s
      expect(c.getState().parked).not.toContain('b'); // 25s < 30s grace
      c.tick({ a: { rpm: 60, zoneId: 'hot' }, b: { rpm: 0 } }); // b 30s → parked
      expect(c.getState().parked).toContain('b');
    });

    it('applies the normal raceIdleDnfS once a rider has registered movement', () => {
      const c = toRacing(distConfig({ startCountdownS: 0, goalM: 100000, raceIdleDnfS: 10, raceStartGraceS: 30 }));
      c.tick({ a: { rpm: 80, zoneId: 'hot' }, b: { rpm: 60, zoneId: 'hot' } }); // a started
      c.tick({ a: { rpm: 0 }, b: { rpm: 60, zoneId: 'hot' } }); // a idle 5s
      expect(c.getState().parked).not.toContain('a');
      c.tick({ a: { rpm: 0 }, b: { rpm: 60, zoneId: 'hot' } }); // a idle 10s → parked (started → idle clock)
      expect(c.getState().parked).toContain('a');
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

describe('CycleRaceController — ghost rider', () => {
  it('never parks a ghost, and a finished ghost neither ends the race nor holds it open', () => {
    const c = new CycleRaceController({
      winCondition: 'distance', goalM: 1000, intervalMs: 1000, zones: HOT, hrlessMultiplier: 1,
      startCountdownS: 0, raceIdleDnfS: 2, raceStartGraceS: 2, allParkedEndS: 2,
      riders: [
        { userId: 'a', wheelCircumferenceM: 2.1 },
        { userId: 'g', ghostSeries: [2000], ghostIntervalS: 1 }
      ]
    });
    c.startCountdown();
    c.tick({ a: { rpm: 0 } }); // ghost → 2000 (finished); a no-show 1s
    c.tick({ a: { rpm: 0 } }); // a no-show 2s → parked; all-parked clock 1s
    let s = c.getState();
    expect(s.parked).toEqual(['a']); // the ghost is never parked
    expect(s.overtime).not.toContain('g'); // ghost exempt from overtime too
    // The ghost crossing the line is not "somebody finished": the only live
    // rider is parked, and the race waits out allParkedEndS before closing.
    expect(s.phase).toBe('racing');
    s = c.tick({ a: { rpm: 0 } }); // all-parked clock 2s = allParkedEndS
    expect(s.phase).toBe('finished');
    expect(s.overtime).not.toContain('g');
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
  it('marks unfinished non-ghost riders as OVERTIME and ends the race; finishers + ghosts untouched', () => {
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
    expect(s.overtime).toContain('b');     // unfinished real rider → overtime (real distance kept)
    expect(s.parked).not.toContain('b');   // cut off while riding, not parked
    expect(s.overtime).not.toContain('a'); // already finished → not overtime
    expect(s.overtime).not.toContain('g'); // ghost → never forfeits
    expect(s.parked).not.toContain('g');
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

  it('ends the race the configured seconds after the first finisher, putting stragglers in OVERTIME', () => {
    const c = new CycleRaceController(distConfig({ startCountdownS: 0, raceMercyAfterWinnerS: 10 }));
    c.startCountdown();
    crossFast(c); // elapsed 5s: 'a' finishes
    expect(c.getState().engineState.riders.a.finishTimeS).toBe(5);
    expect(c.phase).toBe('racing'); // 'b' still going — race continues
    c.tick({ b: { rpm: 1 } }); // elapsed 10s — only 5s since winner (< 10)
    expect(c.phase).toBe('racing');
    c.tick({ b: { rpm: 1 } }); // elapsed 15s — 10s since winner → mercy fires
    expect(c.phase).toBe('finished');
    expect(c.getState().overtime).toContain('b'); // cut off by the clock, not a quit
    expect(c.getState().parked).not.toContain('b'); // still pedalling, never parked
    expect(c.getState().endedEarly).toBe(false);    // the clock closed it, not the operator
  });

  it('puts a parked rider in overtime too when the mercy window closes', () => {
    // 'a' finishes fast; 'b' never pedals (parked via the start-grace clock);
    // 'c' crawls the whole way and is still riding at the mercy cut.
    const c = new CycleRaceController(distConfig({
      startCountdownS: 0, raceMercyAfterWinnerS: 10, raceIdleDnfS: 5, raceStartGraceS: 5,
      riders: [
        { userId: 'a', wheelCircumferenceM: 2.1 },
        { userId: 'b', wheelCircumferenceM: 2.1 },
        { userId: 'c', wheelCircumferenceM: 2.1 }
      ]
    }));
    c.startCountdown();
    c.tick({ a: { rpm: 60, zoneId: 'hot' }, b: { rpm: 0 }, c: { rpm: 1 } }); // elapsed 5s: a finishes; b no-show 5s → parked
    expect(c.getState().parked).toContain('b');
    expect(c.phase).toBe('racing'); // 'c' still going — a parked 'b' does not end it
    c.tick({ b: { rpm: 0 }, c: { rpm: 1 } }); // elapsed 10s — only 5s since winner (< 10)
    expect(c.phase).toBe('racing');
    c.tick({ b: { rpm: 0 }, c: { rpm: 1 } }); // elapsed 15s — 10s since winner → mercy fires
    expect(c.phase).toBe('finished');
    const s = c.getState();
    expect(s.parked).toContain('b');
    expect(s.overtime).toContain('b'); // parked and unfinished when the window closed
    expect(s.overtime).toContain('c'); // cut off by the clock while riding
    expect(s.parked).not.toContain('c');
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

describe('CycleRaceController — a dead sensor is not a lazy child', () => {
  /**
   * The garage screen once told a child "Did Not Finish — Stopped pedaling for 30s"
   * while he was pedalling. His cadence sensor had sent nothing for four
   * minutes. Verified in production: niceday's ANT+ sensor emitted no packets
   * across three races that all forfeited him (under the old elimination rule)
   * at the threshold with rpm 0,
   * then woke, and his very next race registered 73 rpm.
   *
   * The controller cannot tell the difference from rpm alone — a still bike and
   * a silent sensor both read 0 — so the rider's sensor connectivity has to
   * reach it. A rider who never had a connected reading has not idled out.
   */
  const cfg = (over = {}) => ({
    winCondition: 'distance', goalM: 10000, intervalMs: 1000, zones: HOT, hrlessMultiplier: 1,
    startCountdownS: 0, raceIdleDnfS: 10, raceStartGraceS: 5,
    riders: [{ userId: 'a', wheelCircumferenceM: 2.1 }, { userId: 'b', wheelCircumferenceM: 2.1 }],
    ...over,
  });
  const race = (over) => { const c = new CycleRaceController(cfg(over)); c.startCountdown(); return c; };
  const tickFor = (c, seconds, inputs) => {
    let state;
    for (let i = 0; i < seconds; i += 1) state = c.tick(inputs);
    return state;
  };

  it('files a rider whose sensor never connected as no-sensor, never as parked', () => {
    const c = race();
    const state = tickFor(c, 8, {
      a: { rpm: 0, connected: false },
      b: { rpm: 40, connected: true },
    });
    expect(state.noSensor).toContain('a');
    expect(state.parked).not.toContain('a');
  });

  it('still files a rider whose sensor WORKS and who simply did not pedal as parked', () => {
    // The sensor is reporting. A real zero is a real zero.
    const c = race();
    const state = tickFor(c, 8, {
      a: { rpm: 0, connected: true },
      b: { rpm: 40, connected: true },
    });
    expect(state.parked).toContain('a');
    expect(state.noSensor).not.toContain('a');
  });

  it('files a rider who rode and then stopped as parked, not as no-sensor', () => {
    const c = race();
    tickFor(c, 3, { a: { rpm: 50, connected: true }, b: { rpm: 40, connected: true } });
    const state = tickFor(c, 12, { a: { rpm: 0, connected: false }, b: { rpm: 40, connected: true } });
    // Their sensor dropped mid-race, but they HAD one: they rode, so the idle
    // clock is the honest reading of what happened.
    expect(state.parked).toContain('a');
    expect(state.noSensor).not.toContain('a');
  });

  it('treats a missing connected flag as connected, so existing callers are unchanged', () => {
    const c = race();
    const state = tickFor(c, 8, { a: { rpm: 0 }, b: { rpm: 40 } });
    expect(state.parked).toContain('a');
    expect(state.noSensor).toEqual([]);
  });

  it('lets the race finish even when a rider never had a sensor', () => {
    // A no-sensor rider must still be accounted for, or the race waits forever.
    const c = race({ goalM: 4 });
    const state = tickFor(c, 20, { a: { rpm: 0, connected: false }, b: { rpm: 200, connected: true } });
    expect(state.phase).toBe('finished');
  });
});

describe('CycleRaceController — park and resume', () => {
  const cfg = (over = {}) => ({
    winCondition: 'distance', goalM: 1000, intervalMs: 1000, zones: [], hrlessMultiplier: 1,
    startCountdownS: 0, parkIdleS: 3, raceStartGraceS: 5, allParkedEndS: 4,
    riders: [{ userId: 'a', wheelCircumferenceM: 2 }, { userId: 'b', wheelCircumferenceM: 2 }],
    ...over
  });
  const racing = (c) => { const k = new CycleRaceController(c); k.startCountdown(); return k; };
  const ride = (k, n, inputs) => { let s; for (let i = 0; i < n; i++) s = k.tick(inputs); return s; };

  it('parks a rider after parkIdleS idle and never reports dnf', () => {
    const k = racing(cfg());
    ride(k, 1, { a: { rpm: 60 }, b: { rpm: 60 } });
    const s = ride(k, 3, { a: { rpm: 60 }, b: { rpm: 0 } });
    expect(s.parked).toEqual(['b']);
    expect(s.dnf).toEqual([]);
    expect(s.phase).toBe('racing');
  });

  it('un-parks on the first pedal stroke and distance counts again', () => {
    const k = racing(cfg());
    ride(k, 1, { a: { rpm: 60 }, b: { rpm: 60 } });
    ride(k, 3, { a: { rpm: 60 }, b: { rpm: 0 } });
    const before = k.getState().engineState.riders.b.cumulativeDistanceM;
    const s = ride(k, 1, { a: { rpm: 60 }, b: { rpm: 60 } });
    expect(s.parked).toEqual([]);
    expect(s.engineState.riders.b.cumulativeDistanceM).toBeGreaterThan(before);
  });

  it('uses the longer start grace before a rider has moved', () => {
    const k = racing(cfg());
    expect(ride(k, 4, { a: { rpm: 60 }, b: { rpm: 0 } }).parked).toEqual([]);
    expect(ride(k, 1, { a: { rpm: 60 }, b: { rpm: 0 } }).parked).toEqual(['b']);
  });

  it('a no-sensor rider recovers when their sensor starts reporting movement', () => {
    const k = racing(cfg());
    expect(ride(k, 5, { a: { rpm: 60 }, b: { rpm: 0, connected: false } }).noSensor).toEqual(['b']);
    expect(ride(k, 1, { a: { rpm: 60 }, b: { rpm: 50, connected: true } }).noSensor).toEqual([]);
  });

  it('distance race ends when the only un-parked rider finishes', () => {
    const k = racing(cfg({ goalM: 10 }));
    ride(k, 1, { a: { rpm: 60 }, b: { rpm: 60 } }); // 2 m each
    ride(k, 3, { a: { rpm: 60 }, b: { rpm: 0 } });  // b parked, a at 8 m
    const s = ride(k, 1, { a: { rpm: 60 }, b: { rpm: 0 } }); // a at 10 m
    expect(s.phase).toBe('finished');
    expect(s.engineState.riders.b.cumulativeDistanceM).toBe(2);
  });

  it('does not end a distance race just because everyone parked, until allParkedEndS', () => {
    const k = racing(cfg());
    ride(k, 1, { a: { rpm: 60 }, b: { rpm: 60 } });
    expect(ride(k, 3, { a: { rpm: 0 }, b: { rpm: 0 } }).phase).toBe('racing'); // both parked on the 3rd tick: all-parked clock = 1 s
    expect(ride(k, 2, { a: { rpm: 0 }, b: { rpm: 0 } }).phase).toBe('racing'); // 3 s
    expect(ride(k, 1, { a: { rpm: 0 }, b: { rpm: 0 } }).phase).toBe('finished'); // 4 s = allParkedEndS
  });

  it('a resume resets the all-parked clock', () => {
    const k = racing(cfg());
    ride(k, 1, { a: { rpm: 60 }, b: { rpm: 60 } });
    ride(k, 5, { a: { rpm: 0 }, b: { rpm: 0 } });
    ride(k, 1, { a: { rpm: 60 }, b: { rpm: 0 } });
    expect(ride(k, 3, { a: { rpm: 0 }, b: { rpm: 0 } }).phase).toBe('racing');
  });

  it('time race ends early when every live rider has been parked for allParkedEndS', () => {
    const k = racing(cfg({ winCondition: 'time', timeCapS: 300, goalM: undefined, riders: [{ userId: 'a', wheelCircumferenceM: 2 }] }));
    ride(k, 1, { a: { rpm: 60 } });
    const s = ride(k, 3 + 4, { a: { rpm: 0 } });
    expect(s.phase).toBe('finished');
    expect(s.engineState.elapsedS).toBeLessThan(300);
  });

  it('finishNow marks the race ended early', () => {
    const k = racing(cfg());
    ride(k, 1, { a: { rpm: 60 }, b: { rpm: 60 } });
    expect(k.finishNow().endedEarly).toBe(true);
  });

  it('allParkedEndS 0 closes the race the moment everyone is parked, not at the first tick', () => {
    const k = racing(cfg({ allParkedEndS: 0 }));
    expect(ride(k, 3, { a: { rpm: 60 }, b: { rpm: 60 } }).phase).toBe('racing');
    expect(ride(k, 2, { a: { rpm: 0 }, b: { rpm: 0 } }).phase).toBe('racing');
    expect(ride(k, 1, { a: { rpm: 0 }, b: { rpm: 0 } }).phase).toBe('finished');
  });

  it('has no penalty box: pedalling at the first tick counts', () => {
    const k = racing(cfg({ hotStartPenaltyS: 5 }));
    const s = ride(k, 1, { a: { rpm: 60 }, b: { rpm: 60 } });
    expect(s.penalized).toEqual([]);
    expect(s.engineState.riders.a.cumulativeDistanceM).toBeGreaterThan(0);
  });
});
