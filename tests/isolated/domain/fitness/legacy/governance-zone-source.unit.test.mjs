import { jest } from '@jest/globals';

// Mock ZoneProfileStore
const mockGetProfile = jest.fn();
const mockZoneProfileStore = {
  getProfile: mockGetProfile
};

// Mock session with zoneProfileStore
const createMockSession = (zoneProfileStore) => ({
  zoneProfileStore,
  roster: [],
  treasureBox: null
});

// Mock logger
const mockSampled = jest.fn();
const mockInfo = jest.fn();
const mockWarn = jest.fn();
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ sampled: mockSampled, info: mockInfo, warn: mockWarn }),
  getLogger: () => ({ sampled: mockSampled, info: mockInfo, warn: mockWarn })
}));

const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine zone source', () => {
  beforeEach(() => {
    mockGetProfile.mockClear();
    mockSampled.mockClear();
    mockInfo.mockClear();
    mockWarn.mockClear();
  });

  test('reads zone state from ZoneProfileStore, not TreasureBox', async () => {
    // Setup: ZoneProfileStore returns 'warm' for user
    mockGetProfile.mockReturnValue({
      id: 'user-1',
      currentZoneId: 'warm',
      currentZoneColor: 'yellow'
    });

    const session = createMockSession(mockZoneProfileStore);
    const engine = new GovernanceEngine(session);

    // Configure with a policy requiring 'warm' zone
    engine.configure({
      governed_labels: ['fitness'],
      policies: {
        'test-policy': {
          min_participants: 1,
          base_requirement: [{ warm: 'all' }]
        }
      }
    });

    engine.setMedia({ id: 'test', labels: ['fitness'] });

    // Evaluate with one active participant
    // Pass empty userZoneMap - GovernanceEngine should populate from ZoneProfileStore
    engine.evaluate({
      activeParticipants: ['user-1'],
      userZoneMap: {}, // Empty - should be populated from ZoneProfileStore
      zoneRankMap: { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 },
      zoneInfoMap: { warm: { id: 'warm', name: 'Warm', color: 'yellow' } },
      totalCount: 1
    });

    // Verify ZoneProfileStore was consulted
    expect(mockGetProfile).toHaveBeenCalledWith('user-1');

    // Verify phase is unlocked (requirement satisfied via ZoneProfileStore)
    expect(engine.phase).toBe('unlocked');
  });

  test('governance phase changes when ZoneProfileStore reports new zone', async () => {
    // ZoneProfileStore is the single source of truth for zone state.
    // Governance phase changes when the store reports a different zone.

    mockGetProfile
      .mockReturnValueOnce({ id: 'user-1', currentZoneId: 'active' }) // First tick
      .mockReturnValueOnce({ id: 'user-1', currentZoneId: 'warm' });  // Second tick

    const session = createMockSession(mockZoneProfileStore);
    const engine = new GovernanceEngine(session);

    engine.configure({
      governed_labels: ['fitness'],
      policies: {
        'test-policy': {
          min_participants: 1,
          base_requirement: [{ warm: 'all' }]
        }
      }
    });

    engine.setMedia({ id: 'test', labels: ['fitness'] });

    const zoneRankMap = { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 };
    const zoneInfoMap = { warm: { id: 'warm', name: 'Warm' } };

    // First evaluation - user in 'active' zone (below warm)
    engine.evaluate({
      activeParticipants: ['user-1'],
      userZoneMap: {},
      zoneRankMap,
      zoneInfoMap,
      totalCount: 1
    });

    expect(engine.phase).toBe('pending'); // Not satisfied yet

    // Second evaluation (simulating next tick) - user now in 'warm' zone
    engine.evaluate({
      activeParticipants: ['user-1'],
      userZoneMap: {},
      zoneRankMap,
      zoneInfoMap,
      totalCount: 1
    });

    expect(engine.phase).toBe('unlocked'); // Now satisfied
  });
});
