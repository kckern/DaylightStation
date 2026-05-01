import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));

const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('Cycle phaseProgressPct unit consistency', () => {
  let engine;

  beforeEach(() => {
    globalThis.window = {};
    engine = new GovernanceEngine({ roster: [], snapshot: { zoneConfig: [] } });
    engine.media = null;
    engine._latestInputs = {
      activeParticipants: ['kckern'],
      userZoneMap: { kckern: 'hot' },
      equipmentCadenceMap: { cycle_ace: { rpm: 90, connected: true } }
    };
    engine.challengeState = {
      activeChallenge: {
        id: 'cyc_1',
        type: 'cycle',
        cycleState: 'maintain',
        equipment: 'cycle_ace',
        rider: 'kckern',
        manualTrigger: true,
        currentPhaseIndex: 0,
        totalPhases: 2,
        generatedPhases: [
          { hiRpm: 50, loRpm: 38, rampSeconds: 10, maintainSeconds: 20 },
          { hiRpm: 60, loRpm: 45, rampSeconds: 10, maintainSeconds: 20 }
        ],
        phaseProgressMs: 9000,
        status: 'pending',
        selection: { init: { minRpm: 30 } },
        _lastCycleTs: Date.now()
      }
    };
  });

  it('manualCycle path writes phaseProgressPct as a 0-1 float', () => {
    engine.evaluate({});
    const got = engine.challengeState.activeChallenge.phaseProgressPct;
    expect(got).toBeGreaterThanOrEqual(0);
    expect(got).toBeLessThanOrEqual(1);
    expect(got).toBeCloseTo(0.45, 1);
  });

  it('window.__fitnessGovernance.phaseProgressPct is also 0-1 float', () => {
    engine.evaluate({});
    const gov = window.__fitnessGovernance;
    expect(gov.phaseProgressPct).toBeGreaterThanOrEqual(0);
    expect(gov.phaseProgressPct).toBeLessThanOrEqual(1);
    expect(gov.phaseProgressPct).toBeCloseTo(0.45, 1);
  });
});
