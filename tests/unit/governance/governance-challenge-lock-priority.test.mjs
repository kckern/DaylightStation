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

  // Pass pre-normalized policies as second argument (bypasses _normalizePolicies)
  const policies = [{
    id: 'default',
    name: 'Default',
    minParticipants: 1,
    baseRequirement: {
      active: 'all',
      grace_period_seconds: grace
    },
    challenges: []
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

/**
 * Helper to advance engine to 'unlocked' phase by satisfying base requirements
 * and bypassing hysteresis.
 */
function advanceToUnlocked(engine, participants, userZoneMap, zoneRankMap, zoneInfoMap) {
  // First evaluate seeds satisfiedSince
  engine.evaluate({ activeParticipants: participants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount: participants.length });
  // Bypass hysteresis
  engine._hysteresisMs = 0;
  engine.meta.satisfiedSince = Date.now() - 1000;
  // Second evaluate transitions to unlocked
  engine.evaluate({ activeParticipants: participants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount: participants.length });
}

describe('GovernanceEngine — challenge failure lock priority', () => {
  it('should NOT lock when challenge fails but base requirements ARE satisfied', () => {
    const participants = ['alice', 'bob', 'charlie'];
    const userZoneMap = { alice: 'warm', bob: 'warm', charlie: 'active' };
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });

    // Advance to unlocked state
    advanceToUnlocked(engine, participants, userZoneMap, zoneRankMap, zoneInfoMap);
    expect(engine.phase).toBe('unlocked');

    // Simulate a failed challenge (e.g. "all warm" but charlie is only "active")
    engine.challengeState.activeChallenge = {
      id: 'test-challenge',
      status: 'failed',
      zone: 'warm',
      requiredCount: 3,
      startedAt: Date.now() - 60000,
      expiresAt: Date.now() - 1000,
      timeLimitSeconds: 60,
      selectionLabel: 'all warm',
      summary: { satisfied: false, missingUsers: ['charlie'], metUsers: ['alice', 'bob'], actualCount: 2 }
    };

    // All participants are in Active zone or above — base requirement satisfied
    engine.evaluate({ activeParticipants: participants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount: 3 });

    // Should NOT be locked — base requirements are met
    expect(engine.phase).not.toBe('locked');
  });

  it('should lock when challenge fails AND base requirements are NOT satisfied', () => {
    const participants = ['alice', 'bob', 'charlie'];
    const userZoneMap = { alice: 'warm', bob: 'active', charlie: 'cool' };
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });

    // Get to unlocked first with all meeting requirements
    const allActive = { alice: 'warm', bob: 'active', charlie: 'active' };
    advanceToUnlocked(engine, participants, allActive, zoneRankMap, zoneInfoMap);
    expect(engine.phase).toBe('unlocked');

    // Now charlie drops to cool AND challenge fails
    engine.challengeState.activeChallenge = {
      id: 'test-challenge',
      status: 'failed',
      zone: 'warm',
      requiredCount: 3,
      startedAt: Date.now() - 60000,
      expiresAt: Date.now() - 1000,
      timeLimitSeconds: 60,
      selectionLabel: 'all warm',
      summary: { satisfied: false, missingUsers: ['charlie'], metUsers: ['alice', 'bob'], actualCount: 2 }
    };

    engine.evaluate({ activeParticipants: participants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount: 3 });

    // SHOULD be locked — base requirements are not met AND challenge failed
    expect(engine.phase).toBe('locked');
  });
});
