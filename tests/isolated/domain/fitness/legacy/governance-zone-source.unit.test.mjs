import { vi } from 'vitest';

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

// Mock session — zone data now arrives pre-populated in userZoneMap
// (GovernanceEngine no longer does a second-pass enrichment via getParticipantProfile)
const createMockSession = () => ({
  zoneProfileStore: { getProfile: vi.fn() },
  roster: [],
  treasureBox: null
});

describe('GovernanceEngine zone source', () => {
  beforeEach(() => {
    mockSampled.mockClear();
    mockInfo.mockClear();
    mockWarn.mockClear();
  });

  test('zone data from userZoneMap satisfies governance requirements', async () => {
    // Zone data now arrives pre-populated in userZoneMap (from getActiveParticipantState
    // or the snapshot caller). GovernanceEngine no longer enriches from ZoneProfileStore.
    const session = createMockSession();
    const engine = new GovernanceEngine(session);
    engine._hysteresisMs = 0;

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

    // Pass zone data directly in userZoneMap (the canonical path)
    engine.evaluate({
      activeParticipants: ['user-1'],
      userZoneMap: { 'user-1': 'warm' },
      zoneRankMap: { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 },
      zoneInfoMap: { warm: { id: 'warm', name: 'Warm', color: 'yellow' } },
      totalCount: 1
    });

    // Verify phase is unlocked (requirement satisfied via userZoneMap)
    expect(engine.phase).toBe('unlocked');
  });

  test('governance phase changes when userZoneMap reports new zone', async () => {
    // Zone data changes between evaluations — simulates what happens when
    // getActiveParticipantState() returns updated zone data.
    const session = createMockSession();
    const engine = new GovernanceEngine(session);
    engine._hysteresisMs = 0;

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
      userZoneMap: { 'user-1': 'active' },
      zoneRankMap,
      zoneInfoMap,
      totalCount: 1
    });

    expect(engine.phase).toBe('pending'); // Not satisfied yet

    // Second evaluation - user now in 'warm' zone
    engine.evaluate({
      activeParticipants: ['user-1'],
      userZoneMap: { 'user-1': 'warm' },
      zoneRankMap,
      zoneInfoMap,
      totalCount: 1
    });

    expect(engine.phase).toBe('unlocked'); // Now satisfied
  });
});
