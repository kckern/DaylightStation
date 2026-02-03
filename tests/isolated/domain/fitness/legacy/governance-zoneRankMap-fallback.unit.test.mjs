import { describe, test, expect, jest, beforeEach } from '@jest/globals';

// Mock logger to suppress logging noise during tests
const mockSampled = jest.fn();
const mockInfo = jest.fn();
const mockWarn = jest.fn();
const mockDebug = jest.fn();
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ sampled: mockSampled, info: mockInfo, warn: mockWarn, debug: mockDebug }),
  getLogger: () => ({ sampled: mockSampled, info: mockInfo, warn: mockWarn, debug: mockDebug })
}));

describe('GovernanceEngine.evaluate() zoneRankMap fallback', () => {
  beforeEach(() => {
    mockSampled.mockClear();
    mockInfo.mockClear();
    mockWarn.mockClear();
    mockDebug.mockClear();
  });

  test('should reuse previous zoneRankMap when called without params', async () => {
    const mockGetProfile = jest.fn();
    const mockZoneProfileStore = { getProfile: mockGetProfile };

    const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

    const mockSession = {
      roster: [
        { id: 'user1', isActive: true, zoneId: 'active' }
      ],
      zoneProfileStore: mockZoneProfileStore,
      treasureBox: null
    };

    const engine = new GovernanceEngine(mockSession);
    engine.configure({
      governed_labels: ['workout'],
      policies: {
        'test-policy': {
          min_participants: 1,
          base_requirement: [{ active: 'all', grace_period_seconds: 30 }]
        }
      }
    });

    const zoneRankMap = { blue: 0, active: 1, warm: 2 };
    const zoneInfoMap = {
      blue: { id: 'blue', name: 'Blue' },
      active: { id: 'active', name: 'Active' },
      warm: { id: 'warm', name: 'Warm' }
    };

    // Set media with governed label
    engine.setMedia({ id: '123', labels: ['workout'] });

    // Simulate user in active zone
    mockGetProfile.mockReturnValue({ id: 'user1', currentZoneId: 'active' });

    // First call with zoneRankMap
    engine.evaluate({
      activeParticipants: ['user1'],
      userZoneMap: { user1: 'active' },
      zoneRankMap,
      zoneInfoMap,
      totalCount: 1
    });

    // Verify _latestInputs captured zoneRankMap
    expect(engine._latestInputs?.zoneRankMap).toEqual(zoneRankMap);

    // Second call WITHOUT zoneRankMap (simulating internal _triggerPulse call)
    engine.evaluate();

    // Should have reused zoneRankMap (not defaulted to {})
    // If it used empty zoneRankMap, requirements would be empty
    expect(engine._latestInputs?.zoneRankMap).toEqual(zoneRankMap);
  });

  test('should reuse previous zoneInfoMap when called without params', async () => {
    const mockGetProfile = jest.fn();
    const mockZoneProfileStore = { getProfile: mockGetProfile };

    const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

    const mockSession = {
      roster: [
        { id: 'user1', isActive: true, zoneId: 'warm' }
      ],
      zoneProfileStore: mockZoneProfileStore,
      treasureBox: null
    };

    const engine = new GovernanceEngine(mockSession);
    engine.configure({
      governed_labels: ['workout'],
      policies: {
        'test-policy': {
          min_participants: 1,
          base_requirement: [{ warm: 'all', grace_period_seconds: 30 }]
        }
      }
    });

    const zoneRankMap = { blue: 0, active: 1, warm: 2 };
    const zoneInfoMap = {
      blue: { id: 'blue', name: 'Blue' },
      active: { id: 'active', name: 'Active' },
      warm: { id: 'warm', name: 'Warm' }
    };

    engine.setMedia({ id: '123', labels: ['workout'] });

    // Simulate user in warm zone
    mockGetProfile.mockReturnValue({ id: 'user1', currentZoneId: 'warm' });

    // First call with zoneInfoMap
    engine.evaluate({
      activeParticipants: ['user1'],
      userZoneMap: { user1: 'warm' },
      zoneRankMap,
      zoneInfoMap,
      totalCount: 1
    });

    // Verify _latestInputs captured zoneInfoMap
    expect(engine._latestInputs?.zoneInfoMap).toEqual(zoneInfoMap);

    // Second call WITHOUT zoneInfoMap
    engine.evaluate();

    // Should have reused zoneInfoMap
    expect(engine._latestInputs?.zoneInfoMap).toEqual(zoneInfoMap);
  });
});
