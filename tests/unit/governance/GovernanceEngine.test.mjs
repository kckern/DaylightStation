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

  describe('_normalizeRequiredCount() with exemptions', () => {
    let engine;

    beforeEach(() => {
      const mockSession = {
        roster: ['alice', 'bob', 'charlie', 'soren'],
        zoneProfileStore: null,
        snapshot: {
          zoneConfig: [
            { id: 'cool', name: 'Cool', color: '#0000ff' },
            { id: 'active', name: 'Active', color: '#00ff00' },
            { id: 'warm', name: 'Warm', color: '#ffaa00' },
            { id: 'hot', name: 'Hot', color: '#ff0000' },
            { id: 'fire', name: 'Fire', color: '#ff00ff' },
          ]
        }
      };
      engine = new GovernanceEngine(mockSession);
      engine.configure({
        governed_labels: ['exercise'],
        grace_period_seconds: 30,
        exemptions: ['soren']
      }, [], {});
    });

    it('should reduce requiredCount when exempt users are in activeParticipants', () => {
      const result = engine._normalizeRequiredCount(
        'all',
        4,
        ['alice', 'bob', 'charlie', 'soren']
      );
      expect(result).toBe(3);
    });

    it('should NOT reduce requiredCount when activeParticipants is empty (Bug A)', () => {
      const result = engine._normalizeRequiredCount('all', 4);
      expect(result).toBe(4);
    });
  });

  describe('challenge creation respects exemptions', () => {
    let engine;

    beforeEach(() => {
      const mockSession = {
        roster: ['alice', 'bob', 'charlie', 'soren'],
        zoneProfileStore: null,
        snapshot: {
          zoneConfig: [
            { id: 'cool', name: 'Cool', color: '#0000ff' },
            { id: 'active', name: 'Active', color: '#00ff00' },
            { id: 'warm', name: 'Warm', color: '#ffaa00' },
            { id: 'hot', name: 'Hot', color: '#ff0000' },
            { id: 'fire', name: 'Fire', color: '#ff00ff' },
          ]
        }
      };
      engine = new GovernanceEngine(mockSession);
      engine.configure({
        governed_labels: ['exercise'],
        grace_period_seconds: 30,
        exemptions: ['soren'],
        challenges: [{
          id: 'test-challenge',
          selections: [{ id: 's1', zone: 'hot', rule: 'all', timeAllowedSeconds: 90 }],
          intervalRangeSeconds: [60, 120]
        }]
      }, [], {});
    });

    it('should compute requiredCount excluding exempt users when creating challenge preview', () => {
      const activeParticipants = ['alice', 'bob', 'charlie', 'soren'];
      const userZoneMap = { alice: 'warm', bob: 'warm', charlie: 'warm', soren: 'cool' };
      const zoneRankMap = engine._latestInputs.zoneRankMap;
      const zoneInfoMap = engine._latestInputs.zoneInfoMap;
      const totalCount = 4;

      // Set engine to unlocked phase so challenges can trigger
      engine.phase = 'unlocked';
      engine.challengeState.activePolicyId = 'test-challenge';
      engine.challengeState.activePolicyName = 'test-challenge';
      engine.challengeState.nextChallenge = null;
      engine.challengeState.activeChallenge = null;
      engine.challengeState.nextChallengeAt = null;
      engine.challengeState.nextChallengeRemainingMs = null;

      // Build a minimal activePolicy matching the challenge config
      const activePolicy = {
        id: 'test-challenge',
        challenges: [{
          id: 'test-challenge',
          selections: [{ id: 's1', zone: 'hot', rule: 'all', timeAllowedSeconds: 90 }],
          intervalRangeSeconds: [60, 120]
        }]
      };

      // Directly call _evaluateChallenges — this is where the bug lives
      engine._evaluateChallenges(activePolicy, activeParticipants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount);

      const preview = engine.challengeState.nextChallenge;
      expect(preview).not.toBeNull();
      expect(preview.requiredCount).toBe(3); // NOT 4 — soren is exempt
    });
  });

  describe('buildChallengeSummary exemption filtering (Bug B)', () => {
    let engine;

    beforeEach(() => {
      const mockSession = {
        roster: ['alice', 'bob', 'charlie', 'soren'],
        zoneProfileStore: null,
        snapshot: {
          zoneConfig: [
            { id: 'cool', name: 'Cool', color: '#0000ff' },
            { id: 'active', name: 'Active', color: '#00ff00' },
            { id: 'warm', name: 'Warm', color: '#ffaa00' },
            { id: 'hot', name: 'Hot', color: '#ff0000' },
            { id: 'fire', name: 'Fire', color: '#ff00ff' },
          ]
        }
      };
      engine = new GovernanceEngine(mockSession);
      engine.configure({
        governed_labels: ['exercise'],
        grace_period_seconds: 30,
        exemptions: ['soren'],
        challenges: [{
          id: 'test-challenge',
          selections: [{ id: 's1', zone: 'hot', rule: 'all', timeAllowedSeconds: 90 }],
          intervalRangeSeconds: [60, 120]
        }]
      }, [], {});
    });

    it('should mark challenge as satisfied when all non-exempt users meet the zone', () => {
      const activeParticipants = ['alice', 'bob', 'charlie', 'soren'];
      const userZoneMap = { alice: 'hot', bob: 'hot', charlie: 'hot', soren: 'cool' };
      const zoneRankMap = engine._latestInputs.zoneRankMap;
      const zoneInfoMap = engine._latestInputs.zoneInfoMap;
      const totalCount = 4;

      engine.phase = 'unlocked';
      engine.challengeState.activePolicyId = 'test-challenge';
      engine.challengeState.activePolicyName = 'test-challenge';
      engine.challengeState.activeChallenge = {
        id: 'test_123',
        policyId: 'test-challenge',
        policyName: 'test-challenge',
        configId: 'test-challenge',
        selectionId: 's1',
        zone: 'hot',
        rule: 'all',
        requiredCount: 3,
        timeLimitSeconds: 90,
        startedAt: Date.now() - 10000,
        expiresAt: Date.now() + 80000,
        status: 'pending',
        historyRecorded: false,
        summary: null,
        pausedAt: null,
        pausedRemainingMs: null
      };

      const activePolicy = {
        id: 'test-challenge',
        challenges: [{
          id: 'test-challenge',
          selections: [{ id: 's1', zone: 'hot', rule: 'all', timeAllowedSeconds: 90 }],
          intervalRangeSeconds: [60, 120]
        }]
      };

      engine._evaluateChallenges(activePolicy, activeParticipants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount);

      const challenge = engine.challengeState.activeChallenge;
      expect(challenge.summary).not.toBeNull();
      expect(challenge.summary.satisfied).toBe(true);
      expect(challenge.summary.missingUsers).not.toContain('soren');
      expect(challenge.summary.metUsers).toEqual(expect.arrayContaining(['alice', 'bob', 'charlie']));
    });

    it('should not count exempt user as missing when they fail to meet zone', () => {
      const activeParticipants = ['alice', 'bob', 'charlie', 'soren'];
      const userZoneMap = { alice: 'hot', bob: 'hot', charlie: 'warm', soren: 'cool' };
      const zoneRankMap = engine._latestInputs.zoneRankMap;
      const zoneInfoMap = engine._latestInputs.zoneInfoMap;
      const totalCount = 4;

      engine.phase = 'unlocked';
      engine.challengeState.activePolicyId = 'test-challenge';
      engine.challengeState.activePolicyName = 'test-challenge';
      engine.challengeState.activeChallenge = {
        id: 'test_123',
        policyId: 'test-challenge',
        policyName: 'test-challenge',
        configId: 'test-challenge',
        selectionId: 's1',
        zone: 'hot',
        rule: 'all',
        requiredCount: 3,
        timeLimitSeconds: 90,
        startedAt: Date.now() - 10000,
        expiresAt: Date.now() + 80000,
        status: 'pending',
        historyRecorded: false,
        summary: null,
        pausedAt: null,
        pausedRemainingMs: null
      };

      const activePolicy = {
        id: 'test-challenge',
        challenges: [{
          id: 'test-challenge',
          selections: [{ id: 's1', zone: 'hot', rule: 'all', timeAllowedSeconds: 90 }],
          intervalRangeSeconds: [60, 120]
        }]
      };

      engine._evaluateChallenges(activePolicy, activeParticipants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount);

      const challenge = engine.challengeState.activeChallenge;
      expect(challenge.summary).not.toBeNull();
      expect(challenge.summary.satisfied).toBe(false);
      expect(challenge.summary.missingUsers).toEqual(['charlie']);
      expect(challenge.summary.missingUsers).not.toContain('soren');
    });
  });

  describe('challenge recovery after roster change', () => {
    let engine;

    beforeEach(() => {
      const mockSession = {
        roster: ['alice', 'bob', 'charlie', 'soren'],
        zoneProfileStore: null,
        snapshot: {
          zoneConfig: [
            { id: 'cool', name: 'Cool', color: '#0000ff' },
            { id: 'active', name: 'Active', color: '#00ff00' },
            { id: 'warm', name: 'Warm', color: '#ffaa00' },
            { id: 'hot', name: 'Hot', color: '#ff0000' },
            { id: 'fire', name: 'Fire', color: '#ff00ff' },
          ]
        }
      };
      engine = new GovernanceEngine(mockSession);
      engine.configure({
        governed_labels: ['exercise'],
        grace_period_seconds: 30,
        exemptions: ['soren'],
        challenges: [{
          id: 'test-challenge',
          selections: [{ id: 's1', zone: 'hot', rule: 'all', timeAllowedSeconds: 90 }],
          intervalRangeSeconds: [60, 120]
        }]
      }, [], {});
    });

    it('should recover from failed challenge when roster shrinks and remaining users meet zone', () => {
      // Scenario: challenge expired as failed with stale requiredCount=5.
      // User removes soren from roster. Now 3 non-exempt users all at hot.
      // The challenge should recover (satisfied=true) because buildChallengeSummary
      // now recomputes requiredCount live.
      const activeParticipants = ['alice', 'bob', 'charlie']; // soren removed
      const userZoneMap = { alice: 'hot', bob: 'hot', charlie: 'hot' };
      const zoneRankMap = engine._latestInputs.zoneRankMap;
      const zoneInfoMap = engine._latestInputs.zoneInfoMap;
      const totalCount = 3;

      engine.phase = 'unlocked';
      engine.challengeState.activePolicyId = 'test-challenge';
      engine.challengeState.activePolicyName = 'test-challenge';
      engine.challengeState.videoLocked = true;
      engine.challengeState.activeChallenge = {
        id: 'test_123',
        policyId: 'test-challenge',
        policyName: 'test-challenge',
        configId: 'test-challenge',
        selectionId: 's1',
        zone: 'hot',
        rule: 'all',
        requiredCount: 5, // Stale value from before exemption fix
        timeLimitSeconds: 90,
        startedAt: Date.now() - 100000,
        expiresAt: Date.now() - 10000, // expired
        status: 'failed',
        historyRecorded: false,
        summary: { satisfied: false, metUsers: ['alice', 'bob', 'charlie'], missingUsers: ['soren'], actualCount: 3, zoneLabel: 'Hot' },
        pausedAt: null,
        pausedRemainingMs: null
      };

      const activePolicy = {
        id: 'test-challenge',
        challenges: [{
          id: 'test-challenge',
          selections: [{ id: 's1', zone: 'hot', rule: 'all', timeAllowedSeconds: 90 }],
          intervalRangeSeconds: [60, 120]
        }]
      };

      engine._evaluateChallenges(activePolicy, activeParticipants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount);

      const challenge = engine.challengeState.activeChallenge;
      // With live recomputation, requiredCount should be 3 (all in roster, soren removed)
      // 3 met >= 3 required → satisfied → recovery
      expect(challenge.status).toBe('success');
      expect(engine.challengeState.videoLocked).toBe(false);
    });
  });
});
