/**
 * TreasureBox Zone Configuration Tests
 *
 * Tests that TreasureBox receives zone configuration when created in FitnessSession.ensureStarted().
 *
 * Bug context: Previously, TreasureBox zone configuration relied on React effect timing
 * in FitnessContext. If TreasureBox was created after the effect ran, zones were never
 * configured, causing:
 * - Zero coin counting (globalZones empty)
 * - False governance warnings (empty zoneRankMap)
 */

import { jest, describe, it, expect, beforeAll, beforeEach, afterEach } from '@jest/globals';

// Mock the logger to avoid console noise
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    sampled: jest.fn()
  }),
  getLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    sampled: jest.fn()
  })
}));

// Mock DaylightAPI to prevent network calls
jest.unstable_mockModule('#frontend/lib/api.mjs', () => ({
  DaylightAPI: {
    postFitnessSession: jest.fn().mockResolvedValue({ success: true }),
    postSessionSnapshot: jest.fn().mockResolvedValue({ success: true })
  }
}));

// Mock moment-timezone to avoid timezone issues in tests
jest.unstable_mockModule('moment-timezone', () => {
  const moment = (val) => ({
    tz: () => ({ format: () => '2024-01-01 12:00:00 pm' }),
    format: () => '2024-01-01 12:00:00 pm'
  });
  moment.tz = {
    guess: () => 'America/New_York'
  };
  return { default: moment };
});

describe('FitnessSession.ensureStarted()', () => {
  let FitnessSession;

  beforeAll(async () => {
    const module = await import('#frontend/hooks/fitness/FitnessSession.js');
    FitnessSession = module.FitnessSession;
  });

  describe('TreasureBox zone configuration', () => {
    let session;

    beforeEach(() => {
      session = new FitnessSession();
    });

    afterEach(() => {
      // Clean up timers
      if (session?.endSession) {
        try {
          session.endSession({ reason: 'test_cleanup' });
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    });

    it('should configure TreasureBox with zones from zoneProfileStore', () => {
      const mockZoneConfig = [
        { id: 'blue', name: 'Blue', min: 0, color: 'blue', coins: 0 },
        { id: 'active', name: 'Active', min: 100, color: 'green', coins: 1 },
        { id: 'warm', name: 'Warm', min: 120, color: 'yellow', coins: 2 },
      ];

      // Simulate zone config being available via zoneProfileStore
      // (In production, this is set via updateSnapshot before ensureStarted)
      session.zoneProfileStore.setBaseZoneConfig(mockZoneConfig);

      // Start session with force=true to bypass pre-session buffer check
      session.ensureStarted({ reason: 'test', force: true });

      // Verify TreasureBox has zones configured
      expect(session.treasureBox).toBeDefined();
      expect(session.treasureBox.globalZones.length).toBe(3);
      expect(session.treasureBox.globalZones[0].id).toBe('blue');
      expect(session.treasureBox.globalZones[1].id).toBe('active');
      expect(session.treasureBox.globalZones[2].id).toBe('warm');
    });

    it('should configure TreasureBox with coin values from zone config', () => {
      const mockZoneConfig = [
        { id: 'cool', name: 'Cool', min: 0, color: 'blue', coins: 0 },
        { id: 'active', name: 'Active', min: 100, color: 'green', coins: 1 },
        { id: 'warm', name: 'Warm', min: 130, color: 'orange', coins: 2 },
        { id: 'hot', name: 'Hot', min: 150, color: 'red', coins: 3 },
      ];

      session.zoneProfileStore.setBaseZoneConfig(mockZoneConfig);
      session.ensureStarted({ reason: 'test', force: true });

      // Verify coin values are preserved
      expect(session.treasureBox.globalZones[0].coins).toBe(0);
      expect(session.treasureBox.globalZones[1].coins).toBe(1);
      expect(session.treasureBox.globalZones[2].coins).toBe(2);
      expect(session.treasureBox.globalZones[3].coins).toBe(3);
    });

    it('should handle missing zoneConfig gracefully', () => {
      // No zone config set - zoneProfileStore has no base config

      // Should not throw
      session.ensureStarted({ reason: 'test', force: true });

      expect(session.treasureBox).toBeDefined();
      expect(session.treasureBox.globalZones.length).toBe(0);
    });

    it('should handle empty zoneConfig array gracefully', () => {
      session.zoneProfileStore.setBaseZoneConfig([]);

      // Should not throw
      session.ensureStarted({ reason: 'test', force: true });

      expect(session.treasureBox).toBeDefined();
      expect(session.treasureBox.globalZones.length).toBe(0);
    });

    it('should sort zones by min threshold ascending', () => {
      // Zones provided out of order
      const mockZoneConfig = [
        { id: 'warm', name: 'Warm', min: 130, color: 'orange', coins: 2 },
        { id: 'cool', name: 'Cool', min: 0, color: 'blue', coins: 0 },
        { id: 'hot', name: 'Hot', min: 150, color: 'red', coins: 3 },
        { id: 'active', name: 'Active', min: 100, color: 'green', coins: 1 },
      ];

      session.zoneProfileStore.setBaseZoneConfig(mockZoneConfig);
      session.ensureStarted({ reason: 'test', force: true });

      // Should be sorted by min ascending
      expect(session.treasureBox.globalZones[0].min).toBe(0);
      expect(session.treasureBox.globalZones[1].min).toBe(100);
      expect(session.treasureBox.globalZones[2].min).toBe(130);
      expect(session.treasureBox.globalZones[3].min).toBe(150);
    });
  });
});

describe('FitnessSession.updateSnapshot()', () => {
  let FitnessSession;

  beforeAll(async () => {
    const module = await import('#frontend/hooks/fitness/FitnessSession.js');
    FitnessSession = module.FitnessSession;
  });

  describe('TreasureBox zone configuration propagation', () => {
    let session;

    beforeEach(() => {
      session = new FitnessSession();
    });

    afterEach(() => {
      // Clean up timers
      if (session?.endSession) {
        try {
          session.endSession({ reason: 'test_cleanup' });
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    });

    it('should configure TreasureBox when zoneConfig is updated', () => {
      session.ensureStarted({ reason: 'test', force: true });

      // Initially no zones
      expect(session.treasureBox.globalZones.length).toBe(0);

      // Update snapshot with zones
      const mockZoneConfig = [
        { id: 'blue', name: 'Blue', min: 0, color: 'blue', coins: 0 },
        { id: 'active', name: 'Active', min: 100, color: 'green', coins: 1 },
      ];

      session.updateSnapshot({ zoneConfig: mockZoneConfig });

      // TreasureBox should now have zones
      expect(session.treasureBox.globalZones.length).toBe(2);
    });
  });
});
