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

describe('GovernanceEngine — ghost participant filtering', () => {
  it('should exclude participants with no zone data from governance evaluation', () => {
    const participants = ['alice', 'bob', 'ghost'];
    // ghost has no entry in userZoneMap — disconnected
    const userZoneMap = { alice: 'active', bob: 'active' };
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });

    engine._hysteresisMs = 0;
    engine.meta.satisfiedSince = Date.now() - 5000;
    engine.evaluate({ activeParticipants: participants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount: 3 });

    // ghost should not appear in requirement summaries
    const allMissing = (engine.requirementSummary?.requirements || [])
      .flatMap(r => r.missingUsers || []);
    expect(allMissing).not.toContain('ghost');

    // With 2 active participants meeting "all active", requirements should be satisfied
    const allSatisfied = (engine.requirementSummary?.requirements || [])
      .every(r => r.satisfied);
    expect(allSatisfied).toBe(true);
  });

  it('should not filter participants who have zone data', () => {
    const participants = ['alice', 'bob'];
    const userZoneMap = { alice: 'active', bob: 'cool' };
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });

    engine._hysteresisMs = 0;
    engine.meta.satisfiedSince = Date.now() - 5000;
    engine.meta.satisfiedOnce = true;
    engine.evaluate({ activeParticipants: participants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount: 2 });

    // bob is in cool (below active) — should appear as missing
    const allMissing = (engine.requirementSummary?.requirements || [])
      .flatMap(r => r.missingUsers || []);
    expect(allMissing).toContain('bob');
  });
});
