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

function createEngine() {
  const zoneConfig = [
    { id: 'cool', name: 'Cool', color: '#3399ff' },
    { id: 'active', name: 'Active', color: '#00cc00' },
    { id: 'warm', name: 'Warm', color: '#ffaa00' },
    { id: 'hot', name: 'Hot', color: '#ff0000' },
  ];
  const mockSession = {
    roster: [],
    zoneProfileStore: null,
    snapshot: { zoneConfig }
  };
  const engine = new GovernanceEngine(mockSession);
  engine.configure({
    governed_labels: ['exercise'],
    grace_period_seconds: 30,
  }, [{
    id: 'default',
    name: 'Default',
    minParticipants: 1,
    baseRequirement: { active: 'all', grace_period_seconds: 30 },
    challenges: []
  }], {});
  engine.media = { id: 'test-media', labels: ['exercise'], type: 'video' };
  return engine;
}

describe('GovernanceEngine — cache invalidation debounce', () => {
  it('should batch multiple _invalidateStateCache calls into a single onStateChange callback', async () => {
    const engine = createEngine();

    let callCount = 0;
    engine.callbacks.onStateChange = () => { callCount++; };

    // Call invalidate 5 times rapidly (simulates what happens during evaluate())
    engine._invalidateStateCache();
    engine._invalidateStateCache();
    engine._invalidateStateCache();
    engine._invalidateStateCache();
    engine._invalidateStateCache();

    // Should NOT have fired synchronously 5 times
    expect(callCount).toBe(0);

    // Wait for microtask to flush
    await new Promise(resolve => queueMicrotask(resolve));

    // Should fire exactly once
    expect(callCount).toBe(1);
  });

  it('should still increment _stateVersion on each invalidation', () => {
    const engine = createEngine();
    const before = engine._stateVersion;

    engine._invalidateStateCache();
    engine._invalidateStateCache();
    engine._invalidateStateCache();

    expect(engine._stateVersion).toBe(before + 3);
  });

  it('should allow a new batch after the microtask flushes', async () => {
    const engine = createEngine();

    let callCount = 0;
    engine.callbacks.onStateChange = () => { callCount++; };

    // First batch
    engine._invalidateStateCache();
    engine._invalidateStateCache();
    await new Promise(resolve => queueMicrotask(resolve));
    expect(callCount).toBe(1);

    // Second batch (should work because _stateChangePending was reset)
    engine._invalidateStateCache();
    engine._invalidateStateCache();
    await new Promise(resolve => queueMicrotask(resolve));
    expect(callCount).toBe(2);
  });
});
