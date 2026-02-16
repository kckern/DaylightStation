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
 * The key difference from the standard test helper: `zoneData` parameter
 * populates a mock ZoneProfileStore on the session. This simulates the
 * real scenario where ZoneProfileStore has current zone data for participants
 * but evaluate() is called without explicit userZoneMap (as _triggerPulse does).
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
    zoneProfileStore: {
      getProfile: (userId) => {
        const zoneId = zoneData[userId];
        return zoneId ? { currentZoneId: zoneId } : null;
      }
    },
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

describe('GovernanceEngine - ghost participant oscillation regression', () => {
  /**
   * BUG: When evaluate() is called without explicit userZoneMap (as _triggerPulse
   * does), the ghost participant filter at lines 1241-1253 runs BEFORE
   * ZoneProfileStore population at lines 1266-1280. Since userZoneMap is {},
   * ALL participants are filtered out as "ghosts", even though ZoneProfileStore
   * has valid zone data for them.
   *
   * This causes the participant count to drop to 0, which flips phase to
   * 'pending', triggering a React re-render. The re-render calls evaluate()
   * with full data -> unlocked -> _triggerPulse fires -> evaluate with no
   * args -> all participants removed -> pending -> re-render -> oscillation.
   */

  it('evaluate() without explicit zone data should NOT drop participants to 0 when ZoneProfileStore has data', () => {
    const { engine } = createEngine({
      participants: ['alice', 'bob'],
      grace: 30,
      zoneData: { alice: 'active', bob: 'active' }
    });


    // Call evaluate with NO arguments - this is what _triggerPulse() does
    engine.evaluate();

    // After evaluate(), participants should NOT have been dropped to 0.
    // ZoneProfileStore has zone data for both alice and bob, so the ghost
    // filter should recognize them as valid participants.
    const activeCount = engine.requirementSummary?.activeCount ?? 0;
    expect(activeCount).toBeGreaterThan(0);
    expect(activeCount).toBe(2);

    // Phase should be 'unlocked' because both participants meet the 'active' requirement
    // (they're in the 'active' zone which meets the 'active' base requirement)
    expect(engine.phase).toBe('unlocked');
  });

  it('_triggerPulse() should not cause phase oscillation when ZoneProfileStore has data', () => {
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({
      participants: ['alice', 'bob'],
      grace: 30,
      zoneData: { alice: 'active', bob: 'active' }
    });


    // First, get engine into 'unlocked' state via explicit evaluate
    engine.evaluate({
      activeParticipants: ['alice', 'bob'],
      userZoneMap: { alice: 'active', bob: 'active' },
      zoneRankMap,
      zoneInfoMap,
      totalCount: 2
    });
    expect(engine.phase).toBe('unlocked');

    // Now simulate what happens in production: _triggerPulse() calls evaluate()
    // with no args. This should NOT cause the phase to flip back to 'pending'.
    const phaseBefore = engine.phase;
    engine._triggerPulse();
    const phaseAfter = engine.phase;

    // Phase should remain 'unlocked' - NOT oscillate to 'pending'
    expect(phaseAfter).toBe('unlocked');
    expect(phaseAfter).toBe(phaseBefore);

    // Verify participants were not dropped
    const activeCount = engine.requirementSummary?.activeCount ?? 0;
    expect(activeCount).toBe(2);
  });

  it('no-args evaluate() should find participants via ZoneProfileStore even with empty userZoneMap', () => {
    const { engine } = createEngine({
      participants: ['alice', 'bob', 'charlie'],
      grace: 30,
      zoneData: { alice: 'warm', bob: 'active', charlie: 'hot' }
    });


    // Call evaluate with no args - simulates _triggerPulse() path
    engine.evaluate();

    // All three participants should be present (ZoneProfileStore has data for all)
    const activeCount = engine.requirementSummary?.activeCount ?? 0;
    expect(activeCount).toBe(3);

    // Phase should be 'unlocked' because all participants are at or above 'active'
    // (warm rank=2 > active rank=1, hot rank=3 > active rank=1, active rank=1 == active rank=1)
    expect(engine.phase).toBe('unlocked');

    // The userZoneMap in latestInputs should have been populated from ZoneProfileStore
    const capturedZoneMap = engine._latestInputs?.userZoneMap || {};
    expect(capturedZoneMap['alice']).toBe('warm');
    expect(capturedZoneMap['bob']).toBe('active');
    expect(capturedZoneMap['charlie']).toBe('hot');
  });
});
