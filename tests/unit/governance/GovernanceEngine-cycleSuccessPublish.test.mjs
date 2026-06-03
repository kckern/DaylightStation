import { describe, it, expect, jest } from '@jest/globals';
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));
const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('cycle success stays published for a hold window before clearing', () => {
  it('holds activeChallenge in success until the publish window elapses, then clears + queues next', () => {
    let now = 100000;
    const engine = new GovernanceEngine(null, { now: () => now });
    const queued = [];
    const queueNextChallenge = (d) => queued.push(d);
    const challengeConfig = { intervalRangeSeconds: [30, 60] };
    const challenge = { id: 'c1', type: 'cycle', status: 'success', historyRecorded: true };
    engine.challengeState.activeChallenge = challenge;

    expect(engine._maybeClearCycleSuccess(challenge, challengeConfig, queueNextChallenge)).toBe(false);
    expect(engine.challengeState.activeChallenge).toBe(challenge);
    expect(challenge.status).toBe('success');
    expect(challenge.successPublishedAt).toBe(100000);

    now += 300; // within window
    expect(engine._maybeClearCycleSuccess(challenge, challengeConfig, queueNextChallenge)).toBe(false);
    expect(engine.challengeState.activeChallenge).toBe(challenge);

    now += 400; // 700ms total >= 600
    expect(engine._maybeClearCycleSuccess(challenge, challengeConfig, queueNextChallenge)).toBe(true);
    expect(engine.challengeState.activeChallenge).toBeNull();
    expect(queued.length).toBe(1);
  });

  it('_evaluateCycleChallenge does not re-process a terminal (success) challenge', () => {
    const engine = new GovernanceEngine(null, { now: () => 5000 });
    const active = {
      type: 'cycle', status: 'success', cycleState: 'maintain',
      currentPhaseIndex: 1, phaseProgressMs: 999, _lastCycleTs: 5000,
      generatedPhases: [{ hiRpm: 60, loRpm: 45, rampSeconds: 5, maintainSeconds: 10 }]
    };
    engine._evaluateCycleChallenge(active, { equipmentRpm: 80, baseReqSatisfiedForRider: true });
    expect(active.cycleState).toBe('maintain');
    expect(active.status).toBe('success');
  });
});
