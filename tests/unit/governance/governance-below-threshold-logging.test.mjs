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
