// tests/unit/governance/GovernanceEngine-boostContributions.test.mjs
import { describe, it, expect, jest } from '@jest/globals';
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));
const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine boost contributions', () => {
  it('_computeBoostMultiplier returns a per-user contributions map', () => {
    const engine = new GovernanceEngine(null);
    const active = { selection: { boost: { zoneMultipliers: { hot: 0.5, fire: 1.0 }, maxTotalMultiplier: 3.0 } } };
    const ctx = {
      activeParticipants: ['felix', 'mom', 'milo'],
      userZoneMap: { felix: 'fire', mom: 'warm', milo: 'hot' }
    };
    const { multiplier, contributors, contributions } = engine._computeBoostMultiplier(active, ctx);
    expect(multiplier).toBeCloseTo(2.5); // 1.0 + 1.0(fire) + 0.5(hot)
    expect(contributors).toEqual(['felix', 'milo']);
    expect(contributions).toEqual({ felix: 1.0, milo: 0.5 });
  });
});
