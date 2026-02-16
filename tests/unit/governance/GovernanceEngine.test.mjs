// tests/unit/governance/GovernanceEngine.test.mjs
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

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

    afterEach(() => {
      engine.destroy();
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

    afterEach(() => {
      engine.destroy();
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

    afterEach(() => {
      engine.destroy();
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

    afterEach(() => {
      engine.destroy();
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

  describe('videoLocked in _composeState()', () => {
    let engine;

    beforeEach(() => {
      const mockSession = {
        roster: ['alice'],
        zoneProfileStore: null,
        snapshot: {
          zoneConfig: [
            { id: 'active', name: 'Active', color: '#ff0000' },
          ]
        }
      };
      engine = new GovernanceEngine(mockSession);
      engine.configure({
        governed_labels: ['kidsfun'],
        grace_period_seconds: 30
      }, [], {});
    });

    afterEach(() => {
      engine.destroy();
    });

    it('should set videoLocked=true when media is governed and phase is pending', () => {
      engine.setMedia({ id: 'plex:603409', labels: ['kidsfun'], type: 'episode' });
      engine.phase = 'pending';

      const state = engine._composeState();
      expect(state.videoLocked).toBe(true);
    });

    it('should set videoLocked=true when media is governed and phase is locked', () => {
      engine.setMedia({ id: 'plex:603409', labels: ['kidsfun'], type: 'episode' });
      engine.phase = 'locked';

      const state = engine._composeState();
      expect(state.videoLocked).toBe(true);
    });

    it('should NOT set videoLocked when media is governed and phase is unlocked', () => {
      engine.setMedia({ id: 'plex:603409', labels: ['kidsfun'], type: 'episode' });
      engine.phase = 'unlocked';

      const state = engine._composeState();
      expect(state.videoLocked).toBe(false);
    });

    it('should NOT set videoLocked when media is NOT governed and phase is pending', () => {
      engine.setMedia({ id: 'plex:999', labels: ['documentary'], type: 'movie' });
      engine.phase = 'pending';

      const state = engine._composeState();
      expect(state.videoLocked).toBe(false);
    });

    it('should set videoLocked=true when media is governed and phase is null (idle)', () => {
      engine.setMedia({ id: 'plex:603409', labels: ['kidsfun'], type: 'episode' });
      engine.phase = null;

      const state = engine._composeState();
      expect(state.videoLocked).toBe(true);
    });

    it('should NOT set videoLocked when media is governed and phase is warning', () => {
      engine.setMedia({ id: 'plex:603409', labels: ['kidsfun'], type: 'episode' });
      engine.phase = 'warning';

      const state = engine._composeState();
      expect(state.videoLocked).toBe(false);
    });

    it('should NOT set videoLocked when media is NOT governed and phase is null', () => {
      engine.setMedia({ id: 'plex:999', labels: ['documentary'], type: 'movie' });
      engine.phase = null;

      const state = engine._composeState();
      expect(state.videoLocked).toBe(false);
    });
  });

  describe('state.videoLocked as autoplay SSoT', () => {
    // These tests confirm videoLocked is the correct single source for autoplay decisions.
    // FitnessPlayer.playObject should use !governanceState.videoLocked for canAutoplay
    // instead of locally re-deriving mediaGoverned from labels/types.

    let engine;
    // Mutable zone so individual tests can control what zoneProfileStore returns
    let currentZone = 'cool';
    const mockSession = {
      roster: [{ id: 'user1', isActive: true, heartRate: 80 }],
      zoneProfileStore: {
        getProfile: () => ({ currentZoneId: currentZone })
      },
      snapshot: {
        zoneConfig: [
          { id: 'cool', name: 'Cool', color: '#00f' },
          { id: 'active', name: 'Active', color: '#f00' }
        ]
      }
    };

    beforeEach(() => {
      currentZone = 'cool'; // Reset to default
      engine = new GovernanceEngine(mockSession);
      engine.configure({
        governed_labels: ['exercise'],
        governed_types: ['workout'],
        grace_period_seconds: 30,
        policies: {
          default: {
            min_participants: 1,
            base_requirement: [{ active: 'all' }],
            challenges: []
          }
        }
      }, [], {});
    });

    afterEach(() => {
      engine.destroy();
    });

    it('videoLocked=true when governed media in pending phase (no HR data)', () => {
      engine.setMedia({ id: 'test-1', labels: ['exercise'], type: 'video' });
      engine.evaluate({
        activeParticipants: ['user1'],
        userZoneMap: { user1: 'cool' },
        zoneRankMap: { cool: 0, active: 1 },
        zoneInfoMap: { cool: { id: 'cool', name: 'Cool' }, active: { id: 'active', name: 'Active' } },
        totalCount: 1
      });

      expect(engine.phase).toBe('pending');
      expect(engine.state.videoLocked).toBe(true);
    });

    it('videoLocked=false when governed media in unlocked phase', () => {
      engine.setMedia({ id: 'test-2', labels: ['exercise'], type: 'video' });
      // Update mock zoneProfileStore to return 'active' zone
      currentZone = 'active';
      // Satisfy requirements: user in 'active' zone meets 'active: all' requirement
      engine.evaluate({
        activeParticipants: ['user1'],
        userZoneMap: { user1: 'active' },
        zoneRankMap: { cool: 0, active: 1 },
        zoneInfoMap: { cool: { id: 'cool', name: 'Cool' }, active: { id: 'active', name: 'Active' } },
        totalCount: 1
      });
      expect(engine.phase).toBe('unlocked');
      expect(engine.state.videoLocked).toBe(false);
    });

    it('videoLocked=false when media is NOT governed', () => {
      engine.setMedia({ id: 'test-3', labels: ['comedy'], type: 'movie' });
      // Non-governed media should never lock
      const state = engine.state;
      expect(state.videoLocked).toBe(false);
      expect(state.isGoverned).toBe(false);
    });

    it('isGoverned reflects _mediaIsGoverned() for label match', () => {
      engine.setMedia({ id: 'test-4', labels: ['exercise'], type: 'video' });
      expect(engine.state.isGoverned).toBe(true);
    });

    it('isGoverned reflects _mediaIsGoverned() for type match', () => {
      engine.setMedia({ id: 'test-5', labels: [], type: 'workout' });
      expect(engine.state.isGoverned).toBe(true);
    });
  });

  describe('_evaluateChallenges() minParticipants guard', () => {
    let engine;

    beforeEach(() => {
      jest.useFakeTimers();
      engine = new GovernanceEngine({
        roster: [],
        zoneProfileStore: null,
        snapshot: {
          zoneConfig: [
            { id: 'cool', name: 'Cool', color: '#94a3b8' },
            { id: 'active', name: 'Active', color: '#22c55e' },
            { id: 'warm', name: 'Warm Up', color: '#eab308' },
          ]
        }
      });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should NOT start a challenge when totalCount < minParticipants', () => {
      engine.configure({
        governed_labels: ['exercise'],
        grace_period_seconds: 30,
        policies: {
          fitness: {
            zones: ['active'],
            rule: 'all_above',
            challenges: [{
              interval_range: [30, 60],
              minParticipants: 2,
              selections: [
                { zone: 'warm', min_participants: 'some', time_allowed: 5, label: 'some warm' }
              ]
            }]
          }
        }
      });

      const activeParticipants = ['alan'];
      const userZoneMap = { alan: 'active' };
      const zoneRankMap = { cool: 0, active: 1, warm: 2 };
      const zoneInfoMap = { cool: { name: 'Cool' }, active: { name: 'Active' }, warm: { name: 'Warm Up' } };
      const totalCount = 1;

      const activePolicy = engine.policies[0];

      // Must be in unlocked phase for challenges to trigger
      engine.phase = 'unlocked';

      // Force a challenge to be "ready to start" by setting nextChallengeAt in the past
      engine.challengeState.nextChallengeAt = Date.now() - 1000;
      engine.challengeState.nextChallenge = { selectionLabel: 'some warm', zone: 'warm' };

      engine._evaluateChallenges(activePolicy, activeParticipants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount);

      // Challenge should NOT have started
      expect(engine.challengeState.activeChallenge).toBeNull();
      // Next challenge scheduling should be cleared
      expect(engine.challengeState.nextChallengeAt).toBeNull();
    });

    it('should allow challenge when totalCount >= minParticipants', () => {
      engine.configure({
        governed_labels: ['exercise'],
        grace_period_seconds: 30,
        policies: {
          fitness: {
            zones: ['active'],
            rule: 'all_above',
            challenges: [{
              interval_range: [30, 60],
              minParticipants: 2,
              selections: [
                { zone: 'warm', min_participants: 'some', time_allowed: 5, label: 'some warm' }
              ]
            }]
          }
        }
      });

      const activePolicy = engine.policies[0];

      // Must be in unlocked phase for challenges to trigger
      engine.phase = 'unlocked';

      const activeParticipants = ['alan', 'bob'];
      const userZoneMap = { alan: 'active', bob: 'active' };
      const zoneRankMap = { cool: 0, active: 1, warm: 2 };
      const zoneInfoMap = { cool: { name: 'Cool' }, active: { name: 'Active' }, warm: { name: 'Warm Up' } };
      const totalCount = 2;

      engine._evaluateChallenges(activePolicy, activeParticipants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount);

      // Should NOT have cleared challenge state — challenge evaluation proceeds
      const scheduled = engine.challengeState.nextChallengeAt != null
        || engine.challengeState.activeChallenge != null;
      expect(scheduled).toBe(true);
    });
  });
});
