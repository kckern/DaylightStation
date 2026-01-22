import { describe, test, expect, jest, beforeEach } from '@jest/globals';

// Mock logger to suppress logging noise during tests
const mockSampled = jest.fn();
const mockInfo = jest.fn();
const mockWarn = jest.fn();
jest.unstable_mockModule('@frontend/lib/logging/Logger.js', () => ({
  default: () => ({ sampled: mockSampled, info: mockInfo, warn: mockWarn }),
  getLogger: () => ({ sampled: mockSampled, info: mockInfo, warn: mockWarn })
}));

describe('GovernanceEngine phase stability', () => {
  beforeEach(() => {
    mockSampled.mockClear();
    mockInfo.mockClear();
    mockWarn.mockClear();
  });

  test('phase cannot cycle faster than tick interval (5 seconds)', async () => {
    const mockGetProfile = jest.fn();
    const mockZoneProfileStore = { getProfile: mockGetProfile };

    const { GovernanceEngine } = await import('@frontend/hooks/fitness/GovernanceEngine.js');

    const session = {
      zoneProfileStore: mockZoneProfileStore,
      roster: [],
      treasureBox: null
    };

    const engine = new GovernanceEngine(session);

    engine.configure({
      governed_labels: ['fitness'],
      policies: {
        'test-policy': {
          min_participants: 1,
          base_requirement: [{ warm: 'all', grace_period_seconds: 10 }]
        }
      }
    });

    engine.setMedia({ id: 'test', labels: ['fitness'] });

    const zoneRankMap = { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 };
    const zoneInfoMap = {
      warm: { id: 'warm', name: 'Warm' },
      active: { id: 'active', name: 'Active' }
    };

    // Simulate: User starts in warm zone
    mockGetProfile.mockReturnValue({ id: 'user-1', currentZoneId: 'warm' });

    engine.evaluate({
      activeParticipants: ['user-1'],
      userZoneMap: {},
      zoneRankMap,
      zoneInfoMap,
      totalCount: 1
    });

    expect(engine.phase).toBe('unlocked');
    const phaseHistory = [engine.phase];

    // Simulate: 10 rapid evaluations within same "tick"
    for (let i = 0; i < 10; i++) {
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: {},
        zoneRankMap,
        zoneInfoMap,
        totalCount: 1
      });
      phaseHistory.push(engine.phase);
    }

    // Verify: Phase stayed stable (all 'unlocked')
    expect(phaseHistory.every(p => p === 'unlocked')).toBe(true);

    // Simulate: Next tick - ZoneProfileStore now returns 'active' (below warm)
    mockGetProfile.mockReturnValue({ id: 'user-1', currentZoneId: 'active' });

    engine.evaluate({
      activeParticipants: ['user-1'],
      userZoneMap: {},
      zoneRankMap,
      zoneInfoMap,
      totalCount: 1
    });

    // NOW phase changes (at tick boundary)
    expect(engine.phase).toBe('warning');
  });

  test('TreasureBox zone changes do not trigger governance evaluation', async () => {
    const { FitnessTreasureBox } = await import('@frontend/hooks/fitness/TreasureBox.js');

    const mockSession = { _log: jest.fn() };
    const box = new FitnessTreasureBox(mockSession);

    // Setup zones
    box.configure({
      coinTimeUnitMs: 5000,
      zones: [
        { id: 'active', name: 'Active', min: 100, color: 'blue', coins: 1 },
        { id: 'warm', name: 'Warm', min: 140, color: 'yellow', coins: 2 }
      ]
    });

    // Set a governance callback (should be ignored now)
    const governanceCallback = jest.fn();
    box.setGovernanceCallback(governanceCallback);

    // Record HR readings that would have triggered zone changes
    box.recordUserHeartRate('user-1', 130); // active zone
    box.recordUserHeartRate('user-1', 145); // warm zone (zone change!)
    box.recordUserHeartRate('user-1', 135); // back to active (zone change!)

    // Verify: Governance callback was NOT called
    expect(governanceCallback).not.toHaveBeenCalled();
  });
});
