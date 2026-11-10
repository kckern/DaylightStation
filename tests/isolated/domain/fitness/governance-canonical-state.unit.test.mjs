/**
 * Tests that GovernanceEngine.evaluate() uses the canonical
 * getActiveParticipantState() method instead of rebuilding its own
 * participant list from session.roster.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDebug = vi.fn();
const mockWarn = vi.fn();
const mockSampled = vi.fn();
const mockLogger = {
  debug: mockDebug, warn: mockWarn, info: vi.fn(),
  error: vi.fn(), sampled: mockSampled, child: () => mockLogger
};

vi.mock('#frontend/lib/logging/Logger.js', () => ({
  default: () => mockLogger,
  getLogger: () => mockLogger
}));

vi.mock('#frontend/lib/api.mjs', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  api: { get: vi.fn(), post: vi.fn() }
}));

let GovernanceEngine;
beforeAll(async () => {
  ({ GovernanceEngine } = await import("../../../../__app_modules/wellness/fitness/browser/hooks/fitness/GovernanceEngine.js"));
});

const createMockSession = ({ participantState, roster, zoneProfileStore } = {}) => ({
  getActiveParticipantState: vi.fn().mockReturnValue(
    participantState || { participants: [], zoneMap: {}, totalCount: 0 }
  ),
  roster: roster ?? [],
  zoneProfileStore: zoneProfileStore || { getProfile: () => null },
  treasureBox: null,
  getParticipantProfile: vi.fn().mockReturnValue(null)
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

  // The invariant is that WHO participates comes from the canonical state.
  // session.roster may still be read to decorate evidence and lock logs with a
  // display name and heart rate (_capturePlaybackEvidence, _getParticipantStates),
  // so "roster is never touched" is the wrong guard. A roster that disagrees
  // with the canonical state must not change the participant set.
  it('takes participants from getActiveParticipantState even when session.roster disagrees', () => {
    setupGovernedEngine({
      participantState: {
        participants: ['alice'],
        zoneMap: { alice: 'active' },
        totalCount: 1
      },
      roster: [
        { id: 'alice', isActive: false, zoneId: 'active' },
        { id: 'mallory', isActive: true, zoneId: 'rest' }
      ]
    });
    engine.policies = [{ id: 'test-policy', minParticipants: 1, baseRequirement: {} }];

    engine.evaluate();

    expect(mockSession.getActiveParticipantState).toHaveBeenCalled();
    expect(engine._latestInputs.activeParticipants).toEqual(['alice']);
    expect(engine._latestInputs.totalCount).toBe(1);
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
