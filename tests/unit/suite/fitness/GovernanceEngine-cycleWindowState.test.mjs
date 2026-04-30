import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine._updateGlobalState — cycle fields', () => {
  let engine;

  beforeEach(() => {
    global.window = {};
    engine = new GovernanceEngine({ session: null });
  });

  afterEach(() => {
    delete global.window;
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
});
