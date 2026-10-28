import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() }),
  getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() })
}));
const { GovernanceEngine } = await import("../../../__app_modules/wellness/fitness/browser/hooks/fitness/GovernanceEngine.js");

describe('GovernanceEngine cycle maintain state', () => {
  let engine, nowValue, active;

  beforeEach(() => {
    nowValue = 30000;
    engine = new GovernanceEngine(null, { now: () => nowValue });
    active = {
      id: 'test_0', type: 'cycle', rider: 'user_2', cycleState: 'maintain',
      currentPhaseIndex: 0, generatedPhases: [
        { hiRpm: 60, loRpm: 45, rampSeconds: 15, maintainSeconds: 30 },
        { hiRpm: 70, loRpm: 55, rampSeconds: 20, maintainSeconds: 45 }
      ],
      selection: {
        init: { minRpm: 30, timeAllowedSeconds: 60 },
        boost: { zoneMultipliers: { hot: 0.5, fire: 1.0 }, maxTotalMultiplier: 3.0 }
      },
      phaseProgressMs: 0, rampElapsedMs: 0, initElapsedMs: 0, initTotalMs: 60000,
      totalLockEventsCount: 0, totalBoostedMs: 0,
      boostContributors: new Set(), status: 'pending',
      // _startCycleChallenge seeds a full health pool (3000ms).
      cycleHealthMs: 3000,
      _lastCycleTs: 30000
    };
  });

  it('accrues phaseProgressMs at 1x when rpm at hi and no boost', () => {
    nowValue = 31000;
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 65, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true,
      userZoneMap: { user_2: 'warm' }, activeParticipants: ['user_2']
    });
    expect(active.phaseProgressMs).toBe(1000);
    expect(active.cycleState).toBe('maintain');
  });

  it('pauses progress in dim band (between lo and hi)', () => {
    nowValue = 31000;
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 50, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true,
      userZoneMap: { user_2: 'warm' }, activeParticipants: ['user_2']
    });
    expect(active.phaseProgressMs).toBe(0);
    expect(active.cycleState).toBe('maintain');
  });

  // 81d2462f63 (2026-05-28) replaced the 3-second danger grace with a health
  // pool: it depletes 1ms/ms below loRpm, regenerates 1.5ms/ms at >= hiRpm,
  // holds in the amber band, and locks (lockReason 'health') when it empties.
  it('depletes health and stays in maintain on the first below-lo tick', () => {
    nowValue = 31000;
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 40, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true,
      userZoneMap: { user_2: 'active' }, activeParticipants: ['user_2']
    });
    expect(active.cycleState).toBe('maintain');
    expect(active.lockReason).toBeFalsy();
    expect(active.totalLockEventsCount).toBe(0);
    expect(active.cycleHealthMs).toBeGreaterThan(0);
    expect(active.cycleHealthMs).toBeLessThan(3000);
    expect(active.phaseProgressMs).toBe(0);
  });

  it('transitions to locked after sustained below-lo empties the health pool', () => {
    // Sustain rpm < lo across multiple ticks for >3 s. Drive the engine clock
    // forward between ticks so the pool drains.
    let lockObserved = false;
    for (let i = 0; i < 20; i += 1) {
      nowValue += 200; // 20 ticks × 200 ms = 4 s total
      engine._evaluateCycleChallenge(active, {
        equipmentRpm: 40, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true,
        userZoneMap: { user_2: 'active' }, activeParticipants: ['user_2']
      });
      if (active.cycleState === 'locked') { lockObserved = true; break; }
    }
    expect(lockObserved).toBe(true);
    expect(active.cycleState).toBe('locked');
    expect(active.lockReason).toBe('health');
    expect(active.cycleHealthMs).toBe(0);
    expect(active.totalLockEventsCount).toBe(1);
  });

  it('regenerates health when rpm recovers above hi before the pool empties', () => {
    // First tick below lo drains part of the pool.
    nowValue = 31000;
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 40, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true,
      userZoneMap: { user_2: 'warm' }, activeParticipants: ['user_2']
    });
    const drained = active.cycleHealthMs;
    expect(drained).toBeLessThan(3000);

    // 1 s later, rider recovers above hiRpm. Health must regenerate, no lock.
    nowValue = 32000;
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 65, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true,
      userZoneMap: { user_2: 'warm' }, activeParticipants: ['user_2']
    });
    expect(active.cycleHealthMs).toBeGreaterThan(drained);
    expect(active.cycleState).toBe('maintain');
    expect(active.totalLockEventsCount).toBe(0);
  });

  it('accrues at boosted rate when non-rider in hot', () => {
    nowValue = 31000;
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 65, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true,
      userZoneMap: { user_2: 'warm', mickey: 'hot' }, activeParticipants: ['user_2', 'mickey']
    });
    expect(active.phaseProgressMs).toBe(1500);
    expect(active.totalBoostedMs).toBe(500);
  });

  it('includes rider in boost calculation (self-boost)', () => {
    nowValue = 31000;
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 65, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true,
      userZoneMap: { user_2: 'fire' }, activeParticipants: ['user_2']
    });
    expect(active.phaseProgressMs).toBe(2000);
  });

  it('caps boost at maxTotalMultiplier', () => {
    nowValue = 31000;
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 65, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true,
      userZoneMap: { user_2: 'fire', a: 'fire', b: 'fire', c: 'fire' },
      activeParticipants: ['user_2', 'a', 'b', 'c']
    });
    expect(active.phaseProgressMs).toBe(3000); // capped at 3.0x
  });

  it('advances to next phase ramp when maintain fills', () => {
    active.phaseProgressMs = 29500;
    nowValue = 31000;
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 65, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true,
      userZoneMap: { user_2: 'warm' }, activeParticipants: ['user_2']
    });
    expect(active.currentPhaseIndex).toBe(1);
    expect(active.cycleState).toBe('ramp');
    expect(active.rampElapsedMs).toBe(0);
  });

  it('final phase complete → status=success', () => {
    active.currentPhaseIndex = 1;
    active.phaseProgressMs = 44500;
    nowValue = 31000;
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 75, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true,
      userZoneMap: { user_2: 'hot' }, activeParticipants: ['user_2']
    });
    expect(active.status).toBe('success');
  });
});
