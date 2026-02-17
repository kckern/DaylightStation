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

function createEngine({ roster = [], grace = 30 } = {}) {
  const zoneConfig = [
    { id: 'cool', name: 'Cool', color: '#3399ff' },
    { id: 'active', name: 'Active', color: '#00cc00' },
    { id: 'warm', name: 'Warm', color: '#ffaa00' },
    { id: 'hot', name: 'Hot', color: '#ff0000' },
  ];
  const mockSession = {
    roster,
    zoneProfileStore: null, // Deliberately null — simulates ZoneProfileStore unavailable
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

describe('GovernanceEngine — evaluate path unification (P1)', () => {

  it('Path A should read zone data from roster entries when ZoneProfileStore is null', () => {
    const roster = [
      { id: 'alice', isActive: true, zoneId: 'active' },
      { id: 'bob', isActive: true, zoneId: 'active' },
    ];
    const { engine } = createEngine({ roster, grace: 30 });

    // Call evaluate with NO args — Path A (_triggerPulse path)
    // ZoneProfileStore is null, but roster entries have zoneId
    engine.evaluate();

    // Participants should NOT be ghost-filtered — roster entries have zone data
    const activeCount = engine.requirementSummary?.activeCount ?? 0;
    expect(activeCount).toBe(2);

    // Phase should be 'unlocked' — both are in 'active' zone
    expect(engine.phase).toBe('unlocked');
  });

  it('Path A and Path B should produce same phase for identical roster state', () => {
    const roster = [
      { id: 'alice', isActive: true, zoneId: 'active' },
      { id: 'bob', isActive: true, zoneId: 'warm' },
    ];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ roster, grace: 30 });

    // Path B: explicit evaluate (what updateSnapshot does)
    engine.evaluate({
      activeParticipants: ['alice', 'bob'],
      userZoneMap: { alice: 'active', bob: 'warm' },
      zoneRankMap,
      zoneInfoMap,
      totalCount: 2
    });
    const phasePathB = engine.phase;
    const activeCountPathB = engine.requirementSummary?.activeCount ?? 0;

    // Reset engine state to pending
    engine._setPhase('pending');
    engine.meta.satisfiedOnce = false;

    // Path A: no-args evaluate (what _triggerPulse does)
    engine.evaluate();
    const phasePathA = engine.phase;
    const activeCountPathA = engine.requirementSummary?.activeCount ?? 0;

    // Both paths should produce identical results
    expect(phasePathA).toBe(phasePathB);
    expect(activeCountPathA).toBe(activeCountPathB);
  });

  it('Path A should handle roster entries with null zoneId (no HR data yet)', () => {
    const roster = [
      { id: 'alice', isActive: true, zoneId: null },
      { id: 'bob', isActive: true, zoneId: 'active' },
    ];
    const { engine } = createEngine({ roster, grace: 30 });

    engine.evaluate();

    // alice has null zone → correctly ghost-filtered (no zone data = disconnected)
    // bob has 'active' zone → kept, meets requirement
    // With 1 participant meeting 'all active', phase should be 'unlocked'
    const activeCount = engine.requirementSummary?.activeCount ?? 0;
    expect(activeCount).toBe(1);
    expect(engine.phase).toBe('unlocked');
  });

  it('no oscillation when alternating between Path A and Path B (no ZoneProfileStore)', () => {
    const roster = [
      { id: 'alice', isActive: true, zoneId: 'active' },
    ];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ roster, grace: 30 });

    const phaseChanges = [];
    engine.setCallbacks({
      onPhaseChange: (phase) => phaseChanges.push(phase),
      onPulse: null,
      onStateChange: null
    });

    // Path B: explicit → unlocked
    engine.evaluate({
      activeParticipants: ['alice'],
      userZoneMap: { alice: 'active' },
      zoneRankMap,
      zoneInfoMap,
      totalCount: 1
    });
    expect(engine.phase).toBe('unlocked');

    // Path A: no-args → should stay unlocked
    engine.evaluate();
    expect(engine.phase).toBe('unlocked');

    // Path A again
    engine.evaluate();
    expect(engine.phase).toBe('unlocked');

    // Path B again
    engine.evaluate({
      activeParticipants: ['alice'],
      userZoneMap: { alice: 'active' },
      zoneRankMap,
      zoneInfoMap,
      totalCount: 1
    });
    expect(engine.phase).toBe('unlocked');

    // Should be exactly ONE phase change total: pending → unlocked
    expect(phaseChanges).toEqual(['unlocked']);
  });
});
