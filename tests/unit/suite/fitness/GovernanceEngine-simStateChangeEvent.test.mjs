import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));
const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine.onCycleStateChange callback', () => {
  let engine;

  beforeEach(() => {
    globalThis.window = {};
    engine = new GovernanceEngine({ roster: [], snapshot: { zoneConfig: [] } });
  });

  it('calls onCycleStateChange when cycleState mutates between calls to _updateGlobalState', () => {
    const cb = jest.fn();
    engine.onCycleStateChange = cb;
    engine.challengeState = {
      activeChallenge: { type: 'cycle', cycleState: 'init', equipment: 'cycle_ace', rider: 'felix' }
    };
    engine._updateGlobalState();
    expect(cb).toHaveBeenCalledTimes(1);

    engine._updateGlobalState();
    expect(cb).toHaveBeenCalledTimes(1);

    engine.challengeState.activeChallenge.cycleState = 'ramp';
    engine._updateGlobalState();
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('does nothing when no callback is registered', () => {
    engine.challengeState = {
      activeChallenge: { type: 'cycle', cycleState: 'init', equipment: 'x', rider: 'a' }
    };
    expect(() => engine._updateGlobalState()).not.toThrow();
  });

  it('fires when challenge transitions from active to null (clear)', () => {
    const cb = jest.fn();
    engine.onCycleStateChange = cb;
    engine.challengeState = {
      activeChallenge: { type: 'cycle', cycleState: 'maintain', equipment: 'x', rider: 'a' }
    };
    engine._updateGlobalState();
    expect(cb).toHaveBeenCalledTimes(1);

    engine.challengeState = null;
    engine._updateGlobalState();
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('fires onCycleStateChange when tickManualCycle runs and cycle signature changes', () => {
    const cb = jest.fn();
    engine.onCycleStateChange = cb;
    engine.media = null; // hits no-media early-return → tickManualCycle path
    engine._latestInputs = {
      activeParticipants: ['kckern'],
      userZoneMap: { kckern: 'hot' },
      equipmentCadenceMap: { cycle_ace: { rpm: 35, connected: true } }
    };
    engine.challengeState = {
      activeChallenge: {
        id: 'cyc_1',
        type: 'cycle',
        cycleState: 'init',
        equipment: 'cycle_ace',
        rider: 'kckern',
        manualTrigger: true,
        currentPhaseIndex: 0,
        totalPhases: 1,
        generatedPhases: [{ hiRpm: 50, loRpm: 38, rampSeconds: 0, maintainSeconds: 20 }],
        phaseProgressMs: 0,
        initElapsedMs: 0,
        initTotalMs: 60000,
        status: 'pending',
        selection: { init: { minRpm: 30 } }
      }
    };
    // First evaluate establishes baseline signature.
    engine.evaluate({});
    const callsAfterFirst = cb.mock.calls.length;

    // Second evaluate with rpm=35 should advance init → ramp, changing the signature.
    engine.evaluate({});
    expect(cb.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });
});
