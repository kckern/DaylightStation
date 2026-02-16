import { describe, it, expect, jest } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  }),
  getLogger: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  })
}));

const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine — idle state optimization', () => {
  it('should skip all reset work when _resetToIdle called repeatedly from idle state', () => {
    const mockSession = {
      roster: [],
      zoneProfileStore: null,
      snapshot: { zoneConfig: [] }
    };
    const engine = new GovernanceEngine(mockSession);

    // First reset from non-null phase should do real work
    engine.phase = 'pending';
    engine._resetToIdle();
    expect(engine.phase).toBeNull();

    // Spy on _clearTimers to detect whether the reset body executes
    const clearTimersSpy = jest.spyOn(engine, '_clearTimers');

    // Subsequent resets when already idle should early-return (no work at all)
    engine._resetToIdle();
    engine._resetToIdle();
    engine._resetToIdle();

    expect(clearTimersSpy).not.toHaveBeenCalled();

    clearTimersSpy.mockRestore();
  });

  it('should NOT fire onStateChange when _resetToIdle called repeatedly from null phase', async () => {
    const mockSession = {
      roster: [],
      zoneProfileStore: null,
      snapshot: { zoneConfig: [] }
    };
    const engine = new GovernanceEngine(mockSession);

    let stateChangeCalls = 0;
    engine.setCallbacks({
      onStateChange: () => { stateChangeCalls++; }
    });

    // First reset from non-null phase should fire
    engine.phase = 'pending';
    engine._resetToIdle();
    await new Promise(resolve => queueMicrotask(resolve));
    const firstCallCount = stateChangeCalls;
    expect(firstCallCount).toBeGreaterThan(0);

    // Subsequent resets when already at null should NOT fire onStateChange
    engine._resetToIdle();
    engine._resetToIdle();
    engine._resetToIdle();
    await new Promise(resolve => queueMicrotask(resolve));

    expect(stateChangeCalls).toBe(firstCallCount);
  });

  it('should still reset when phase is null but satisfiedOnce is true', () => {
    const mockSession = {
      roster: [],
      zoneProfileStore: null,
      snapshot: { zoneConfig: [] }
    };
    const engine = new GovernanceEngine(mockSession);
    engine.phase = null;
    engine.meta.satisfiedOnce = true;

    engine._resetToIdle();
    expect(engine.meta.satisfiedOnce).toBe(false);
  });

  it('should still reset when phase is null but activeChallenge exists', () => {
    const mockSession = {
      roster: [],
      zoneProfileStore: null,
      snapshot: { zoneConfig: [] }
    };
    const engine = new GovernanceEngine(mockSession);
    engine.phase = null;
    engine.challengeState.activeChallenge = { id: 'test' };

    engine._resetToIdle();
    expect(engine.challengeState.activeChallenge).toBeNull();
  });
});
