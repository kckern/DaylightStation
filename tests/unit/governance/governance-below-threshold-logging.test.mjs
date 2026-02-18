import { describe, it, expect, jest } from '@jest/globals';

// Singleton mock logger so tests can inspect calls made by GovernanceEngine
const _mockLogger = {
  debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
  error: jest.fn(), sampled: jest.fn()
};
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => _mockLogger,
  getLogger: () => _mockLogger
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

describe('GovernanceEngine — HR/threshold/delta enrichment', () => {
  it('should include hr, threshold, and delta in participantsBelowThreshold', async () => {
    const participants = ['alice', 'bob'];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });

    // Mock session roster with HR data
    engine.session.roster = [
      { id: 'alice', name: 'Alice', heartRate: 140, isActive: true },
      { id: 'bob', name: 'Bob', heartRate: 124, isActive: true }
    ];

    // Use a dynamic zoneProfileStore that tracks the "current" zone per user.
    // evaluate() calls getProfile() and overrides userZoneMap with currentZoneId,
    // so the mock must return the correct zone for each evaluation phase.
    const profileZones = { alice: 'active', bob: 'active' };
    engine.session.zoneProfileStore = {
      getProfile: (id) => {
        const zoneConfigs = [
          { id: 'cool', min: 0 },
          { id: 'active', min: 125 },
          { id: 'warm', min: 150 }
        ];
        if (id === 'bob') return {
          currentZoneId: profileZones.bob,
          currentZoneThreshold: profileZones.bob === 'cool' ? 0 : 125,
          heartRate: 124,
          zoneConfig: zoneConfigs
        };
        if (id === 'alice') return {
          currentZoneId: profileZones.alice,
          currentZoneThreshold: 125,
          heartRate: 140,
          zoneConfig: zoneConfigs
        };
        return null;
      }
    };

    // Get to unlocked first (both in active)
    engine.evaluate({
      activeParticipants: participants,
      userZoneMap: { alice: 'active', bob: 'active' },
      zoneRankMap,
      zoneInfoMap
    });
    expect(engine.phase).toBe('unlocked');

    _mockLogger.info.mockClear();

    // Simulate bob dropping to cool zone
    profileZones.bob = 'cool';

    // Bob drops below active -> warning
    engine.evaluate({
      activeParticipants: participants,
      userZoneMap: { alice: 'active', bob: 'cool' },
      zoneRankMap,
      zoneInfoMap
    });
    expect(engine.phase).toBe('warning');

    const warningCall = _mockLogger.info.mock.calls.find(
      ([event]) => event === 'governance.warning_started'
    );
    expect(warningCall).toBeDefined();

    const payload = warningCall[1];
    const bobEntry = payload.participantsBelowThreshold.find(p => p.name === 'bob');

    expect(bobEntry).toBeDefined();
    expect(bobEntry.hr).toBe(124);
    expect(bobEntry.threshold).toBe(125);  // active zone min from bob's zoneConfig
    expect(bobEntry.delta).toBe(-1);       // 124 - 125 = -1
    expect(bobEntry.requiredZone).toBeDefined();
    expect(bobEntry.requiredZone).toBe('active');
    // zone should be the user's CURRENT zone, not the required zone
    expect(bobEntry.zone).toBe('cool');
  });

  it('should handle missing roster/ZoneProfileStore gracefully', () => {
    const participants = ['alice', 'bob'];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });

    // No roster or zoneProfileStore set on session
    engine.session.roster = null;
    engine.session.zoneProfileStore = null;

    // Get to unlocked first
    engine.evaluate({
      activeParticipants: participants,
      userZoneMap: { alice: 'active', bob: 'active' },
      zoneRankMap,
      zoneInfoMap
    });
    expect(engine.phase).toBe('unlocked');

    _mockLogger.info.mockClear();

    // Bob drops -> warning
    engine.evaluate({
      activeParticipants: participants,
      userZoneMap: { alice: 'active', bob: 'cool' },
      zoneRankMap,
      zoneInfoMap
    });
    expect(engine.phase).toBe('warning');

    const warningCall = _mockLogger.info.mock.calls.find(
      ([event]) => event === 'governance.warning_started'
    );
    expect(warningCall).toBeDefined();

    const payload = warningCall[1];
    const bobEntry = payload.participantsBelowThreshold.find(p => p.name === 'bob');

    expect(bobEntry).toBeDefined();
    // With no roster/ZoneProfileStore, these should be null (not crash)
    expect(bobEntry.hr).toBeNull();
    expect(bobEntry.threshold).toBeNull();
    expect(bobEntry.delta).toBeNull();
    expect(bobEntry.requiredZone).toBeDefined();
  });
});

describe('stale data fix — full evaluate cycle', () => {
  it('should populate participantsBelowThreshold during warning_started via evaluate()', () => {
    const participants = ['alice', 'bob'];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });

    // First evaluate: both above threshold -> unlocked, satisfiedOnce = true
    engine.evaluate({
      activeParticipants: participants,
      userZoneMap: { alice: 'active', bob: 'active' },
      zoneRankMap,
      zoneInfoMap
    });
    expect(engine.phase).toBe('unlocked');

    // Clear all logger mocks so we only see calls from the second evaluate
    _mockLogger.info.mockClear();
    _mockLogger.debug.mockClear();
    _mockLogger.warn.mockClear();
    _mockLogger.sampled.mockClear();

    // Second evaluate: bob drops to cool -> warning
    engine.evaluate({
      activeParticipants: participants,
      userZoneMap: { alice: 'active', bob: 'cool' },
      zoneRankMap,
      zoneInfoMap
    });
    expect(engine.phase).toBe('warning');

    // Find the warning_started log call
    const warningCall = _mockLogger.info.mock.calls.find(
      ([event]) => event === 'governance.warning_started'
    );
    expect(warningCall).toBeDefined();

    const payload = warningCall[1];
    const belowNames = (payload.participantsBelowThreshold || []).map(p => p.name);
    // THIS IS THE KEY ASSERTION: bob must appear (was [] before the fix)
    expect(belowNames).toContain('bob');
  });

  it('should populate participantStates during lock_triggered via evaluate()', () => {
    const participants = ['alice', 'bob'];
    // grace=0 means immediate lock when requirements fail after satisfiedOnce
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 0 });

    // First evaluate: both above threshold -> unlocked, satisfiedOnce = true
    engine.evaluate({
      activeParticipants: participants,
      userZoneMap: { alice: 'active', bob: 'active' },
      zoneRankMap,
      zoneInfoMap
    });
    expect(engine.phase).toBe('unlocked');

    // Clear mocks
    _mockLogger.info.mockClear();
    _mockLogger.debug.mockClear();
    _mockLogger.warn.mockClear();
    _mockLogger.sampled.mockClear();

    // Second evaluate: bob drops to cool -> locked (no grace period)
    engine.evaluate({
      activeParticipants: participants,
      userZoneMap: { alice: 'active', bob: 'cool' },
      zoneRankMap,
      zoneInfoMap
    });
    expect(engine.phase).toBe('locked');

    // Find the lock_triggered log call
    const lockCall = _mockLogger.info.mock.calls.find(
      ([event]) => event === 'governance.lock_triggered'
    );
    expect(lockCall).toBeDefined();

    const payload = lockCall[1];
    const states = payload.participantStates || [];
    // participantStates should contain current zone data, not stale empty data
    expect(states.length).toBeGreaterThan(0);
    const bobState = states.find(s => s.id === 'bob');
    expect(bobState).toBeDefined();
    expect(bobState.zone).toBe('cool');
  });
});
