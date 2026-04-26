import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest';

// Mock logger
const mockSampled = vi.fn();
const mockInfo = vi.fn();
const mockWarn = vi.fn();
const mockDebug = vi.fn();
const mockError = vi.fn();
vi.mock('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ sampled: mockSampled, info: mockInfo, warn: mockWarn, debug: mockDebug, error: mockError }),
  getLogger: () => ({ sampled: mockSampled, info: mockInfo, warn: mockWarn, debug: mockDebug, error: mockError })
}));

let GovernanceEngine;
beforeAll(async () => {
  ({ GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js'));
});

// Zone data now arrives pre-populated in userZoneMap
// (GovernanceEngine no longer does second-pass enrichment via getParticipantProfile)
const createMockSession = ({ getParticipantProfile } = {}) => ({
  zoneProfileStore: { getProfile: vi.fn() },
  roster: [],
  treasureBox: null,
  ...(getParticipantProfile ? { getParticipantProfile } : {})
});

// Default zone config used by challenge feasibility checks
const DEFAULT_ZONE_CONFIG = [
  { id: 'cool', name: 'Cool', min: 0 },
  { id: 'active', name: 'Active', min: 80 },
  { id: 'warm', name: 'Warm', min: 120 },
  { id: 'hot', name: 'Hot', min: 150 },
  { id: 'fire', name: 'Fire', min: 175 }
];

const ZONE_RANK_MAP = { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 };
const ZONE_INFO_MAP = {
  cool: { id: 'cool', name: 'Cool', color: 'gray' },
  active: { id: 'active', name: 'Active', color: 'green' },
  warm: { id: 'warm', name: 'Warm', color: 'yellow' },
  hot: { id: 'hot', name: 'Hot', color: 'orange' },
  fire: { id: 'fire', name: 'Fire', color: 'red' }
};

describe('GovernanceEngine SSoT coverage', () => {
  let realDateNow;
  let mockTime;

  beforeEach(() => {
    mockSampled.mockClear();
    mockInfo.mockClear();
    mockWarn.mockClear();
    mockDebug.mockClear();
    mockError.mockClear();
    realDateNow = Date.now;
    mockTime = realDateNow.call(Date);
    Date.now = () => mockTime;
  });

  afterEach(() => {
    Date.now = realDateNow;
  });

  // --- Phase Transition: pending -> unlocked via hysteresis ---

  describe('phase transitions', () => {
    test('pending -> unlocked is immediate when requirements are met', () => {
      // Note: hysteresis was removed from GovernanceEngine — unlock is immediate
      const engine = new GovernanceEngine(createMockSession());

      engine.setMedia({ id: 'test', labels: ['fitness'] });
      engine.configure({
        governed_labels: ['fitness'],
        policies: {
          'test': {
            min_participants: 1,
            base_requirement: [{ warm: 'all' }]
          }
        }
      });

      // Requirements met -> immediately unlocked (no hysteresis delay)
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: { 'user-1': 'warm' },
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });

      expect(engine.phase).toBe('unlocked');
    });

    test('satisfaction lapse immediately transitions from unlocked to appropriate phase', () => {
      const engine = new GovernanceEngine(createMockSession());

      engine.setMedia({ id: 'test', labels: ['fitness'] });
      engine.configure({
        governed_labels: ['fitness'],
        policies: {
          'test': {
            min_participants: 1,
            base_requirement: [{ warm: 'all' }]
          }
        }
      });

      // Requirements met -> unlocked
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: { 'user-1': 'warm' },
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });
      expect(engine.phase).toBe('unlocked');

      // Requirements not met -> locked (no grace period configured)
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: { 'user-1': 'active' },
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });
      expect(engine.phase).toBe('locked');

      // Requirements met again -> unlocked immediately
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: { 'user-1': 'warm' },
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });
      expect(engine.phase).toBe('unlocked');
    });

    test('unlocked -> warning -> locked via grace period expiry', () => {
      const engine = new GovernanceEngine(createMockSession());
      engine._hysteresisMs = 0; // Disable for this test -- focus on grace period

      engine.configure({
        governed_labels: ['fitness'],
        policies: {
          'test': {
            min_participants: 1,
            base_requirement: [{ warm: 'all', grace_period_seconds: 5 }]
          }
        }
      });
      engine.setMedia({ id: 'test', labels: ['fitness'] });

      // Phase 1: Satisfy -> unlocked
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: { 'user-1': 'warm' },
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });
      expect(engine.phase).toBe('unlocked');

      // Phase 2: Drop below -> warning (grace period starts)
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: { 'user-1': 'active' },
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });
      expect(engine.phase).toBe('warning');

      // Phase 3: Grace period partially elapsed -- still warning
      mockTime += 3000;
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: { 'user-1': 'active' },
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });
      expect(engine.phase).toBe('warning');

      // Phase 4: Grace period expired -- locked
      mockTime += 3000;
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: { 'user-1': 'active' },
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });
      expect(engine.phase).toBe('locked');
    });

    test('warning -> unlocked when user recovers during grace period', () => {
      const engine = new GovernanceEngine(createMockSession());
      engine._hysteresisMs = 0;

      engine.configure({
        governed_labels: ['fitness'],
        policies: {
          'test': {
            min_participants: 1,
            base_requirement: [{ warm: 'all', grace_period_seconds: 10 }]
          }
        }
      });
      engine.setMedia({ id: 'test', labels: ['fitness'] });

      // Satisfy -> unlocked
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: { 'user-1': 'warm' },
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });
      expect(engine.phase).toBe('unlocked');

      // Drop -> warning
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: { 'user-1': 'active' },
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });
      expect(engine.phase).toBe('warning');

      // Recover -> unlocked (grace period canceled)
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: { 'user-1': 'warm' },
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });
      expect(engine.phase).toBe('unlocked');
    });

    test('no grace period -> requirements lapse skips warning, goes straight to locked', () => {
      const engine = new GovernanceEngine(createMockSession());
      engine._hysteresisMs = 0;

      engine.configure({
        governed_labels: ['fitness'],
        policies: {
          'test': {
            min_participants: 1,
            base_requirement: [{ warm: 'all' }] // No grace_period_seconds
          }
        }
      });
      engine.setMedia({ id: 'test', labels: ['fitness'] });

      // Satisfy -> unlocked
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: { 'user-1': 'warm' },
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });
      expect(engine.phase).toBe('unlocked');

      // Drop -> locked (no grace period)
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: { 'user-1': 'active' },
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });
      expect(engine.phase).toBe('locked');
    });
  });

  // --- Challenge Exit Criteria ---

  describe('challenge exit criteria', () => {
    const CHALLENGE_POLICY = {
      governed_labels: ['fitness'],
      policies: {
        'challenge-policy': {
          min_participants: 1,
          base_requirement: [{ active: 'all' }],
          challenges: [{
            interval: [5, 10],
            selection_type: 'cyclic',
            selections: [{
              zone: 'warm',
              rule: 'all',
              time_allowed: 10,
              label: 'Warm Up'
            }]
          }]
        }
      }
    };

    test('challenge success sets videoLocked=false and records history', () => {
      // Provide getParticipantProfile for challenge feasibility checks
      const mockGetProfile = vi.fn().mockReturnValue({
        id: 'user-1', currentZoneId: 'active', heartRate: 110, zoneConfig: DEFAULT_ZONE_CONFIG
      });
      const engine = new GovernanceEngine(createMockSession({ getParticipantProfile: mockGetProfile }));
      engine._hysteresisMs = 0;

      engine.configure(CHALLENGE_POLICY);
      engine.setMedia({ id: 'test', labels: ['fitness'] });

      // Get to unlocked
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: { 'user-1': 'active' },
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });
      expect(engine.phase).toBe('unlocked');

      // Force-start a challenge
      engine.challengeState.forceStartRequest = { configId: null };
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: { 'user-1': 'active' },
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });
      expect(engine.challengeState.activeChallenge).toBeTruthy();
      expect(engine.challengeState.activeChallenge.status).toBe('pending');

      // User meets challenge zone requirement
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: { 'user-1': 'warm' },
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });

      expect(engine.challengeState.activeChallenge.status).toBe('success');
      expect(engine.challengeState.videoLocked).toBe(false);
      expect(engine.challengeState.challengeHistory.length).toBeGreaterThan(0);
      expect(engine.challengeState.challengeHistory.at(-1).status).toBe('success');
    });

    test('challenge failure sets videoLocked=true and phase=locked', () => {
      const mockGetProfile = vi.fn().mockReturnValue({
        id: 'user-1', currentZoneId: 'active', heartRate: 110, zoneConfig: DEFAULT_ZONE_CONFIG
      });
      const engine = new GovernanceEngine(createMockSession({ getParticipantProfile: mockGetProfile }));
      engine._hysteresisMs = 0;

      engine.configure(CHALLENGE_POLICY);
      engine.setMedia({ id: 'test', labels: ['fitness'] });

      // Get to unlocked
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: { 'user-1': 'active' },
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });
      expect(engine.phase).toBe('unlocked');

      // Force-start a challenge
      engine.challengeState.forceStartRequest = { configId: null };
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: { 'user-1': 'active' },
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });
      const challenge = engine.challengeState.activeChallenge;
      expect(challenge).toBeTruthy();

      // Expire the challenge without meeting it
      mockTime = challenge.expiresAt + 1;
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: { 'user-1': 'active' },
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });

      expect(engine.challengeState.activeChallenge.status).toBe('failed');
      expect(engine.challengeState.videoLocked).toBe(true);
      expect(engine.phase).toBe('locked');
    });

    test('failed challenge recovers when user meets zone after failure', () => {
      const mockGetProfile = vi.fn().mockReturnValue({
        id: 'user-1', currentZoneId: 'active', heartRate: 110, zoneConfig: DEFAULT_ZONE_CONFIG
      });
      const engine = new GovernanceEngine(createMockSession({ getParticipantProfile: mockGetProfile }));
      engine._hysteresisMs = 0;

      engine.configure(CHALLENGE_POLICY);
      engine.setMedia({ id: 'test', labels: ['fitness'] });

      // Get to unlocked
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: { 'user-1': 'active' },
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });

      // Force-start and expire challenge
      engine.challengeState.forceStartRequest = { configId: null };
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: { 'user-1': 'active' },
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });
      const challenge = engine.challengeState.activeChallenge;
      mockTime = challenge.expiresAt + 1;
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: { 'user-1': 'active' },
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });
      expect(engine.challengeState.videoLocked).toBe(true);
      expect(engine.phase).toBe('locked');

      // Now user meets zone -- challenge recovers
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: { 'user-1': 'warm' },
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });

      expect(engine.challengeState.activeChallenge.status).toBe('success');
      expect(engine.challengeState.videoLocked).toBe(false);
    });
  });

  // --- videoLocked as sole lock authority ---

  describe('videoLocked sole authority', () => {
    test('challengeState.videoLocked is false when no challenge is active', () => {
      const engine = new GovernanceEngine(createMockSession());
      engine._hysteresisMs = 0;

      engine.configure({
        governed_labels: ['fitness'],
        policies: {
          'test': {
            min_participants: 1,
            base_requirement: [{ warm: 'all' }]
          }
        }
      });
      engine.setMedia({ id: 'test', labels: ['fitness'] });

      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: { 'user-1': 'warm' },
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });

      expect(engine.phase).toBe('unlocked');
      expect(engine.challengeState.videoLocked).toBe(false);
    });

    test('videoLocked transitions: false -> true on failure, true -> false on recovery', () => {
      const mockGetProfile = vi.fn().mockReturnValue({
        id: 'user-1', currentZoneId: 'active', heartRate: 110, zoneConfig: DEFAULT_ZONE_CONFIG
      });
      const engine = new GovernanceEngine(createMockSession({ getParticipantProfile: mockGetProfile }));
      engine._hysteresisMs = 0;

      engine.configure({
        governed_labels: ['fitness'],
        policies: {
          'challenge-policy': {
            min_participants: 1,
            base_requirement: [{ active: 'all' }],
            challenges: [{
              interval: [5, 10],
              selection_type: 'cyclic',
              selections: [{
                zone: 'warm',
                rule: 'all',
                time_allowed: 10,
                label: 'Test Challenge'
              }]
            }]
          }
        }
      });
      engine.setMedia({ id: 'test', labels: ['fitness'] });

      // Unlocked, videoLocked=false
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: { 'user-1': 'active' },
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });
      expect(engine.challengeState.videoLocked).toBe(false);

      // Start and fail challenge -> videoLocked=true
      engine.challengeState.forceStartRequest = { configId: null };
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: { 'user-1': 'active' },
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });
      const challenge = engine.challengeState.activeChallenge;
      mockTime = challenge.expiresAt + 1;
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: { 'user-1': 'active' },
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });
      expect(engine.challengeState.videoLocked).toBe(true);

      // Recover -> videoLocked=false
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: { 'user-1': 'warm' },
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });
      expect(engine.challengeState.videoLocked).toBe(false);
    });

    test('governance state snapshot includes videoLocked field', () => {
      const engine = new GovernanceEngine(createMockSession());
      engine._hysteresisMs = 0;

      engine.configure({
        governed_labels: ['fitness'],
        policies: {
          'test': {
            min_participants: 1,
            base_requirement: [{ warm: 'all' }]
          }
        }
      });
      engine.setMedia({ id: 'test', labels: ['fitness'] });

      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: { 'user-1': 'warm' },
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });

      const state = engine.state;
      expect(state).toBeDefined();
      expect(typeof state.videoLocked).toBe('boolean');
      expect(state.videoLocked).toBe(false);
    });
  });

  // --- Early zone map capture (bug fix verification) ---

  describe('early zone map capture', () => {
    test('zone rank lookups work on first evaluate after configure', () => {
      const engine = new GovernanceEngine(createMockSession());
      engine._hysteresisMs = 0;

      // Configure WITHOUT zoneConfig in config -- zone maps come only from evaluate()
      engine.configure({
        governed_labels: ['fitness'],
        policies: {
          'test': {
            min_participants: 1,
            base_requirement: [{ warm: 'all' }]
          }
        }
      });
      engine.setMedia({ id: 'test', labels: ['fitness'] });

      // First evaluate with zone maps -- should work (was broken before early capture fix)
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: { 'user-1': 'warm' },
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });

      // The requirement summary should have proper zone labels (not just raw IDs)
      const reqs = engine.requirementSummary?.requirements;
      expect(reqs).toBeDefined();
      expect(reqs.length).toBeGreaterThan(0);
      // The zone label should come from zoneInfoMap, not be raw "warm"
      const firstReq = reqs[0];
      expect(firstReq.zone).toBe('warm');
      // zoneLabel should be "Warm" (from zoneInfoMap), not undefined/null
      expect(firstReq.zoneLabel).toBeTruthy();
    });
  });

  // --- Multi-user governance scenarios ---

  describe('multi-user governance', () => {
    test('all-rule locks when ANY user drops below zone', () => {
      const engine = new GovernanceEngine(createMockSession());
      engine._hysteresisMs = 0;

      engine.configure({
        governed_labels: ['fitness'],
        policies: {
          'test': {
            min_participants: 1,
            base_requirement: [{ warm: 'all', grace_period_seconds: 5 }]
          }
        }
      });
      engine.setMedia({ id: 'test', labels: ['fitness'] });

      // Both users in warm -> unlocked
      engine.evaluate({
        activeParticipants: ['user-1', 'user-2'],
        userZoneMap: { 'user-1': 'warm', 'user-2': 'warm' },
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 2
      });
      expect(engine.phase).toBe('unlocked');

      // User-2 drops to active -> warning
      engine.evaluate({
        activeParticipants: ['user-1', 'user-2'],
        userZoneMap: { 'user-1': 'warm', 'user-2': 'active' },
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 2
      });
      expect(engine.phase).toBe('warning');

      // Requirement summary should show user-2 as missing
      const reqs = engine.requirementSummary?.requirements || [];
      const warmReq = reqs.find(r => r.zone === 'warm');
      expect(warmReq).toBeDefined();
      expect(warmReq.missingUsers).toContain('user-2');
      expect(warmReq.missingUsers).not.toContain('user-1');
    });
  });
});
