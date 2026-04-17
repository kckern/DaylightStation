import { describe, it, expect, jest } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));

const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine equipmentCadenceMap input', () => {
  it('stores cadence map on evaluate', () => {
    const engine = new GovernanceEngine(null);
    engine.evaluate({
      activeParticipants: ['alice'],
      userZoneMap: { alice: 'active' },
      zoneRankMap: { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 },
      zoneInfoMap: {},
      totalCount: 1,
      equipmentCadenceMap: { cycle_ace: { rpm: 72, connected: true } }
    });
    expect(engine._latestInputs.equipmentCadenceMap).toEqual({
      cycle_ace: { rpm: 72, connected: true }
    });
  });

  it('defaults to empty object when not provided', () => {
    const engine = new GovernanceEngine(null);
    engine.evaluate({
      activeParticipants: [],
      userZoneMap: {},
      zoneRankMap: {},
      zoneInfoMap: {},
      totalCount: 0
    });
    expect(engine._latestInputs.equipmentCadenceMap).toEqual({});
  });

  it('constructor initializes empty equipmentCadenceMap in _latestInputs', () => {
    const engine = new GovernanceEngine(null);
    expect(engine._latestInputs.equipmentCadenceMap).toEqual({});
  });
});
