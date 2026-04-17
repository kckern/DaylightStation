// tests/unit/governance/GovernanceEngine-cycleConfig.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));
const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine cycle config parsing', () => {
  let engine;
  beforeEach(() => { engine = new GovernanceEngine(null); });

  it('parses basic cycle selection with defaults', () => {
    const policies = engine._normalizePolicies({
      default: {
        name: 'Default',
        base_requirement: [{ active: 'all' }],
        challenges: [{
          interval: [30, 120],
          selections: [{
            type: 'cycle',
            equipment: 'cycle_ace',
            hi_rpm_range: [50, 90],
            segment_count: [3, 5],
            segment_duration_seconds: [20, 45],
            ramp_seconds: [10, 20],
            time_allowed: 999  // cycle ignores this, but parser still needs it not to reject
          }]
        }]
      }
    });
    const sel = policies[0].challenges[0].selections[0];
    expect(sel.type).toBe('cycle');
    expect(sel.equipment).toBe('cycle_ace');
    expect(sel.hiRpmRange).toEqual([50, 90]);
    expect(sel.segmentCount).toEqual([3, 5]);
    expect(sel.segmentDurationSeconds).toEqual([20, 45]);
    expect(sel.rampSeconds).toEqual([10, 20]);
    expect(sel.sequenceType).toBe('random');       // default
    expect(sel.loRpmRatio).toBe(0.75);             // default
    expect(sel.userCooldownSeconds).toBe(600);     // default
    expect(sel.init).toEqual({ minRpm: 30, timeAllowedSeconds: 60 });  // defaults
    expect(sel.boost).toBeTruthy();
    expect(sel.boost.zoneMultipliers).toEqual({});
    expect(sel.boost.maxTotalMultiplier).toBe(3.0);
  });

  it('parses init, boost, sequence_type, cooldown', () => {
    const policies = engine._normalizePolicies({
      default: {
        base_requirement: [{ active: 'all' }],
        challenges: [{
          interval: [60, 60],
          selections: [{
            type: 'cycle',
            equipment: 'cycle_ace',
            hi_rpm_range: [50, 90],
            segment_count: [3, 5],
            segment_duration_seconds: [20, 45],
            ramp_seconds: 15,
            init: { min_rpm: 40, time_allowed_seconds: 90 },
            sequence_type: 'progressive',
            lo_rpm_ratio: 0.8,
            user_cooldown_seconds: 300,
            boost: {
              zone_multipliers: { hot: 0.5, fire: 1.0 },
              max_total_multiplier: 2.5
            },
            time_allowed: 999
          }]
        }]
      }
    });
    const sel = policies[0].challenges[0].selections[0];
    expect(sel.init.minRpm).toBe(40);
    expect(sel.init.timeAllowedSeconds).toBe(90);
    expect(sel.sequenceType).toBe('progressive');
    expect(sel.loRpmRatio).toBe(0.8);
    expect(sel.userCooldownSeconds).toBe(300);
    expect(sel.boost.zoneMultipliers).toEqual({ hot: 0.5, fire: 1.0 });
    expect(sel.boost.maxTotalMultiplier).toBe(2.5);
    expect(sel.rampSeconds).toEqual([15, 15]);  // scalar becomes [N, N]
  });

  it('accepts explicit phases[] (overrides procedural)', () => {
    const policies = engine._normalizePolicies({
      default: {
        base_requirement: [{ active: 'all' }],
        challenges: [{
          interval: [60, 60],
          selections: [{
            type: 'cycle',
            equipment: 'cycle_ace',
            phases: [
              { hi_rpm: 60, lo_rpm: 45, ramp_seconds: 15, maintain_seconds: 30 },
              { hi_rpm: 70, lo_rpm: 55, ramp_seconds: 20, maintain_seconds: 45 }
            ],
            time_allowed: 999
          }]
        }]
      }
    });
    const sel = policies[0].challenges[0].selections[0];
    expect(sel.explicitPhases).toHaveLength(2);
    expect(sel.explicitPhases[0]).toEqual({ hiRpm: 60, loRpm: 45, rampSeconds: 15, maintainSeconds: 30 });
  });

  it('rejects cycle selection without equipment', () => {
    const policies = engine._normalizePolicies({
      default: {
        base_requirement: [{ active: 'all' }],
        challenges: [{
          interval: [60, 60],
          selections: [{ type: 'cycle', hi_rpm_range: [50, 90], time_allowed: 999 }]
        }]
      }
    });
    expect(policies[0].challenges[0].selections).toHaveLength(0);  // filtered out
  });

  it('rejects malformed numeric fields with silent fallback to defaults', () => {
    const policies = engine._normalizePolicies({
      default: {
        base_requirement: [{ active: 'all' }],
        challenges: [{
          interval: [60, 60],
          selections: [{
            type: 'cycle',
            equipment: 'cycle_ace',
            hi_rpm_range: [50, 90],
            segment_count: [3, 5],
            segment_duration_seconds: [20, 45],
            ramp_seconds: 15,
            user_cooldown_seconds: 'ten',       // bad
            lo_rpm_ratio: 'nope',                // bad
            init: { min_rpm: 'abc' },           // bad
            boost: { max_total_multiplier: {} }, // bad
            time_allowed: 999
          }]
        }]
      }
    });
    const sel = policies[0].challenges[0].selections[0];
    expect(sel.userCooldownSeconds).toBe(600);    // default
    expect(sel.loRpmRatio).toBe(0.75);            // default
    expect(sel.init.minRpm).toBe(30);             // default
    expect(sel.boost.maxTotalMultiplier).toBe(3.0); // default
  });

  it('drops malformed explicit phases', () => {
    const policies = engine._normalizePolicies({
      default: {
        base_requirement: [{ active: 'all' }],
        challenges: [{
          interval: [60, 60],
          selections: [{
            type: 'cycle',
            equipment: 'cycle_ace',
            phases: [
              { hi_rpm: 60, lo_rpm: 45, ramp_seconds: 15, maintain_seconds: 30 },
              { hi_rpm: 'garbage' }  // should be dropped
            ],
            time_allowed: 999
          }]
        }]
      }
    });
    const sel = policies[0].challenges[0].selections[0];
    expect(sel.explicitPhases).toHaveLength(1);
  });
});
