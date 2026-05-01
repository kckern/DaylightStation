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
    activeParticipants: ['kckern'],
    userZoneMap: { kckern: 'hot' },
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
      rider: 'kckern',
      manualTrigger: true,
      selection: { init: { minRpm: 30 } },
      _lastCycleTs: Date.now() - 1000
    };
  });

  it('does not re-emit transitions when status === success', () => {
    active.status = 'success';
    const snapshot = JSON.stringify(active);
    engine._evaluateCycleChallenge(active, ctx);
    expect(JSON.stringify(active)).toBe(snapshot);
  });

  it('does not re-emit transitions when status === failed', () => {
    active.status = 'failed';
    const snapshot = JSON.stringify(active);
    engine._evaluateCycleChallenge(active, ctx);
    expect(JSON.stringify(active)).toBe(snapshot);
  });

  it('still evaluates pending challenges normally', () => {
    active.status = 'pending';
    engine._evaluateCycleChallenge(active, ctx);
    expect(active.status).toBe('success');
  });
});
