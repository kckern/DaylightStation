// tests/unit/governance/GovernanceEngine-cyclePhaseGen.test.mjs
import { describe, it, expect, jest } from '@jest/globals';
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));
const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

function seededRng(seed) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

describe('GovernanceEngine._generateCyclePhases', () => {
  const baseSelection = {
    type: 'cycle',
    hiRpmRange: [50, 90],
    segmentCount: [3, 5],
    segmentDurationSeconds: [20, 40],
    rampSeconds: [10, 20],
    loRpmRatio: 0.75,
    sequenceType: 'random'
  };

  it('respects segmentCount range', () => {
    const engine = new GovernanceEngine(null, { random: seededRng(1) });
    const phases = engine._generateCyclePhases(baseSelection);
    expect(phases.length).toBeGreaterThanOrEqual(3);
    expect(phases.length).toBeLessThanOrEqual(5);
  });

  it('each phase hi_rpm is within range', () => {
    const engine = new GovernanceEngine(null, { random: seededRng(2) });
    const phases = engine._generateCyclePhases(baseSelection);
    phases.forEach(p => {
      expect(p.hiRpm).toBeGreaterThanOrEqual(50);
      expect(p.hiRpm).toBeLessThanOrEqual(90);
    });
  });

  it('lo_rpm derived from ratio', () => {
    const engine = new GovernanceEngine(null, { random: seededRng(3) });
    const phases = engine._generateCyclePhases(baseSelection);
    phases.forEach(p => {
      expect(p.loRpm).toBe(Math.round(p.hiRpm * 0.75));
    });
  });

  it('progressive type produces ascending hi_rpm', () => {
    const engine = new GovernanceEngine(null, { random: seededRng(4) });
    const phases = engine._generateCyclePhases({ ...baseSelection, sequenceType: 'progressive', segmentCount: [4, 4] });
    for (let i = 1; i < phases.length; i++) {
      expect(phases[i].hiRpm).toBeGreaterThanOrEqual(phases[i-1].hiRpm - 2); // allow tiny jitter
    }
  });

  it('regressive type produces descending hi_rpm', () => {
    const engine = new GovernanceEngine(null, { random: seededRng(5) });
    const phases = engine._generateCyclePhases({ ...baseSelection, sequenceType: 'regressive', segmentCount: [4, 4] });
    for (let i = 1; i < phases.length; i++) {
      expect(phases[i].hiRpm).toBeLessThanOrEqual(phases[i-1].hiRpm + 2);
    }
  });

  it('constant type produces equal hi_rpm across phases', () => {
    const engine = new GovernanceEngine(null, { random: seededRng(6) });
    const phases = engine._generateCyclePhases({ ...baseSelection, sequenceType: 'constant', segmentCount: [4, 4] });
    const firstHi = phases[0].hiRpm;
    phases.forEach(p => expect(p.hiRpm).toBe(firstHi));
  });

  it('explicitPhases overrides procedural generation', () => {
    const engine = new GovernanceEngine(null, { random: seededRng(7) });
    const phases = engine._generateCyclePhases({
      ...baseSelection,
      explicitPhases: [
        { hiRpm: 60, loRpm: 45, rampSeconds: 15, maintainSeconds: 30 },
        { hiRpm: 70, loRpm: 55, rampSeconds: 20, maintainSeconds: 45 }
      ]
    });
    expect(phases).toHaveLength(2);
    expect(phases[0]).toEqual({ hiRpm: 60, loRpm: 45, rampSeconds: 15, maintainSeconds: 30 });
  });
});
