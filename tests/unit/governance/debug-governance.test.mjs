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

describe('debug governance phase transition', () => {
  it('traces phase transitions', () => {
    const zoneConfig = [
      { id: 'cool', name: 'Cool', color: '#3399ff' },
      { id: 'active', name: 'Active', color: '#00cc00' },
      { id: 'warm', name: 'Warm', color: '#ffaa00' },
      { id: 'hot', name: 'Hot', color: '#ff0000' },
    ];
    const participants = ['alice', 'bob', 'charlie'];

    const mockSession = {
      roster: participants.map(id => ({ id, isActive: true })),
      zoneProfileStore: null,
      snapshot: { zoneConfig }
    };
    const engine = new GovernanceEngine(mockSession);
    console.log('After constructor, phase:', engine.phase);

    engine.configure({
      governed_labels: ['exercise'],
      grace_period_seconds: 30,
      policies: [{
        id: 'default',
        name: 'Default',
        minParticipants: 1,
        baseRequirement: {
          active: 'all',
          grace_period_seconds: 30
        },
        challenges: []
      }]
    }, [], {});
    console.log('After configure, phase:', engine.phase);
    console.log('_latestInputs.zoneRankMap:', engine._latestInputs.zoneRankMap);
    console.log('media:', engine.media);
    console.log('policies:', JSON.stringify(engine.policies));
    console.log('_governedLabelSet:', [...engine._governedLabelSet]);

    engine.media = { id: 'test-media', labels: ['exercise'], type: 'video' };
    console.log('After set media, phase:', engine.phase);

    const zoneRankMap = {};
    const zoneInfoMap = {};
    zoneConfig.forEach((z, i) => {
      zoneRankMap[z.id] = i;
      zoneInfoMap[z.id] = z;
    });

    const userZoneMap = { alice: 'warm', bob: 'warm', charlie: 'active' };

    engine.evaluate({ activeParticipants: participants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount: 3 });
    console.log('After first evaluate, phase:', engine.phase, 'meta:', JSON.stringify(engine.meta));
    console.log('requirementSummary:', JSON.stringify(engine.requirementSummary));

    engine._hysteresisMs = 0;
    engine.meta.satisfiedSince = Date.now() - 1000;
    console.log('meta before second eval:', JSON.stringify(engine.meta));
    engine.evaluate({ activeParticipants: participants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount: 3 });
    console.log('After second evaluate, phase:', engine.phase, 'meta:', JSON.stringify(engine.meta));

    expect(true).toBe(true);
  });
});
