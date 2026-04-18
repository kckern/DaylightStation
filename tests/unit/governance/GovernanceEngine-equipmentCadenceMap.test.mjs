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

  it('preserves equipmentCadenceMap across _resetToIdle', () => {
    const engine = new GovernanceEngine(null);
    // Seed a cadence map via evaluate() (no media/rules -> falls through to _resetToIdle,
    // but the map is captured into _latestInputs before that happens).
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

    // Directly invoke the idle reset and verify the map survives.
    engine._resetToIdle();
    expect(engine._latestInputs.equipmentCadenceMap).toEqual({
      cycle_ace: { rpm: 72, connected: true }
    });
  });

  it('stores equipmentCadenceMap in no-participant early-exit path', () => {
    const engine = new GovernanceEngine(null);
    // Configure with a governed label and a policy so the no-participant early-exit
    // branch is reached (instead of the no-media/no-rules branch that routes to idle).
    engine.configure(
      {
        governed_labels: ['fitness'],
        policies: {
          basic: {
            min_participants: 1,
            base_requirement: [{ zone: 'active' }]
          }
        }
      },
      null,
      {}
    );
    engine.setMedia({ id: 'media-1', labels: ['fitness'] });

    engine.evaluate({
      activeParticipants: [],
      userZoneMap: {},
      zoneRankMap: { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 },
      zoneInfoMap: { active: { id: 'active', name: 'Active', color: null } },
      totalCount: 0,
      equipmentCadenceMap: { cycle_ace: { rpm: 72, connected: true } }
    });

    expect(engine._latestInputs.activeParticipants).toEqual([]);
    expect(engine._latestInputs.equipmentCadenceMap).toEqual({
      cycle_ace: { rpm: 72, connected: true }
    });
  });
});
