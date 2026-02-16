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

describe('GovernanceEngine — grace period (replaces relock grace)', () => {
  it('should not have _relockGraceMs property', () => {
    const { engine } = createEngine();
    expect(engine._relockGraceMs).toBeUndefined();
  });

  it('should not have _lastUnlockTime property', () => {
    const { engine } = createEngine();
    expect(engine._lastUnlockTime).toBeUndefined();
  });

  it('should transition to warning (not locked) when requirements break after unlock', () => {
    const participants = ['alice'];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 30 });
    const evalOpts = (zones) => ({
      activeParticipants: participants,
      userZoneMap: zones,
      zoneRankMap,
      zoneInfoMap,
      totalCount: 1
    });

    // Get to unlocked
    engine.evaluate(evalOpts({ alice: 'active' }));
    expect(engine.phase).toBe('unlocked');

    // Requirements break — should go to warning (with grace period), not locked
    engine.evaluate(evalOpts({ alice: 'cool' }));
    expect(engine.phase).toBe('warning');
    expect(engine.meta.deadline).not.toBeNull();
    expect(engine.meta.gracePeriodTotal).toBe(30);
  });

  it('should go directly to locked when grace=0 and requirements break', () => {
    const participants = ['alice'];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants, grace: 0 });
    const evalOpts = (zones) => ({
      activeParticipants: participants,
      userZoneMap: zones,
      zoneRankMap,
      zoneInfoMap,
      totalCount: 1
    });

    // Get to unlocked
    engine.evaluate(evalOpts({ alice: 'active' }));
    expect(engine.phase).toBe('unlocked');

    // Requirements break with no grace → locked immediately
    engine.evaluate(evalOpts({ alice: 'cool' }));
    expect(engine.phase).toBe('locked');
  });

  it('should clear deadline and gracePeriodTotal on reset()', () => {
    const { engine } = createEngine();
    engine.meta.deadline = Date.now() + 30000;
    engine.meta.gracePeriodTotal = 30;
    engine.reset();
    expect(engine.meta.deadline).toBeNull();
    expect(engine.meta.gracePeriodTotal).toBeNull();
  });
});
