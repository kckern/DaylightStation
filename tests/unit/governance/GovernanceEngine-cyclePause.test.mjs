import { describe, it, expect, jest } from '@jest/globals';
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));
const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine cycle pause/resume on base_req', () => {
  it('does not accrue cycle progress while base_req failing', () => {
    let nowValue = 50000;
    const engine = new GovernanceEngine(null, { now: () => nowValue });
    const active = {
      id: 'test_0', type: 'cycle', cycleState: 'maintain', rider: 'felix',
      currentPhaseIndex: 0, generatedPhases: [{ hiRpm: 60, loRpm: 45, rampSeconds: 10, maintainSeconds: 30 }],
      selection: { init: {}, boost: { zoneMultipliers: {}, maxTotalMultiplier: 3.0 } },
      phaseProgressMs: 5000, rampElapsedMs: 0, initElapsedMs: 0, initTotalMs: 60000,
      totalLockEventsCount: 0, totalBoostedMs: 0, boostContributors: new Set(),
      _lastCycleTs: 50000, status: 'pending'
    };
    // Tick with base_req NOT satisfied globally
    nowValue = 51000;
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 65, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: false,
      userZoneMap: { felix: 'warm' }, activeParticipants: ['felix']
    });
    expect(active.phaseProgressMs).toBe(5000); // frozen
    // Tick with base_req restored
    nowValue = 52000;
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 65, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true,
      userZoneMap: { felix: 'warm' }, activeParticipants: ['felix']
    });
    expect(active.phaseProgressMs).toBe(6000); // resumed — only 1000ms dt since last-real-tick
  });

  it('does not advance init timer during pause', () => {
    let nowValue = 60000;
    const engine = new GovernanceEngine(null, { now: () => nowValue });
    const active = {
      id: 'test_1', type: 'cycle', cycleState: 'init', rider: 'felix',
      currentPhaseIndex: 0, generatedPhases: [{ hiRpm: 60, loRpm: 45, rampSeconds: 10, maintainSeconds: 30 }],
      selection: { init: { minRpm: 30, timeAllowedSeconds: 60 } },
      initElapsedMs: 10000, initTotalMs: 60000,
      phaseProgressMs: 0, rampElapsedMs: 0,
      totalLockEventsCount: 0, totalBoostedMs: 0, boostContributors: new Set(),
      _lastCycleTs: 60000, status: 'pending'
    };
    nowValue = 65000;
    engine._evaluateCycleChallenge(active, { equipmentRpm: 0, baseReqSatisfiedForRider: false, baseReqSatisfiedGlobal: false });
    expect(active.initElapsedMs).toBe(10000); // frozen
    expect(active.cycleState).toBe('init');
  });

  it('does not advance ramp timer during pause', () => {
    let nowValue = 70000;
    const engine = new GovernanceEngine(null, { now: () => nowValue });
    const active = {
      id: 'test_2', type: 'cycle', cycleState: 'ramp', rider: 'felix',
      currentPhaseIndex: 0, generatedPhases: [{ hiRpm: 60, loRpm: 45, rampSeconds: 15, maintainSeconds: 30 }],
      selection: { init: { minRpm: 30, timeAllowedSeconds: 60 } },
      rampElapsedMs: 3000, phaseProgressMs: 0, initElapsedMs: 0, initTotalMs: 60000,
      totalLockEventsCount: 0, totalBoostedMs: 0, boostContributors: new Set(),
      _lastCycleTs: 70000, status: 'pending'
    };
    nowValue = 75000;
    engine._evaluateCycleChallenge(active, { equipmentRpm: 40, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: false });
    expect(active.rampElapsedMs).toBe(3000); // frozen
    expect(active.cycleState).toBe('ramp');
  });
});
