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

describe('GovernanceEngine — _getParticipantsBelowThreshold', () => {
  it('should cross-reference missingUsers against current userZoneMap', () => {
    const participants = ['alice', 'bob'];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });

    // Simulate a stale requirement summary where bob is listed as missing
    // for 'active' zone, but userZoneMap shows bob IS in 'active'
    engine.requirementSummary = {
      requirements: [{
        zone: 'active',
        zoneLabel: 'Active',
        requiredCount: 2,
        missingUsers: ['bob'],  // stale — bob was below but has since recovered
        satisfied: false
      }]
    };

    // Current zone map shows bob is actually in active zone
    engine._latestInputs.userZoneMap = { alice: 'active', bob: 'active' };
    engine._latestInputs.zoneRankMap = zoneRankMap;

    const below = engine._getParticipantsBelowThreshold();
    // bob should NOT appear — current zone map shows they meet the requirement
    const names = below.map(b => b.name);
    expect(names).not.toContain('bob');
  });

  it('should include users who are genuinely below threshold', () => {
    const participants = ['alice', 'bob'];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });

    engine.requirementSummary = {
      requirements: [{
        zone: 'active',
        zoneLabel: 'Active',
        requiredCount: 2,
        missingUsers: ['bob'],
        satisfied: false
      }]
    };

    // bob is genuinely in cool zone — below active
    engine._latestInputs.userZoneMap = { alice: 'active', bob: 'cool' };
    engine._latestInputs.zoneRankMap = zoneRankMap;

    const below = engine._getParticipantsBelowThreshold();
    const names = below.map(b => b.name);
    expect(names).toContain('bob');
  });
});
