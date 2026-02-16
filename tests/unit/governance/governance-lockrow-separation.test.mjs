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

function createEngine({ participants = [], userZoneMap = {}, grace = 30 } = {}) {
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
    challenges: [{
      id: 'warm-challenge',
      intervalSeconds: 120,
      selectionType: 'cyclic',
      selections: [
        { id: 'all-warm', label: 'all warm', zone: 'warm', rule: 'all', timeAllowedSeconds: 60 }
      ]
    }]
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
  engine._hysteresisMs = 0;
  engine.meta.satisfiedSince = Date.now() - 1000;
  engine.evaluate({ activeParticipants: participants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount: participants.length });
}

describe('GovernanceEngine — lock row separation', () => {
  it('should NOT include challenge offenders in lockRows during warning phase', () => {
    const participants = ['alice', 'bob'];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });

    // Get to unlocked with both in warm
    advanceToUnlocked(engine, participants, { alice: 'warm', bob: 'warm' }, zoneRankMap, zoneInfoMap);
    expect(engine.phase).toBe('unlocked');

    // Set active challenge for "warm" zone — bob is only in 'active' (fails challenge but meets base)
    engine.challengeState.activeChallenge = {
      id: 'chal-1',
      status: 'pending',
      zone: 'warm',
      requiredCount: 2,
      startedAt: Date.now(),
      expiresAt: Date.now() + 60000,
      timeLimitSeconds: 60,
      selectionLabel: 'all warm',
      rule: 'all',
      configId: 'warm-challenge',
      summary: { satisfied: false, missingUsers: ['alice', 'bob'], metUsers: [], actualCount: 0 }
    };

    // alice drops to cool — base requirement unsatisfied → warning (expire relock grace first)
    engine._lastUnlockTime = Date.now() - 6000;
    const droppedMap = { alice: 'cool', bob: 'active' };
    engine.evaluate({ activeParticipants: participants, userZoneMap: droppedMap, zoneRankMap, zoneInfoMap, totalCount: 2 });
    expect(engine.phase).toBe('warning');

    const state = engine._getCachedState();
    const lockRowNames = state.lockRows.flatMap(r => r.missingUsers || []);

    // alice is below base requirement — should appear
    expect(lockRowNames).toContain('alice');
    // bob is in 'active' — meets base requirement — should NOT appear (challenge offender only)
    expect(lockRowNames).not.toContain('bob');
  });

  it('should still expose challenge data via state.challenge snapshot', () => {
    const participants = ['alice', 'bob'];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });

    advanceToUnlocked(engine, participants, { alice: 'warm', bob: 'warm' }, zoneRankMap, zoneInfoMap);

    engine.challengeState.activeChallenge = {
      id: 'chal-1',
      status: 'pending',
      zone: 'warm',
      requiredCount: 2,
      startedAt: Date.now(),
      expiresAt: Date.now() + 60000,
      timeLimitSeconds: 60,
      selectionLabel: 'all warm',
      rule: 'all',
      configId: 'warm-challenge',
      summary: { satisfied: false, missingUsers: ['bob'], metUsers: ['alice'], actualCount: 1 }
    };

    // alice drops to cool → warning
    engine.evaluate({ activeParticipants: participants, userZoneMap: { alice: 'cool', bob: 'active' }, zoneRankMap, zoneInfoMap, totalCount: 2 });

    const state = engine._getCachedState();
    // Challenge info should still be available separately
    expect(state.challenge).not.toBeNull();
    expect(state.challenge.zone).toBe('warm');
    expect(state.challenge.missingUsers).toEqual(expect.arrayContaining(['bob']));
  });
});
