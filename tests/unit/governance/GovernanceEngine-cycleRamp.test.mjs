import { describe, it, expect, jest, beforeEach } from '@jest/globals';
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));
const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine cycle ramp state', () => {
  let engine, nowValue, active;

  beforeEach(() => {
    nowValue = 20000;
    engine = new GovernanceEngine(null, { now: () => nowValue });
    active = {
      id: 'test_0', type: 'cycle', rider: 'felix', cycleState: 'ramp',
      currentPhaseIndex: 0, generatedPhases: [
        { hiRpm: 60, loRpm: 45, rampSeconds: 15, maintainSeconds: 30 }
      ],
      selection: { init: { minRpm: 30, timeAllowedSeconds: 60 } },
      rampElapsedMs: 0, phaseProgressMs: 0,
      initElapsedMs: 0, initTotalMs: 60000,
      totalLockEventsCount: 0, status: 'pending',
      _lastCycleTs: 20000
    };
  });

  it('transitions to maintain when rpm hits hi', () => {
    nowValue = 22000;
    engine._evaluateCycleChallenge(active, { equipmentRpm: 60, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true });
    expect(active.cycleState).toBe('maintain');
    expect(active.phaseProgressMs).toBe(0); // fresh
  });

  it('stays in ramp when rpm below hi', () => {
    nowValue = 22000;
    engine._evaluateCycleChallenge(active, { equipmentRpm: 50, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true });
    expect(active.cycleState).toBe('ramp');
    expect(active.rampElapsedMs).toBe(2000);
  });

  it('transitions to locked (ramp) when ramp timer expires', () => {
    nowValue = 20000 + 16000;
    engine._evaluateCycleChallenge(active, { equipmentRpm: 40, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true });
    expect(active.cycleState).toBe('locked');
    expect(active.lockReason).toBe('ramp');
    expect(active.totalLockEventsCount).toBe(1);
  });

  it('ramp works for non-first phase', () => {
    active.currentPhaseIndex = 1;
    active.generatedPhases.push({ hiRpm: 75, loRpm: 55, rampSeconds: 20, maintainSeconds: 45 });
    nowValue = 22000;
    engine._evaluateCycleChallenge(active, { equipmentRpm: 75, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true });
    expect(active.cycleState).toBe('maintain');
  });
});
