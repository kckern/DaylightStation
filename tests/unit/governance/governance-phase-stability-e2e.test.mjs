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

/**
 * Creates a GovernanceEngine with optional ZoneProfileStore mock.
 *
 * @param {Object} options
 * @param {string[]} options.participants - Array of participant IDs
 * @param {number} options.grace - Grace period in seconds
 * @param {Object} options.zoneData - Map of participantId -> zoneId for ZoneProfileStore
 */
function createEngine({ participants = [], grace = 30, zoneData = {} } = {}) {
  const zoneConfig = [
    { id: 'cool', name: 'Cool', color: '#3399ff' },
    { id: 'active', name: 'Active', color: '#00cc00' },
    { id: 'warm', name: 'Warm', color: '#ffaa00' },
    { id: 'hot', name: 'Hot', color: '#ff0000' },
  ];
  const mockSession = {
    roster: participants.map(id => ({ id, isActive: true })),
    zoneProfileStore: Object.keys(zoneData).length > 0 ? {
      getProfile: (userId) => {
        const zoneId = zoneData[userId];
        return zoneId ? { currentZoneId: zoneId } : null;
      }
    } : null,
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

describe('GovernanceEngine — end-to-end phase stability', () => {

  it('pending -> unlocked with zero oscillation', () => {
    const participants = ['alice', 'bob'];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });

    // Track every phase change
    const phaseChanges = [];
    engine.setCallbacks({
      onPhaseChange: (phase) => phaseChanges.push(phase),
      onPulse: null,
      onStateChange: null
    });

    // Evaluate with both participants in active zone
    engine.evaluate({
      activeParticipants: participants,
      userZoneMap: { alice: 'active', bob: 'active' },
      zoneRankMap,
      zoneInfoMap,
      totalCount: 2
    });

    // Phase should be 'unlocked'
    expect(engine.phase).toBe('unlocked');

    // Should be exactly ONE phase change: to 'unlocked'
    // (configure() sets phase to 'pending' initially; the evaluate call transitions to 'unlocked')
    expect(phaseChanges).toEqual(['unlocked']);
  });

  it('maintain unlocked through mixed evaluate paths', () => {
    const participants = ['alice', 'bob'];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({
      participants,
      grace: 30,
      zoneData: { alice: 'active', bob: 'active' }
    });

    // Establish unlocked state with explicit data
    engine.evaluate({
      activeParticipants: participants,
      userZoneMap: { alice: 'active', bob: 'active' },
      zoneRankMap,
      zoneInfoMap,
      totalCount: 2
    });
    expect(engine.phase).toBe('unlocked');

    // Track phase changes AFTER initial unlock
    const phaseChanges = [];
    engine.setCallbacks({
      onPhaseChange: (phase) => phaseChanges.push(phase),
      onPulse: null,
      onStateChange: null
    });

    // Call evaluate() with NO args (simulates _triggerPulse path)
    // Engine should read from session.roster + ZoneProfileStore
    engine.evaluate();
    expect(engine.phase).toBe('unlocked');

    // Call evaluate again with explicit data
    engine.evaluate({
      activeParticipants: participants,
      userZoneMap: { alice: 'active', bob: 'active' },
      zoneRankMap,
      zoneInfoMap,
      totalCount: 2
    });
    expect(engine.phase).toBe('unlocked');

    // Call evaluate() with NO args again
    engine.evaluate();
    expect(engine.phase).toBe('unlocked');

    // There should be ZERO additional phase changes after initial unlock
    expect(phaseChanges).toEqual([]);
  });

  it('unlocked -> warning exactly once when HR drops', () => {
    const participants = ['alice', 'bob'];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });

    // Track every phase change
    const phaseChanges = [];
    engine.setCallbacks({
      onPhaseChange: (phase) => phaseChanges.push(phase),
      onPulse: null,
      onStateChange: null
    });

    // Start both in active zone -> unlocked
    engine.evaluate({
      activeParticipants: participants,
      userZoneMap: { alice: 'active', bob: 'active' },
      zoneRankMap,
      zoneInfoMap,
      totalCount: 2
    });
    expect(engine.phase).toBe('unlocked');

    // Drop alice to cool zone -> warning (grace period starts)
    engine.evaluate({
      activeParticipants: participants,
      userZoneMap: { alice: 'cool', bob: 'active' },
      zoneRankMap,
      zoneInfoMap,
      totalCount: 2
    });
    expect(engine.phase).toBe('warning');

    // Phase changes should be exactly: ['unlocked', 'warning']
    expect(phaseChanges).toEqual(['unlocked', 'warning']);
  });

  it('warning -> unlocked recovery is immediate (no hysteresis delay)', () => {
    const participants = ['alice', 'bob'];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });

    // Get to unlocked
    engine.evaluate({
      activeParticipants: participants,
      userZoneMap: { alice: 'active', bob: 'active' },
      zoneRankMap,
      zoneInfoMap,
      totalCount: 2
    });
    expect(engine.phase).toBe('unlocked');

    // Drop to warning
    engine.evaluate({
      activeParticipants: participants,
      userZoneMap: { alice: 'cool', bob: 'active' },
      zoneRankMap,
      zoneInfoMap,
      totalCount: 2
    });
    expect(engine.phase).toBe('warning');

    // Recover: both back in active zone
    // Should unlock IMMEDIATELY - no 1500ms hysteresis wait
    engine.evaluate({
      activeParticipants: participants,
      userZoneMap: { alice: 'active', bob: 'active' },
      zoneRankMap,
      zoneInfoMap,
      totalCount: 2
    });

    // Phase should be 'unlocked' right after recovery evaluate
    expect(engine.phase).toBe('unlocked');

    // Verify no hysteresis properties exist
    expect(engine._hysteresisMs).toBeUndefined();
    expect(engine._lastUnlockTime).toBeUndefined();
    expect(engine._relockGraceMs).toBeUndefined();
    expect(engine.satisfiedSince).toBeUndefined();
  });
});
