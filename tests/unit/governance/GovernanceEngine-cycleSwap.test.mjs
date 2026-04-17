import { describe, it, expect, jest, beforeEach } from '@jest/globals';
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));
const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine.swapCycleRider', () => {
  let engine, nowValue;
  beforeEach(() => {
    nowValue = 10000;
    const session = {
      _deviceRouter: {
        getEquipmentCatalog: () => [{ id: 'cycle_ace', eligible_users: ['felix', 'milo', 'kckern'] }]
      }
    };
    engine = new GovernanceEngine(session, { now: () => nowValue });
    // Set up a fake active cycle challenge in init state
    engine.challengeState.activeChallenge = {
      id: 'cyc_1', type: 'cycle', cycleState: 'init', rider: 'felix',
      ridersUsed: ['felix'], equipment: 'cycle_ace', currentPhaseIndex: 0,
      initStartedAt: 10000, initElapsedMs: 3000, initTotalMs: 60000,
      rampElapsedMs: 0, phaseProgressMs: 0,
      generatedPhases: [{ hiRpm: 60, loRpm: 45, rampSeconds: 10, maintainSeconds: 30 }],
      selection: { init: { minRpm: 30, timeAllowedSeconds: 60 } }
    };
  });

  it('swap during init succeeds — rider changes, init timer resets', () => {
    const result = engine.swapCycleRider('milo');
    expect(result.success).toBe(true);
    const active = engine.challengeState.activeChallenge;
    expect(active.rider).toBe('milo');
    expect(active.ridersUsed).toEqual(['felix', 'milo']);
    expect(active.initElapsedMs).toBe(0);
    expect(active.cycleState).toBe('init');
  });

  it('swap during phase-1 ramp succeeds — reverts to init for new rider', () => {
    engine.challengeState.activeChallenge.cycleState = 'ramp';
    engine.challengeState.activeChallenge.rampElapsedMs = 5000;
    engine.challengeState.activeChallenge.currentPhaseIndex = 0;
    const result = engine.swapCycleRider('milo');
    expect(result.success).toBe(true);
    const active = engine.challengeState.activeChallenge;
    expect(active.cycleState).toBe('init');
    expect(active.rampElapsedMs).toBe(0);
    expect(active.phaseProgressMs).toBe(0);
  });

  it('swap during maintain rejected', () => {
    engine.challengeState.activeChallenge.cycleState = 'maintain';
    const result = engine.swapCycleRider('milo');
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/window/i);
  });

  it('swap during phase-2 ramp rejected', () => {
    engine.challengeState.activeChallenge.cycleState = 'ramp';
    engine.challengeState.activeChallenge.currentPhaseIndex = 1;
    const result = engine.swapCycleRider('milo');
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/window/i);
  });

  it('swap during locked rejected', () => {
    engine.challengeState.activeChallenge.cycleState = 'locked';
    const result = engine.swapCycleRider('milo');
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/window/i);
  });

  it('swap to non-eligible user rejected', () => {
    const result = engine.swapCycleRider('eve');
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/eligible/i);
  });

  it('swap to cooldown user rejected unless force:true', () => {
    engine._cycleCooldowns = { milo: nowValue + 10000 };
    expect(engine.swapCycleRider('milo').success).toBe(false);
    expect(engine.swapCycleRider('milo').reason).toMatch(/cooldown/i);
    expect(engine.swapCycleRider('milo', { force: true }).success).toBe(true);
  });

  it('rejects when no active cycle challenge', () => {
    engine.challengeState.activeChallenge = null;
    const result = engine.swapCycleRider('milo');
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/no active/i);
  });

  it('rejects when active challenge is not cycle type', () => {
    engine.challengeState.activeChallenge = { type: 'zone' };
    const result = engine.swapCycleRider('milo');
    expect(result.success).toBe(false);
  });
});
