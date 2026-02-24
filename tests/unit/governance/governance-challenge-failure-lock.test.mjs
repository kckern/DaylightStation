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

function createEngine({ participants = [], grace = 30, challenges = [] } = {}) {
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

  const policies = [{
    id: 'default',
    name: 'Default',
    minParticipants: 1,
    baseRequirement: {
      active: 'all',
      grace_period_seconds: grace
    },
    challenges
  }];

  engine.configure({
    governed_labels: ['exercise'],
    grace_period_seconds: grace,
  }, policies, {});

  engine.media = { id: 'test-media', labels: ['exercise'], type: 'video' };

  const zoneRankMap = {};
  const zoneInfoMap = {};
  zoneConfig.forEach((z, i) => {
    zoneRankMap[z.id] = i;
    zoneInfoMap[z.id] = z;
  });

  return { engine, zoneRankMap, zoneInfoMap };
}

function advanceToUnlocked(engine, participants, userZoneMap, zoneRankMap, zoneInfoMap) {
  engine.evaluate({ activeParticipants: participants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount: participants.length });
}

describe('GovernanceEngine — challenge failure lock (absolute)', () => {
  it('should stay locked on challenge failure even when base requirements are met', () => {
    const participants = ['alice', 'bob', 'charlie'];
    // All participants at 'active' or above — base requirement (active: all) is satisfied
    const userZoneMap = { alice: 'active', bob: 'active', charlie: 'active' };
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });

    // Advance to unlocked state
    advanceToUnlocked(engine, participants, userZoneMap, zoneRankMap, zoneInfoMap);
    expect(engine.phase).toBe('unlocked');

    // Inject a failed challenge — challenge required 'hot' zone but nobody reached it
    engine.challengeState.activeChallenge = {
      id: 'test-challenge',
      status: 'failed',
      zone: 'hot',
      requiredCount: 3,
      startedAt: Date.now() - 60000,
      expiresAt: Date.now() - 1000,
      timeLimitSeconds: 60,
      selectionLabel: 'all hot',
      summary: { satisfied: false, missingUsers: ['alice', 'bob', 'charlie'], metUsers: [], actualCount: 0 }
    };

    // Evaluate — base requirements are still met (all active), but challenge failed
    engine.evaluate({ activeParticipants: participants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount: 3 });

    // Challenge failure must lock regardless of base requirement satisfaction
    expect(engine.phase).toBe('locked');
  });

  it('should remain locked through multiple evaluations until challenge recovery', () => {
    const participants = ['alice', 'bob', 'charlie'];
    // All participants at 'active' — base requirement satisfied
    const userZoneMap = { alice: 'active', bob: 'active', charlie: 'active' };

    // Include a challenge config so _evaluateChallenges doesn't clear activeChallenge
    const challengeConfig = [{
      id: 'test-challenge-config',
      intervalRangeSeconds: [30, 60],
      minParticipants: 1,
      selectionType: 'cyclic',
      selections: [
        { id: 'sel-hot', zone: 'hot', rule: 'all', timeAllowedSeconds: 60, label: 'all hot' }
      ]
    }];

    const { engine, zoneRankMap, zoneInfoMap } = createEngine({
      participants,
      grace: 30,
      challenges: challengeConfig
    });

    // Advance to unlocked state
    advanceToUnlocked(engine, participants, userZoneMap, zoneRankMap, zoneInfoMap);
    expect(engine.phase).toBe('unlocked');

    // Inject a failed challenge
    engine.challengeState.activeChallenge = {
      id: 'test-challenge',
      status: 'failed',
      zone: 'hot',
      rule: 'all',
      requiredCount: 3,
      startedAt: Date.now() - 60000,
      expiresAt: Date.now() - 1000,
      timeLimitSeconds: 60,
      selectionLabel: 'all hot',
      historyRecorded: false,
      summary: { satisfied: false, missingUsers: ['alice', 'bob', 'charlie'], metUsers: [], actualCount: 0 }
    };

    // Evaluate 5 times — lock must persist through all evaluations
    for (let i = 0; i < 5; i++) {
      engine.evaluate({ activeParticipants: participants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount: 3 });
      expect(engine.phase).toBe('locked');
    }
  });
});
