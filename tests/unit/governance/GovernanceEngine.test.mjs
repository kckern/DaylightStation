// tests/unit/governance/GovernanceEngine.test.mjs
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock the Logger module before importing GovernanceEngine
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    sampled: jest.fn()
  }),
  getLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    sampled: jest.fn()
  })
}));

// Import GovernanceEngine after mocking
const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine', () => {
  describe('configure()', () => {
    it('should seed _latestInputs with zone maps from session', () => {
      const mockSession = {
        roster: [],
        zoneProfileStore: null,
        snapshot: {
          zoneConfig: [
            { id: 'active', name: 'Active', color: '#ff0000' },
            { id: 'warm', name: 'Warm Up', color: '#ffaa00' },
          ]
        }
      };

      const engine = new GovernanceEngine(mockSession);
      engine.configure({
        governed_labels: ['exercise'],
        grace_period_seconds: 30
      }, [], {});

      // Zone maps should be seeded from session.snapshot.zoneConfig
      expect(Object.keys(engine._latestInputs.zoneInfoMap)).toContain('active');
      expect(engine._latestInputs.zoneInfoMap.active.name).toBe('Active');
      expect(Object.keys(engine._latestInputs.zoneRankMap)).toContain('active');
      expect(engine._latestInputs.zoneRankMap.active).toBe(0);
    });

    it('should seed zone maps with correct ranks based on order', () => {
      const mockSession = {
        roster: [],
        zoneProfileStore: null,
        snapshot: {
          zoneConfig: [
            { id: 'rest', name: 'Rest', color: '#cccccc' },
            { id: 'warm', name: 'Warm Up', color: '#ffaa00' },
            { id: 'active', name: 'Active', color: '#ff0000' },
            { id: 'peak', name: 'Peak', color: '#ff00ff' },
          ]
        }
      };

      const engine = new GovernanceEngine(mockSession);
      engine.configure({
        governed_labels: ['exercise'],
        grace_period_seconds: 30
      }, [], {});

      // Verify ranks are assigned in order (0, 1, 2, 3)
      expect(engine._latestInputs.zoneRankMap.rest).toBe(0);
      expect(engine._latestInputs.zoneRankMap.warm).toBe(1);
      expect(engine._latestInputs.zoneRankMap.active).toBe(2);
      expect(engine._latestInputs.zoneRankMap.peak).toBe(3);
    });

    it('should handle missing zoneConfig gracefully', () => {
      const mockSession = {
        roster: [],
        zoneProfileStore: null,
        snapshot: {}
      };

      const engine = new GovernanceEngine(mockSession);
      engine.configure({
        governed_labels: ['exercise'],
        grace_period_seconds: 30
      }, [], {});

      // Should not throw, and maps should remain empty
      expect(Object.keys(engine._latestInputs.zoneInfoMap)).toHaveLength(0);
      expect(Object.keys(engine._latestInputs.zoneRankMap)).toHaveLength(0);
    });

    it('should normalize zone IDs to lowercase', () => {
      const mockSession = {
        roster: [],
        zoneProfileStore: null,
        snapshot: {
          zoneConfig: [
            { id: 'ACTIVE', name: 'Active', color: '#ff0000' },
            { id: 'WarmUp', name: 'Warm Up', color: '#ffaa00' },
          ]
        }
      };

      const engine = new GovernanceEngine(mockSession);
      engine.configure({
        governed_labels: ['exercise'],
        grace_period_seconds: 30
      }, [], {});

      // Zone IDs should be normalized to lowercase
      expect(engine._latestInputs.zoneInfoMap['active']).toBeDefined();
      expect(engine._latestInputs.zoneInfoMap['warmup']).toBeDefined();
      expect(engine._latestInputs.zoneInfoMap['ACTIVE']).toBeUndefined();
    });
  });
});
