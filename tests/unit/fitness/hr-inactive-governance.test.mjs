import { describe, it, expect, beforeEach, jest } from '@jest/globals';

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

const ZONE_CONFIG = [
  { id: 'cool', name: 'Cool', color: '#3399ff' },
  { id: 'active', name: 'Active', color: '#00cc00' },
  { id: 'warm', name: 'Warm', color: '#ffaa00' },
  { id: 'hot', name: 'Hot', color: '#ff0000' },
];

function createEngine({ grace = 30 } = {}) {
  const mockSession = {
    roster: [],
    zoneProfileStore: null,
    snapshot: { zoneConfig: ZONE_CONFIG }
  };
  const engine = new GovernanceEngine(mockSession);
  const policies = [{
    id: 'default', name: 'Default', minParticipants: 1,
    baseRequirement: { active: 'all', grace_period_seconds: grace },
    challenges: []
  }];
  engine.configure({ governed_labels: ['exercise'], grace_period_seconds: grace }, policies, {});
  engine.media = { id: 'test-media', labels: ['exercise'], type: 'video' };
  const zoneRankMap = {};
  const zoneInfoMap = {};
  ZONE_CONFIG.forEach((z, i) => { zoneRankMap[z.id] = i; zoneInfoMap[z.id] = z; });
  return { engine, zoneRankMap, zoneInfoMap };
}

describe('GovernanceEngine — hrInactive exclusion', () => {
  it('should expose hrInactiveUsers in state snapshot', () => {
    const { engine, zoneRankMap, zoneInfoMap } = createEngine();
    engine.evaluate({
      activeParticipants: ['alice', 'bob'],
      userZoneMap: { alice: 'active', bob: 'active' },
      zoneRankMap, zoneInfoMap,
      totalCount: 2,
      hrInactiveUsers: ['charlie']
    });
    expect(engine.state.hrInactiveUsers).toEqual(['charlie']);
  });

  it('should default hrInactiveUsers to empty array when not provided', () => {
    const { engine, zoneRankMap, zoneInfoMap } = createEngine();
    engine.evaluate({
      activeParticipants: ['alice'],
      userZoneMap: { alice: 'active' },
      zoneRankMap, zoneInfoMap,
      totalCount: 1
    });
    expect(engine.state.hrInactiveUsers).toEqual([]);
  });
});

describe('FitnessSession — hrInactive filtering', () => {
  const filterActiveParticipants = (effectiveRoster) => {
    return effectiveRoster
      .filter((entry) => {
        const isActive = entry.isActive !== false;
        const hrActive = !entry.hrInactive;
        return isActive && hrActive && (entry.id || entry.profileId);
      })
      .map(entry => entry.id || entry.profileId);
  };

  const filterHrInactiveUsers = (effectiveRoster) => {
    return effectiveRoster
      .filter(entry => entry.hrInactive && (entry.id || entry.profileId))
      .map(entry => entry.id || entry.profileId);
  };

  it('should exclude hrInactive entries from activeParticipants', () => {
    const roster = [
      { id: 'alice', name: 'alice', isActive: true, hrInactive: false, zoneId: 'active' },
      { id: 'bob', name: 'bob', isActive: true, hrInactive: true, zoneId: null },
      { id: 'charlie', name: 'charlie', isActive: true, hrInactive: false, zoneId: 'warm' }
    ];
    const active = filterActiveParticipants(roster);
    expect(active).toEqual(['alice', 'charlie']);
    expect(active).not.toContain('bob');
  });

  it('should collect hrInactive entries into hrInactiveUsers', () => {
    const roster = [
      { id: 'alice', name: 'alice', hrInactive: false },
      { id: 'bob', name: 'bob', hrInactive: true },
      { id: 'charlie', name: 'charlie', hrInactive: true }
    ];
    const inactive = filterHrInactiveUsers(roster);
    expect(inactive).toEqual(['bob', 'charlie']);
  });

  it('should exclude both inactive device and hrInactive entries', () => {
    const roster = [
      { id: 'alice', name: 'alice', isActive: true, hrInactive: false },
      { id: 'bob', name: 'bob', isActive: false, hrInactive: false },
      { id: 'charlie', name: 'charlie', isActive: true, hrInactive: true }
    ];
    const active = filterActiveParticipants(roster);
    expect(active).toEqual(['alice']);
  });
});
