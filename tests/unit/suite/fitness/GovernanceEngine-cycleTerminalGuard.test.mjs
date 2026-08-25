import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));

const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine._evaluateCycleChallenge — terminal-status guard', () => {
  let engine;
  let active;
  const ctx = {
    equipmentRpm: 100,
    activeParticipants: ['user_1'],
    userZoneMap: { user_1: 'hot' },
    baseReqSatisfiedForRider: true,
    baseReqSatisfiedGlobal: true
  };

  beforeEach(() => {
    globalThis.window = {};
    engine = new GovernanceEngine({ roster: [], snapshot: { zoneConfig: [] } });
    active = {
      type: 'cycle',
      cycleState: 'maintain',
      currentPhaseIndex: 0,
      generatedPhases: [{ hiRpm: 50, loRpm: 38, rampSeconds: 10, maintainSeconds: 20 }],
      phaseProgressMs: 50000,
      totalPhases: 1,
      rider: 'user_1',
      manualTrigger: true,
      selection: { init: { minRpm: 30 } },
      _lastCycleTs: Date.now() - 1000
    };
  });

  it('does not re-emit transitions when status === success', () => {
    active.status = 'success';
    engine._evaluateCycleChallenge(active, ctx);
    expect(active).toEqual(expect.objectContaining({
      status: 'success', cycleState: 'maintain', phaseProgressMs: 50000,
      baseReqSatisfiedForRider: true
    }));
  });

  it('does not re-emit transitions when status === failed', () => {
    active.status = 'failed';
    engine._evaluateCycleChallenge(active, ctx);
    expect(active).toEqual(expect.objectContaining({
      status: 'failed', cycleState: 'maintain', phaseProgressMs: 50000,
      baseReqSatisfiedForRider: true
    }));
  });

  it('still evaluates pending challenges normally', () => {
    active.status = 'pending';
    engine._evaluateCycleChallenge(active, ctx);
    expect(active.status).toBe('success');
  });
});
