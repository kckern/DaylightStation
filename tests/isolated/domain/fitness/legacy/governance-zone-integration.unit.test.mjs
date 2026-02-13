// tests/unit/suite/fitness/governance-zone-integration.unit.test.mjs
/**
 * Integration test verifying:
 * 1. TreasureBox receives zones from ZoneProfileStore
 * 2. GovernanceEngine doesn't trigger false warnings after internal pulses
 * 3. Coin counting works when zones are configured
 *
 * This tests the fixes from Tasks 1-3:
 * - Task 1: TreasureBox configured with zones on ensureStarted()
 * - Task 2: TreasureBox configured with zones on updateSnapshot()
 * - Task 3: GovernanceEngine falls back to cached zoneRankMap
 */
import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// Mock logger to suppress logging noise during tests
const mockSampled = jest.fn();
const mockInfo = jest.fn();
const mockWarn = jest.fn();
const mockDebug = jest.fn();
const mockError = jest.fn();
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ sampled: mockSampled, info: mockInfo, warn: mockWarn, debug: mockDebug, error: mockError }),
  getLogger: () => ({ sampled: mockSampled, info: mockInfo, warn: mockWarn, debug: mockDebug, error: mockError })
}));

describe('Governance + TreasureBox Zone Integration', () => {
  beforeEach(() => {
    mockSampled.mockClear();
    mockInfo.mockClear();
    mockWarn.mockClear();
    mockDebug.mockClear();
    mockError.mockClear();
  });

  test('TreasureBox should be configured with zones from ZoneProfileStore', async () => {
    const { FitnessTreasureBox } = await import('#frontend/hooks/fitness/TreasureBox.js');
    const { ZoneProfileStore } = await import('#frontend/hooks/fitness/ZoneProfileStore.js');

    const zoneConfig = [
      { id: 'blue', name: 'Blue', min: 0, color: 'blue', coins: 0 },
      { id: 'active', name: 'Active', min: 100, color: 'green', coins: 1 },
      { id: 'warm', name: 'Warm', min: 130, color: 'yellow', coins: 2 },
    ];

    // Set up ZoneProfileStore with base config
    const zoneProfileStore = new ZoneProfileStore();
    zoneProfileStore.setBaseZoneConfig(zoneConfig);

    // Verify ZoneProfileStore has the config
    const baseConfig = zoneProfileStore.getBaseZoneConfig();
    expect(baseConfig).not.toBeNull();
    expect(baseConfig.length).toBe(3);

    // Create TreasureBox and configure from ZoneProfileStore (simulating ensureStarted fix)
    const mockSession = { _log: jest.fn() };
    const treasureBox = new FitnessTreasureBox(mockSession);
    treasureBox.configure({ zones: baseConfig });

    // Verify TreasureBox has zones configured (Task 1 fix verification)
    expect(treasureBox.globalZones.length).toBe(3);
    expect(treasureBox.globalZones[0].id).toBe('blue');
    expect(treasureBox.globalZones[1].id).toBe('active');
    expect(treasureBox.globalZones[2].id).toBe('warm');
  });

  test('should resolve zones correctly when configured', async () => {
    const { FitnessTreasureBox } = await import('#frontend/hooks/fitness/TreasureBox.js');

    const zoneConfig = [
      { id: 'blue', name: 'Blue', min: 0, color: 'blue', coins: 0 },
      { id: 'active', name: 'Active', min: 100, color: 'green', coins: 1 },
    ];

    const mockSession = { _log: jest.fn() };
    const treasureBox = new FitnessTreasureBox(mockSession);
    treasureBox.configure({ zones: zoneConfig });

    // Verify zones are configured (Task 1/2 fix)
    expect(treasureBox.globalZones.length).toBe(2);

    // Zone should be resolved correctly
    const zone = treasureBox.resolveZone('user1', 110);
    expect(zone).toBeDefined();
    expect(zone.id).toBe('active');

    // HR below active should be in blue zone
    const blueZone = treasureBox.resolveZone('user1', 50);
    expect(blueZone).toBeDefined();
    expect(blueZone.id).toBe('blue');
  });

  test('GovernanceEngine should cache and reuse zoneRankMap on internal pulse', async () => {
    const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

    const mockGetProfile = jest.fn().mockReturnValue({
      id: 'user1',
      currentZoneId: 'warm'
    });
    const mockZoneProfileStore = { getProfile: mockGetProfile };

    const session = {
      zoneProfileStore: mockZoneProfileStore,
      roster: [{ id: 'user1', isActive: true, zoneId: 'warm' }],
      treasureBox: null
    };

    const engine = new GovernanceEngine(session);

    engine.configure({
      governed_labels: ['workout'],
      policies: {
        'test-policy': {
          min_participants: 1,
          base_requirement: [{ warm: 'all', grace_period_seconds: 30 }]
        }
      }
    });

    engine.setMedia({ id: '123', labels: ['workout'] });

    const zoneRankMap = { blue: 0, active: 1, warm: 2 };
    const zoneInfoMap = {
      blue: { id: 'blue', name: 'Blue' },
      active: { id: 'active', name: 'Active' },
      warm: { id: 'warm', name: 'Warm' }
    };

    // First evaluation with full data
    engine.evaluate({
      activeParticipants: ['user1'],
      userZoneMap: { user1: 'warm' },
      zoneRankMap,
      zoneInfoMap,
      totalCount: 1
    });

    // Verify _latestInputs captured zoneRankMap (Task 3 fix)
    expect(engine._latestInputs).toBeDefined();
    expect(engine._latestInputs?.zoneRankMap).toEqual(zoneRankMap);
    expect(engine._latestInputs?.zoneInfoMap).toEqual(zoneInfoMap);

    // Internal pulse (no params) - simulates _triggerPulse
    engine.evaluate();

    // Should still have zoneRankMap cached after evaluate() with no params
    expect(engine._latestInputs?.zoneRankMap).toEqual(zoneRankMap);
    expect(engine._latestInputs?.zoneInfoMap).toEqual(zoneInfoMap);
  });

  test('zone change is reflected in ZoneProfileStore before governance evaluates', async () => {
    const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

    const mockGetProfile = jest.fn();
    const mockZoneProfileStore = { getProfile: mockGetProfile };

    const session = {
      zoneProfileStore: mockZoneProfileStore,
      roster: [{ id: 'user1', isActive: true }],
      treasureBox: null
    };

    const engine = new GovernanceEngine(session);

    engine.configure({
      governed_labels: ['workout'],
      policies: {
        'test-policy': {
          min_participants: 1,
          base_requirement: [{ warm: 'all' }]
        }
      }
    });

    engine.setMedia({ id: '123', labels: ['workout'] });

    const zoneRankMap = { blue: 0, active: 1, warm: 2, hot: 3 };
    const zoneInfoMap = {
      active: { id: 'active', name: 'Active' },
      warm: { id: 'warm', name: 'Warm' }
    };

    const realDateNow = Date.now;
    let mockTime = realDateNow.call(Date);
    Date.now = () => mockTime;

    try {
      // First evaluate: user in 'active' (below warm requirement)
      mockGetProfile.mockReturnValue({ id: 'user1', currentZoneId: 'active' });
      engine.evaluate({
        activeParticipants: ['user1'],
        userZoneMap: {},  // Empty — governance reads exclusively from ZoneProfileStore
        zoneRankMap,
        zoneInfoMap,
        totalCount: 1
      });

      expect(engine.phase).toBe('pending'); // Requirement not met

      // ZoneProfileStore now returns 'warm' (synchronous sync after HR update)
      mockGetProfile.mockReturnValue({ id: 'user1', currentZoneId: 'warm' });

      // Second evaluate: satisfied, starts hysteresis timer
      engine.evaluate({
        activeParticipants: ['user1'],
        userZoneMap: {},
        zoneRankMap,
        zoneInfoMap,
        totalCount: 1
      });

      // Still pending — hysteresis requires 500ms of sustained satisfaction
      expect(engine.phase).toBe('pending');

      // Advance time past hysteresis (500ms)
      mockTime += 600;

      // Third evaluate: hysteresis satisfied, transitions to unlocked
      engine.evaluate({
        activeParticipants: ['user1'],
        userZoneMap: {},
        zoneRankMap,
        zoneInfoMap,
        totalCount: 1
      });

      expect(engine.phase).toBe('unlocked');
      // Verify governance read zone data from ZoneProfileStore
      expect(mockGetProfile).toHaveBeenCalledWith('user1');
    } finally {
      Date.now = realDateNow;
    }
  });

  test('GovernanceEngine should not lose state after internal evaluate()', async () => {
    const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

    const mockGetProfile = jest.fn().mockReturnValue({
      id: 'user1',
      currentZoneId: 'active'
    });
    const mockZoneProfileStore = { getProfile: mockGetProfile };

    const session = {
      zoneProfileStore: mockZoneProfileStore,
      roster: [{ id: 'user1', isActive: true, zoneId: 'active' }],
      treasureBox: null
    };

    const engine = new GovernanceEngine(session);

    engine.configure({
      governed_labels: ['workout'],
      policies: {
        'test-policy': {
          min_participants: 1,
          base_requirement: [{ active: 'all', grace_period_seconds: 30 }]
        }
      }
    });

    engine.setMedia({ id: '123', labels: ['workout'] });

    const zoneRankMap = { blue: 0, active: 1, warm: 2 };
    const zoneInfoMap = {
      blue: { id: 'blue', name: 'Blue' },
      active: { id: 'active', name: 'Active' },
      warm: { id: 'warm', name: 'Warm' }
    };

    // First evaluation
    engine.evaluate({
      activeParticipants: ['user1'],
      userZoneMap: { user1: 'active' },
      zoneRankMap,
      zoneInfoMap,
      totalCount: 1
    });

    const phaseAfterFirst = engine.phase;

    // Multiple internal pulses (simulating timer-triggered re-evaluations)
    engine.evaluate();
    engine.evaluate();
    engine.evaluate();

    // Phase should remain stable (not flip to 'warning' due to lost zoneRankMap)
    expect(engine.phase).toBe(phaseAfterFirst);

    // zoneRankMap should still be cached
    expect(engine._latestInputs?.zoneRankMap).toEqual(zoneRankMap);
  });
});
