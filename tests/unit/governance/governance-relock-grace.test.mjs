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

function createEngine({ participants = [], grace = 30 } = {}) {
  const zoneConfig = [
    { id: 'cool', name: 'Cool', color: '#3399ff' },
    { id: 'active', name: 'Active', color: '#00cc00' },
    { id: 'warm', name: 'Warm', color: '#ffaa00' },
    { id: 'hot', name: 'Hot', color: '#ff0000' },
  ];
  const mockSession = {
    roster: participants.map(id => ({ id, isActive: true })),
    zoneProfileStore: null,
    snapshot: { zoneConfig }
  };
  const engine = new GovernanceEngine(mockSession);
  engine.configure({
    governed_labels: ['exercise'],
    grace_period_seconds: grace,
  }, [{
    id: 'default',
    name: 'Default',
    minParticipants: 1,
    baseRequirement: { active: 'all', grace_period_seconds: grace },
    challenges: []
  }], {});
  engine.media = { id: 'test-media', labels: ['exercise'], type: 'video' };

  const zoneRankMap = {};
  const zoneInfoMap = {};
  zoneConfig.forEach((z, i) => {
    zoneRankMap[z.id] = i;
    zoneInfoMap[z.id] = z;
  });

  return { engine, zoneRankMap, zoneInfoMap };
}

describe('GovernanceEngine — relock grace period', () => {
  it('should have default relock grace of 5000ms', () => {
    const { engine } = createEngine();
    expect(engine._relockGraceMs).toBe(5000);
  });

  it('should stay unlocked for 5s even if requirements briefly break', () => {
    const participants = ['alice'];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });
    const evalOpts = (zones) => ({
      activeParticipants: participants,
      userZoneMap: zones,
      zoneRankMap,
      zoneInfoMap,
      totalCount: 1
    });

    // Get to unlocked (bypass hysteresis)
    engine._hysteresisMs = 0;
    engine.meta.satisfiedSince = Date.now() - 5000;
    engine.evaluate(evalOpts({ alice: 'active' }));
    expect(engine.phase).toBe('unlocked');

    // Simulate _lastUnlockTime being very recent
    engine._lastUnlockTime = Date.now();

    // Requirements break — should stay unlocked during grace
    engine.evaluate(evalOpts({ alice: 'cool' }));
    expect(engine.phase).toBe('unlocked');
  });

  it('should transition to warning after relock grace expires', () => {
    const participants = ['alice'];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });
    const evalOpts = (zones) => ({
      activeParticipants: participants,
      userZoneMap: zones,
      zoneRankMap,
      zoneInfoMap,
      totalCount: 1
    });

    // Get to unlocked
    engine._hysteresisMs = 0;
    engine.meta.satisfiedSince = Date.now() - 5000;
    engine.evaluate(evalOpts({ alice: 'active' }));
    expect(engine.phase).toBe('unlocked');

    // Simulate unlock happened 6 seconds ago (past the 5s grace)
    engine._lastUnlockTime = Date.now() - 6000;

    // Requirements break — should now transition to warning
    engine.evaluate(evalOpts({ alice: 'cool' }));
    expect(engine.phase).toBe('warning');
  });

  it('should track _lastUnlockTime when transitioning to unlocked', () => {
    const participants = ['alice'];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants });

    expect(engine._lastUnlockTime).toBeNull();

    // Transition to unlocked
    engine._hysteresisMs = 0;
    engine.meta.satisfiedSince = Date.now() - 5000;
    engine.evaluate({
      activeParticipants: participants,
      userZoneMap: { alice: 'active' },
      zoneRankMap,
      zoneInfoMap,
      totalCount: 1
    });

    expect(engine.phase).toBe('unlocked');
    expect(engine._lastUnlockTime).not.toBeNull();
    expect(typeof engine._lastUnlockTime).toBe('number');
  });

  it('should clear _lastUnlockTime on reset()', () => {
    const { engine } = createEngine();
    engine._lastUnlockTime = Date.now();
    engine.reset();
    expect(engine._lastUnlockTime).toBeNull();
  });

  it('should clear _lastUnlockTime on _resetToIdle()', () => {
    const { engine } = createEngine();
    engine._lastUnlockTime = Date.now();
    engine._resetToIdle();
    expect(engine._lastUnlockTime).toBeNull();
  });
});
