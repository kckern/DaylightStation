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

describe('GovernanceEngine — immediate unlock (no hysteresis)', () => {
  it('should unlock immediately when requirements are first met', () => {
    const participants = ['alice', 'bob'];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });
    const activeMap = { alice: 'active', bob: 'active' };

    engine.evaluate({ activeParticipants: participants, userZoneMap: activeMap, zoneRankMap, zoneInfoMap, totalCount: 2 });
    expect(engine.phase).toBe('unlocked');
  });

  it('should unlock immediately from warning when requirements recover', () => {
    const participants = ['alice', 'bob'];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });
    const activeMap = { alice: 'active', bob: 'active' };
    const coolMap = { alice: 'cool', bob: 'active' };

    // Get to unlocked
    engine.evaluate({ activeParticipants: participants, userZoneMap: activeMap, zoneRankMap, zoneInfoMap, totalCount: 2 });
    expect(engine.phase).toBe('unlocked');

    // Drop to warning
    engine.evaluate({ activeParticipants: participants, userZoneMap: coolMap, zoneRankMap, zoneInfoMap, totalCount: 2 });
    expect(engine.phase).toBe('warning');

    // Recover — should unlock IMMEDIATELY, no 1500ms wait
    engine.evaluate({ activeParticipants: participants, userZoneMap: activeMap, zoneRankMap, zoneInfoMap, totalCount: 2 });
    expect(engine.phase).toBe('unlocked');
  });

  it('should not have _hysteresisMs property', () => {
    const { engine } = createEngine();
    expect(engine._hysteresisMs).toBeUndefined();
  });
});
