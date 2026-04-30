import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));
const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine._updateGlobalState — cycle fields', () => {
  let engine;

  beforeEach(() => {
    globalThis.window = {};
    const mockSession = {
      roster: [],
      snapshot: { zoneConfig: [] }
    };
    engine = new GovernanceEngine(mockSession);
  });

  it('exposes null cycle fields when no challenge is active', () => {
    engine._updateGlobalState();
    const gov = window.__fitnessGovernance;
    expect(gov.activeChallengeType).toBeNull();
    expect(gov.cycleState).toBeNull();
    expect(gov.currentRpm).toBeNull();
    expect(gov.riderId).toBeNull();
    expect(gov.currentPhaseIndex).toBeNull();
    expect(gov.totalPhases).toBeNull();
    expect(gov.phaseProgressPct).toBeNull();
    expect(gov.activeChallengeEquipment).toBeNull();
  });

  it('exposes cycle-challenge state when one is active', () => {
    engine.challengeState = {
      activeChallenge: {
        id: 'cyc_1',
        type: 'cycle',
        cycleState: 'ramp',
        equipment: 'cycle_ace',
        rider: { id: 'felix', name: 'Felix' },
        currentPhaseIndex: 1,
        totalPhases: 4,
        phaseProgressPct: 42,
        currentRpm: 67
      }
    };
    engine._updateGlobalState();
    const gov = window.__fitnessGovernance;
    expect(gov.activeChallengeType).toBe('cycle');
    expect(gov.cycleState).toBe('ramp');
    expect(gov.currentRpm).toBe(67);
    expect(gov.riderId).toBe('felix');
    expect(gov.currentPhaseIndex).toBe(1);
    expect(gov.totalPhases).toBe(4);
    expect(gov.phaseProgressPct).toBe(42);
    expect(gov.activeChallengeEquipment).toBe('cycle_ace');
  });

  it('returns null for missing rider object (e.g. mid-swap)', () => {
    engine.challengeState = {
      activeChallenge: { type: 'cycle', cycleState: 'init', equipment: 'cycle_ace', rider: null }
    };
    engine._updateGlobalState();
    expect(window.__fitnessGovernance.riderId).toBeNull();
  });

  it('handles string rider (live engine form) as well as object form', () => {
    engine.challengeState = {
      activeChallenge: {
        type: 'cycle',
        cycleState: 'maintain',
        equipment: 'cycle_ace',
        rider: 'felix' // live engine stores rider as a userId string
      }
    };
    engine._updateGlobalState();
    expect(window.__fitnessGovernance.riderId).toBe('felix');
  });
});
