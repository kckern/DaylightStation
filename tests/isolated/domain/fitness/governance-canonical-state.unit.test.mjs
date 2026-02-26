/**
 * Tests that GovernanceEngine.evaluate() uses the canonical
 * getActiveParticipantState() method instead of rebuilding its own
 * participant list from session.roster.
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockDebug = jest.fn();
const mockWarn = jest.fn();
const mockSampled = jest.fn();
const mockLogger = {
  debug: mockDebug, warn: mockWarn, info: jest.fn(),
  error: jest.fn(), sampled: mockSampled, child: () => mockLogger
};

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => mockLogger,
  getLogger: () => mockLogger
}));

jest.unstable_mockModule('#frontend/lib/api.mjs', () => ({
  default: { get: jest.fn(), post: jest.fn() },
  api: { get: jest.fn(), post: jest.fn() }
}));

const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

const createMockSession = ({ participantState, roster, zoneProfileStore } = {}) => ({
  getActiveParticipantState: jest.fn().mockReturnValue(
    participantState || { participants: [], zoneMap: {}, totalCount: 0 }
  ),
  roster: roster ?? [],
  zoneProfileStore: zoneProfileStore || { getProfile: () => null },
  treasureBox: null,
  getParticipantProfile: jest.fn().mockReturnValue(null)
});

describe('GovernanceEngine canonical state consumption', () => {
  let engine;
  let mockSession;

  const setupGovernedEngine = (sessionOverrides = {}) => {
    mockSession = createMockSession(sessionOverrides);
    engine = new GovernanceEngine(mockSession);
    engine._governedLabelSet = new Set(['fitness']);
    engine._governedTypeSet = new Set();
    engine.media = { id: 'test-media', labels: ['fitness'], type: 'video' };
    engine._latestInputs = {
      zoneRankMap: { active: 3, warm: 2, rest: 1 },
      zoneInfoMap: { active: {}, warm: {}, rest: {} }
    };
    return engine;
  };

  beforeEach(() => {
    mockDebug.mockClear();
    mockWarn.mockClear();
    mockSampled.mockClear();
  });

  it('calls getActiveParticipantState() when evaluate() has no args', () => {
    setupGovernedEngine({
      participantState: {
        participants: ['alice', 'bob'],
        zoneMap: { alice: 'active', bob: 'warm' },
        totalCount: 2
      }
    });

    engine.evaluate();

    expect(mockSession.getActiveParticipantState).toHaveBeenCalled();
  });

  it('does NOT call getParticipantProfile for second-pass zone enrichment', () => {
    setupGovernedEngine({
      participantState: {
        participants: ['alice'],
        zoneMap: { alice: 'active' },
        totalCount: 1
      }
    });

    engine.evaluate();

    expect(mockSession.getParticipantProfile).not.toHaveBeenCalled();
  });

  it('does NOT read session.roster when getActiveParticipantState is available', () => {
    const rosterAccessor = jest.fn().mockReturnValue([]);
    mockSession = {
      getActiveParticipantState: jest.fn().mockReturnValue({
        participants: ['alice'],
        zoneMap: { alice: 'active' },
        totalCount: 1
      }),
      get roster() { rosterAccessor(); return []; },
      zoneProfileStore: { getProfile: () => null },
      treasureBox: null,
      getParticipantProfile: jest.fn().mockReturnValue(null)
    };

    engine = new GovernanceEngine(mockSession);
    engine._governedLabelSet = new Set(['fitness']);
    engine._governedTypeSet = new Set();
    engine.media = { id: 'test-media', labels: ['fitness'], type: 'video' };
    engine._latestInputs = {
      zoneRankMap: { active: 3 },
      zoneInfoMap: { active: {} }
    };

    engine.evaluate();

    // GovernanceEngine should use getActiveParticipantState, not session.roster
    expect(mockSession.getActiveParticipantState).toHaveBeenCalled();
    expect(rosterAccessor).not.toHaveBeenCalled();
  });

  it('still works when evaluate() is called with explicit args (snapshot path)', () => {
    setupGovernedEngine();

    // When called with explicit activeParticipants, it should NOT call getActiveParticipantState
    engine.evaluate({
      activeParticipants: ['alice'],
      userZoneMap: { alice: 'active' },
      zoneRankMap: { active: 3 },
      zoneInfoMap: { active: {} },
      totalCount: 1
    });

    expect(mockSession.getActiveParticipantState).not.toHaveBeenCalled();
  });

  it('preserves participants without zone data (no ghost-filtering)', () => {
    // The key bug fix: during startup, participants have no zone data yet.
    // GovernanceEngine used to ghost-filter them (remove anyone without zone data).
    // After refactoring, they should be preserved.
    setupGovernedEngine({
      participantState: {
        participants: ['alice', 'bob'],
        zoneMap: { alice: 'active' }, // bob has NO zone
        totalCount: 2
      }
    });

    // Need a policy so evaluate() reaches _captureLatestInputs (the full path).
    // Without a policy, _chooseActivePolicy returns null and reset() clears state.
    engine.policies = [{ id: 'test-policy', minParticipants: 1, baseRequirement: {} }];

    engine.evaluate();

    // After evaluate, both participants should still be counted.
    expect(mockSession.getActiveParticipantState).toHaveBeenCalled();
    // The ghost filter would have reduced participants to just 'alice'.
    // Without it, both remain. Verify via _latestInputs which is set
    // by _captureLatestInputs() at the end of evaluate().
    expect(engine._latestInputs.activeParticipants).toEqual(['alice', 'bob']);
    expect(engine._latestInputs.totalCount).toBe(2);
  });
});
