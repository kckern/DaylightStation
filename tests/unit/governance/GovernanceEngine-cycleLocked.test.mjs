import { describe, it, expect, jest, beforeEach } from '@jest/globals';
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));
const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine cycle locked recovery', () => {
  let engine, active, nowValue;

  beforeEach(() => {
    nowValue = 40000;
    engine = new GovernanceEngine(null, { now: () => nowValue });
    active = {
      id: 'test_0', type: 'cycle', rider: 'felix', cycleState: 'locked', lockReason: 'maintain',
      currentPhaseIndex: 0, generatedPhases: [{ hiRpm: 60, loRpm: 45, rampSeconds: 15, maintainSeconds: 30 }],
      selection: { init: { minRpm: 30, timeAllowedSeconds: 60 } },
      phaseProgressMs: 12000, rampElapsedMs: 0, initElapsedMs: 0, initTotalMs: 60000,
      totalLockEventsCount: 1, totalBoostedMs: 0, boostContributors: new Set(),
      _lastCycleTs: 40000, status: 'pending'
    };
  });

  it('maintain-lock → maintain when rpm ≥ hi, preserves phaseProgress', () => {
    engine._evaluateCycleChallenge(active, { equipmentRpm: 65, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true });
    expect(active.cycleState).toBe('maintain');
    expect(active.phaseProgressMs).toBe(12000); // preserved
    expect(active.lockReason).toBeNull();
  });

  it('ramp-lock → maintain when rpm ≥ hi (skips ramp since achieved)', () => {
    active.lockReason = 'ramp';
    engine._evaluateCycleChallenge(active, { equipmentRpm: 70, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true });
    expect(active.cycleState).toBe('maintain');
    expect(active.phaseProgressMs).toBe(0);
    expect(active.lockReason).toBeNull();
  });

  it('init-lock → init when rpm ≥ init.minRpm', () => {
    active.lockReason = 'init';
    active.initElapsedMs = 60000;
    engine._evaluateCycleChallenge(active, { equipmentRpm: 35, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true });
    expect(active.cycleState).toBe('init');
    expect(active.initElapsedMs).toBe(0); // reset
    expect(active.lockReason).toBeNull();
  });

  it('stays locked when rpm below recovery threshold', () => {
    engine._evaluateCycleChallenge(active, { equipmentRpm: 40, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true });
    expect(active.cycleState).toBe('locked');
  });
});
