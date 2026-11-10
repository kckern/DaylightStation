import { describe, it, expect, vi } from 'vitest';

vi.mock('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(),
    error: vi.fn(), sampled: vi.fn()
  }),
  getLogger: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(),
    error: vi.fn(), sampled: vi.fn()
  })
}));

const { GovernanceEngine } = await import("../../../__app_modules/wellness/fitness/browser/hooks/fitness/GovernanceEngine.js");

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

describe('GovernanceEngine — participants without zone data (no ghost filter)', () => {
  it('should keep active participants with no zone data in governance evaluation (no ghost filter)', () => {
    // Contract since 15afc57498: the ghost filter (zone-data presence as an
    // activity proxy) was removed. isActive from ParticipantRoster is the
    // authority — a connected participant whose zone has not arrived yet is
    // still a participant, so 'all active' is NOT met on the other two alone.
    const participants = ['alice', 'bob', 'ghost'];
    // ghost has no entry in userZoneMap — zone not yet known, but roster says isActive
    const userZoneMap = { alice: 'active', bob: 'active' };
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });

    engine.evaluate({ activeParticipants: participants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount: 3 });

    expect(engine.requirementSummary?.activeCount).toBe(3);
    const allMissing = (engine.requirementSummary?.requirements || [])
      .flatMap(r => r.missingUsers || []);
    expect(allMissing).toContain('ghost');
    expect(allMissing).not.toContain('alice');
    expect(allMissing).not.toContain('bob');

    const allSatisfied = (engine.requirementSummary?.requirements || [])
      .every(r => r.satisfied);
    expect(allSatisfied).toBe(false);
    expect(engine.phase).toBe('pending');
  });

  it('should drop a participant the roster marks inactive (isActive is the authority)', () => {
    const participants = ['alice', 'bob', 'ghost'];
    const userZoneMap = { alice: 'active', bob: 'active' };
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });
    engine.session.roster.find(e => e.id === 'ghost').isActive = false;

    engine.evaluate({ activeParticipants: participants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount: 3 });

    const allMissing = (engine.requirementSummary?.requirements || [])
      .flatMap(r => r.missingUsers || []);
    expect(allMissing).not.toContain('ghost');
    expect(engine.requirementSummary?.activeCount).toBe(2);
    expect(engine.phase).toBe('unlocked');
  });

  it('should not filter participants who have zone data', () => {
    const participants = ['alice', 'bob'];
    const userZoneMap = { alice: 'active', bob: 'cool' };
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });

    engine.meta.satisfiedOnce = true;
    engine.evaluate({ activeParticipants: participants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount: 2 });

    // bob is in cool (below active) — should appear as missing
    const allMissing = (engine.requirementSummary?.requirements || [])
      .flatMap(r => r.missingUsers || []);
    expect(allMissing).toContain('bob');
  });
});
