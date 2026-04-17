import { describe, it, expect, jest, beforeEach } from '@jest/globals';
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));
const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine cycle maintain state', () => {
  let engine, nowValue, active;

  beforeEach(() => {
    nowValue = 30000;
    engine = new GovernanceEngine(null, { now: () => nowValue });
    active = {
      id: 'test_0', type: 'cycle', rider: 'felix', cycleState: 'maintain',
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
      _lastCycleTs: 30000
    };
  });

  it('accrues phaseProgressMs at 1x when rpm at hi and no boost', () => {
    nowValue = 31000;
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 65, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true,
      userZoneMap: { felix: 'warm' }, activeParticipants: ['felix']
    });
    expect(active.phaseProgressMs).toBe(1000);
    expect(active.cycleState).toBe('maintain');
  });

  it('pauses progress in dim band (between lo and hi)', () => {
    nowValue = 31000;
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 50, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true,
      userZoneMap: { felix: 'warm' }, activeParticipants: ['felix']
    });
    expect(active.phaseProgressMs).toBe(0);
    expect(active.cycleState).toBe('maintain');
  });

  it('transitions to locked when rpm below lo', () => {
    nowValue = 31000;
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 40, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true,
      userZoneMap: { felix: 'active' }, activeParticipants: ['felix']
    });
    expect(active.cycleState).toBe('locked');
    expect(active.lockReason).toBe('maintain');
    expect(active.totalLockEventsCount).toBe(1);
  });

  it('accrues at boosted rate when non-rider in hot', () => {
    nowValue = 31000;
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 65, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true,
      userZoneMap: { felix: 'warm', mickey: 'hot' }, activeParticipants: ['felix', 'mickey']
    });
    expect(active.phaseProgressMs).toBe(1500);
    expect(active.totalBoostedMs).toBe(500);
  });

  it('includes rider in boost calculation (self-boost)', () => {
    nowValue = 31000;
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 65, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true,
      userZoneMap: { felix: 'fire' }, activeParticipants: ['felix']
    });
    expect(active.phaseProgressMs).toBe(2000);
  });

  it('caps boost at maxTotalMultiplier', () => {
    nowValue = 31000;
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 65, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true,
      userZoneMap: { felix: 'fire', a: 'fire', b: 'fire', c: 'fire' },
      activeParticipants: ['felix', 'a', 'b', 'c']
    });
    expect(active.phaseProgressMs).toBe(3000); // capped at 3.0x
  });

  it('advances to next phase ramp when maintain fills', () => {
    active.phaseProgressMs = 29500;
    nowValue = 31000;
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 65, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true,
      userZoneMap: { felix: 'warm' }, activeParticipants: ['felix']
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
      userZoneMap: { felix: 'hot' }, activeParticipants: ['felix']
    });
    expect(active.status).toBe('success');
  });
});
