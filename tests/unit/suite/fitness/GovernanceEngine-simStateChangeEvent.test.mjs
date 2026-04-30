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
});
