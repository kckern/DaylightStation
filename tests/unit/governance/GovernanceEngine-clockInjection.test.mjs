import { describe, it, expect, jest } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));

const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine clock/random injection', () => {
  it('uses injected now() instead of Date.now()', () => {
    const fixedTime = 1234567890;
    const engine = new GovernanceEngine(null, { now: () => fixedTime });
    expect(engine._now()).toBe(fixedTime);
  });

  it('uses injected random() instead of Math.random()', () => {
    const engine = new GovernanceEngine(null, { random: () => 0.42 });
    expect(engine._random()).toBe(0.42);
  });

  it('defaults to Date.now and Math.random when not provided', () => {
    const engine = new GovernanceEngine(null);
    const t = engine._now();
    expect(typeof t).toBe('number');
    expect(Math.abs(t - Date.now())).toBeLessThan(50);
    const r = engine._random();
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(1);
  });

  it('all internal timing uses injected now() (no Date.now leakage)', () => {
    let mockTime = 10000;
    const engine = new GovernanceEngine(null, { now: () => mockTime });
    engine._lastEvaluationTs = null;
    engine._schedulePulse(500);
    mockTime = 99999999;
    expect(engine._now()).toBe(99999999);
  });
});
