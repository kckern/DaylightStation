import { describe, it, expect, jest, beforeEach } from '@jest/globals';
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));
const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine cycle init state', () => {
  let engine, nowValue, activeChallenge;

  beforeEach(() => {
    nowValue = 10000;
    engine = new GovernanceEngine(null, { now: () => nowValue });
    activeChallenge = {
      type: 'cycle', rider: 'felix', cycleState: 'init',
      initStartedAt: 10000, initElapsedMs: 0, initTotalMs: 60000,
      currentPhaseIndex: 0, generatedPhases: [
        { hiRpm: 60, loRpm: 45, rampSeconds: 10, maintainSeconds: 30 }
      ],
      selection: {
        init: { minRpm: 30, timeAllowedSeconds: 60 }
      },
      rampElapsedMs: 0, phaseProgressMs: 0,
      totalLockEventsCount: 0, status: 'pending',
      _lastCycleTs: 10000
    };
  });

  it('transitions to ramp when rider hits min_rpm AND base_req satisfied', () => {
    nowValue = 11000;
    const evalCtx = {
      equipmentRpm: 35,
      baseReqSatisfiedForRider: true,
      baseReqSatisfiedGlobal: true
    };
    engine._evaluateCycleChallenge(activeChallenge, evalCtx);
    expect(activeChallenge.cycleState).toBe('ramp');
    expect(activeChallenge.currentPhaseIndex).toBe(0);
    expect(activeChallenge.rampElapsedMs).toBe(0); // fresh ramp
  });

  it('stays in init if rpm below min_rpm', () => {
    nowValue = 11000;
    engine._evaluateCycleChallenge(activeChallenge, {
      equipmentRpm: 20, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true
    });
    expect(activeChallenge.cycleState).toBe('init');
    expect(activeChallenge.initElapsedMs).toBe(1000);
  });

  it('stays in init if base_req not satisfied for rider', () => {
    nowValue = 11000;
    engine._evaluateCycleChallenge(activeChallenge, {
      equipmentRpm: 40, baseReqSatisfiedForRider: false, baseReqSatisfiedGlobal: true
    });
    expect(activeChallenge.cycleState).toBe('init');
  });

  it('transitions to locked when init timer expires', () => {
    nowValue = 10000 + 61000;
    engine._evaluateCycleChallenge(activeChallenge, {
      equipmentRpm: 0, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true
    });
    expect(activeChallenge.cycleState).toBe('locked');
    expect(activeChallenge.lockReason).toBe('init');
    expect(activeChallenge.totalLockEventsCount).toBe(1);
  });

  it('updates _lastCycleTs on each tick', () => {
    nowValue = 15000;
    engine._evaluateCycleChallenge(activeChallenge, {
      equipmentRpm: 0, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true
    });
    expect(activeChallenge._lastCycleTs).toBe(15000);
  });
});
