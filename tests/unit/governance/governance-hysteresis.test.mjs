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

describe('GovernanceEngine — hysteresis', () => {
  it('should have default hysteresis of 1500ms', () => {
    const { engine } = createEngine();
    expect(engine._hysteresisMs).toBe(1500);
  });

  it('should require 1500ms of sustained satisfaction before unlocking from warning', () => {
    const participants = ['alice', 'bob'];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });
    const activeMap = { alice: 'active', bob: 'active' };

    // Get to unlocked first (bypass hysteresis temporarily)
    engine._hysteresisMs = 0;
    engine.meta.satisfiedSince = Date.now() - 5000;
    engine.meta.satisfiedOnce = true;
    engine.evaluate({ activeParticipants: participants, userZoneMap: activeMap, zoneRankMap, zoneInfoMap, totalCount: 2 });
    expect(engine.phase).toBe('unlocked');

    // Drop to cool → warning (expire relock grace first)
    engine._lastUnlockTime = Date.now() - 6000;
    const coolMap = { alice: 'cool', bob: 'active' };
    engine.evaluate({ activeParticipants: participants, userZoneMap: coolMap, zoneRankMap, zoneInfoMap, totalCount: 2 });
    expect(engine.phase).toBe('warning');

    // Restore hysteresis to real value
    engine._hysteresisMs = 1500;

    // Satisfy requirements — reset satisfiedSince to "just now"
    engine.meta.satisfiedSince = null;
    engine.evaluate({ activeParticipants: participants, userZoneMap: activeMap, zoneRankMap, zoneInfoMap, totalCount: 2 });
    // Should still be warning — just became satisfied, 0ms elapsed
    expect(engine.phase).toBe('warning');

    // After 600ms — should STILL be warning (old 500ms threshold would have passed)
    engine.meta.satisfiedSince = Date.now() - 600;
    engine.evaluate({ activeParticipants: participants, userZoneMap: activeMap, zoneRankMap, zoneInfoMap, totalCount: 2 });
    expect(engine.phase).toBe('warning');

    // After 1600ms — should transition to unlocked
    engine.meta.satisfiedSince = Date.now() - 1600;
    engine.evaluate({ activeParticipants: participants, userZoneMap: activeMap, zoneRankMap, zoneInfoMap, totalCount: 2 });
    expect(engine.phase).toBe('unlocked');
  });
});
