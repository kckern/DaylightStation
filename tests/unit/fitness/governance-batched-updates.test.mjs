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

function createEngine({ participants = [] } = {}) {
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
    grace_period_seconds: 30,
  }, [{
    id: 'default',
    name: 'Default',
    minParticipants: 1,
    baseRequirement: { active: 'all', grace_period_seconds: 30 },
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

describe('Governance callbacks should not cause render amplification', () => {
  it('onPhaseChange fires synchronously during evaluate (consumer must batch)', () => {
    const participants = ['alice'];
    const { engine, zoneRankMap, zoneInfoMap } = createEngine({ participants });

    let phaseChangeCalls = 0;
    engine.setCallbacks({
      onPhaseChange: () => { phaseChangeCalls++; }
    });

    // Force a phase change by satisfying requirements with bypassed hysteresis
    engine._hysteresisMs = 0;
    engine.meta.satisfiedSince = Date.now() - 5000;
    engine.evaluate({
      activeParticipants: participants,
      userZoneMap: { alice: 'active' },
      zoneRankMap,
      zoneInfoMap,
      totalCount: 1
    });

    expect(engine.phase).toBe('unlocked');
    expect(phaseChangeCalls).toBeGreaterThan(0);
  });

  it('_invalidateStateCache batches onStateChange via microtask', async () => {
    const participants = ['alice'];
    const { engine } = createEngine({ participants });

    let stateChangeCalls = 0;
    engine.setCallbacks({
      onStateChange: () => { stateChangeCalls++; }
    });

    engine._invalidateStateCache();
    engine._invalidateStateCache();
    engine._invalidateStateCache();

    expect(stateChangeCalls).toBe(0);
    await new Promise(resolve => queueMicrotask(resolve));
    expect(stateChangeCalls).toBe(1);
  });
});
