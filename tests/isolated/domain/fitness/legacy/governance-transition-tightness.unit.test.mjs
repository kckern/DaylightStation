import { jest } from '@jest/globals';

// Mock logger with all required methods
const mockSampled = jest.fn();
const mockInfo = jest.fn();
const mockWarn = jest.fn();
const mockDebug = jest.fn();
const mockError = jest.fn();
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ sampled: mockSampled, info: mockInfo, warn: mockWarn, debug: mockDebug, error: mockError }),
  getLogger: () => ({ sampled: mockSampled, info: mockInfo, warn: mockWarn, debug: mockDebug, error: mockError })
}));

const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

const ZONE_RANK_MAP = { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 };
const ZONE_INFO_MAP = {
  cool: { id: 'cool', name: 'Cool', color: '#94a3b8' },
  active: { id: 'active', name: 'Active', color: '#22c55e' },
  warm: { id: 'warm', name: 'Warm', color: '#eab308' },
  hot: { id: 'hot', name: 'Hot', color: '#f97316' },
  fire: { id: 'fire', name: 'Fire', color: '#ef4444' }
};

const createMockSession = (zoneProfileStore, roster = []) => ({
  zoneProfileStore,
  roster,
  treasureBox: null
});

describe('Governance transition tightness', () => {
  beforeEach(() => {
    mockSampled.mockClear();
    mockInfo.mockClear();
    mockWarn.mockClear();
    mockDebug.mockClear();
    mockError.mockClear();
  });

  test('lockRows has entries when participants exist and requirements unsatisfied', () => {
    const mockGetProfile = jest.fn().mockReturnValue({
      id: 'user-1',
      currentZoneId: 'active'
    });
    const mockZoneProfileStore = { getProfile: mockGetProfile };

    const session = createMockSession(mockZoneProfileStore, [
      { id: 'user-1', isActive: true }
    ]);

    const engine = new GovernanceEngine(session);
    engine._hysteresisMs = 0;

    // setMedia BEFORE configure (configure calls evaluate internally)
    engine.setMedia({ id: 'test-media', labels: ['fitness'] });

    engine.configure({
      governed_labels: ['fitness'],
      policies: {
        'test-policy': {
          min_participants: 1,
          base_requirement: [{ warm: 'all' }]
        }
      }
    });

    // Evaluate with 1 participant whose zone is 'active' (below 'warm' target)
    engine.evaluate({
      activeParticipants: ['user-1'],
      userZoneMap: {},
      zoneRankMap: ZONE_RANK_MAP,
      zoneInfoMap: ZONE_INFO_MAP,
      totalCount: 1
    });

    const state = engine.state;

    expect(state.status).toBe('pending');
    expect(state.lockRows.length).toBeGreaterThan(0);
    expect(state.lockRows[0].missingUsers).toContain('user-1');
  });

  test('lockRows populated immediately after participant joins (no empty intermediate)', () => {
    const mockGetProfile = jest.fn().mockReturnValue({
      id: 'user-1',
      currentZoneId: 'active'
    });
    const mockZoneProfileStore = { getProfile: mockGetProfile };

    // Start with empty roster, then add participant
    const session = createMockSession(mockZoneProfileStore, []);

    const engine = new GovernanceEngine(session);
    engine._hysteresisMs = 0;

    engine.setMedia({ id: 'test-media', labels: ['fitness'] });

    engine.configure({
      governed_labels: ['fitness'],
      policies: {
        'test-policy': {
          min_participants: 1,
          base_requirement: [{ warm: 'all' }]
        }
      }
    });

    // Pre-populate: evaluate with 0 participants
    engine.evaluate({
      activeParticipants: [],
      userZoneMap: {},
      zoneRankMap: ZONE_RANK_MAP,
      zoneInfoMap: ZONE_INFO_MAP,
      totalCount: 0
    });

    // Now add participant to roster
    session.roster = [{ id: 'user-1', isActive: true }];

    // Evaluate with 1 participant (user in 'active', below 'warm' target)
    engine.evaluate({
      activeParticipants: ['user-1'],
      userZoneMap: {},
      zoneRankMap: ZONE_RANK_MAP,
      zoneInfoMap: ZONE_INFO_MAP,
      totalCount: 1
    });

    const state = engine.state;

    // lockRows must be populated on the SAME evaluation - no empty intermediate
    expect(state.lockRows.length).toBeGreaterThan(0);
  });

  test('pre-populated requirements have zone labels before any participant data', () => {
    const mockGetProfile = jest.fn();
    const mockZoneProfileStore = { getProfile: mockGetProfile };

    const session = createMockSession(mockZoneProfileStore, []);

    const engine = new GovernanceEngine(session);
    engine._hysteresisMs = 0;

    engine.setMedia({ id: 'test-media', labels: ['fitness'] });

    engine.configure({
      governed_labels: ['fitness'],
      zoneConfig: [
        { id: 'cool', name: 'Cool', color: '#94a3b8' },
        { id: 'active', name: 'Active', color: '#22c55e' },
        { id: 'warm', name: 'Warm', color: '#eab308' },
        { id: 'hot', name: 'Hot', color: '#f97316' },
        { id: 'fire', name: 'Fire', color: '#ef4444' }
      ],
      policies: {
        'test-policy': {
          min_participants: 1,
          base_requirement: [{ warm: 'all' }]
        }
      }
    });

    // Evaluate with 0 participants
    engine.evaluate({
      activeParticipants: [],
      userZoneMap: {},
      zoneRankMap: ZONE_RANK_MAP,
      zoneInfoMap: ZONE_INFO_MAP,
      totalCount: 0
    });

    const state = engine.state;

    expect(state.requirements.length).toBeGreaterThan(0);
    expect(state.requirements[0].zoneLabel).toBe('Warm');
  });

  describe('governance state carries decision data (no display data)', () => {
    test('requirements carry zone ID and label but not zoneColor', () => {
      const mockGetProfile = jest.fn().mockReturnValue({
        id: 'user-1', currentZoneId: 'active'
      });
      const engine = new GovernanceEngine(
        createMockSession({ getProfile: mockGetProfile })
      );
      engine._hysteresisMs = 0;
      engine.setMedia({ id: 'test', labels: ['fitness'] });
      engine.configure({
        governed_labels: ['fitness'],
        policies: {
          'test': { min_participants: 1, base_requirement: [{ warm: 'all' }] }
        }
      });

      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: {},
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });

      const warmReq = engine.state.requirements.find(r => r.zone === 'warm');
      expect(warmReq).toBeDefined();
      expect(warmReq.zoneLabel).toBe('Warm');
      expect(warmReq.zoneColor).toBeUndefined();
    });

    test('lockRows carry targetZoneId but not participantZones', () => {
      const mockGetProfile = jest.fn().mockReturnValue({
        id: 'user-1', currentZoneId: 'active'
      });
      const engine = new GovernanceEngine(
        createMockSession({ getProfile: mockGetProfile })
      );
      engine._hysteresisMs = 0;
      engine.setMedia({ id: 'test', labels: ['fitness'] });
      engine.configure({
        governed_labels: ['fitness'],
        policies: {
          'test': { min_participants: 1, base_requirement: [{ warm: 'all' }] }
        }
      });

      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: {},
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });

      expect(engine.state.lockRows.length).toBeGreaterThan(0);
      expect(engine.state.lockRows[0].targetZoneId).toBe('warm');
      expect(engine.state.lockRows[0].zoneColor).toBeUndefined();
      expect(engine.state.lockRows[0].participantZones).toBeUndefined();
    });
  });

  describe('state cache invalidation', () => {
    test('state reflects new zone data after evaluate, not cached stale data', () => {
      const mockGetProfile = jest.fn();
      const engine = new GovernanceEngine(
        createMockSession({ getProfile: mockGetProfile })
      );
      engine._hysteresisMs = 0;
      engine.setMedia({ id: 'test', labels: ['fitness'] });
      engine.configure({
        governed_labels: ['fitness'],
        policies: {
          'test': { min_participants: 1, base_requirement: [{ warm: 'all' }] }
        }
      });

      // First: user in active → pending
      mockGetProfile.mockReturnValue({ id: 'user-1', currentZoneId: 'active' });
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: {},
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });
      expect(engine.state.status).toBe('pending');

      // Second: user in warm → unlocked (must not return cached 'pending')
      mockGetProfile.mockReturnValue({ id: 'user-1', currentZoneId: 'warm' });
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: {},
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });
      expect(engine.state.status).toBe('unlocked');
      expect(engine.state.lockRows.length).toBe(0);
    });

    test('state reflects participant changes immediately after evaluate', () => {
      const mockGetProfile = jest.fn().mockImplementation((id) => ({
        id, currentZoneId: 'active'
      }));
      const engine = new GovernanceEngine(
        createMockSession({ getProfile: mockGetProfile })
      );
      engine._hysteresisMs = 0;
      engine.setMedia({ id: 'test', labels: ['fitness'] });
      engine.configure({
        governed_labels: ['fitness'],
        policies: {
          'test': { min_participants: 1, base_requirement: [{ warm: 'all' }] }
        }
      });

      // 1 participant
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: {},
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 1
      });
      expect(engine.state.activeUserCount).toBe(1);

      // 2 participants — state must reflect immediately
      engine.evaluate({
        activeParticipants: ['user-1', 'user-2'],
        userZoneMap: {},
        zoneRankMap: ZONE_RANK_MAP,
        zoneInfoMap: ZONE_INFO_MAP,
        totalCount: 2
      });
      expect(engine.state.activeUserCount).toBe(2);
      const allMissing = engine.state.lockRows.flatMap(r => r.missingUsers || []);
      expect(allMissing).toContain('user-1');
      expect(allMissing).toContain('user-2');
    });
  });
});
