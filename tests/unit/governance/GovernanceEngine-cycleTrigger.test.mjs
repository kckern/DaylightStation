// tests/unit/governance/GovernanceEngine-cycleTrigger.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));
const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

function seededRng(seed) { let s = seed; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }

describe('GovernanceEngine.triggerChallenge with type=cycle', () => {
  let engine, nowValue, selectionId;

  beforeEach(() => {
    nowValue = 10000;
    const session = {
      _deviceRouter: { getEquipmentCatalog: () => [{ id: 'cycle_ace', eligible_users: ['felix', 'milo'] }] },
      getParticipantProfile: () => null, zoneProfileStore: null,
      getActiveParticipantState: () => ({ participants: ['felix'], zoneMap: { felix: 'warm' }, totalCount: 1 })
    };
    engine = new GovernanceEngine(session, { now: () => nowValue, random: seededRng(1) });
    engine.configure({
      governed_labels: ['cardio'], grace_period_seconds: 30,
      policies: {
        default: {
          base_requirement: [{ active: 'all' }],
          challenges: [{
            interval: [60, 60],
            selections: [{
              type: 'cycle', equipment: 'cycle_ace',
              hi_rpm_range: [60, 60], segment_count: [1, 1],
              segment_duration_seconds: [2, 2], ramp_seconds: [5, 5],
              init: { min_rpm: 30, time_allowed_seconds: 10 },
              lo_rpm_ratio: 0.5, user_cooldown_seconds: 300, time_allowed: 999
            }]
          }]
        }
      }
    });
    engine.setMedia({ id: 'v1', type: 'episode', labels: ['cardio'] });
    // Selection IDs generated as `${policyId}_${challengeIdx}_${selectionIdx}` per Task 5
    selectionId = 'default_0_0';
  });

  it('triggerChallenge({ type:"cycle", selectionId }) starts cycle with random rider', () => {
    const result = engine.triggerChallenge({ type: 'cycle', selectionId });
    expect(result.success).toBe(true);
    expect(result.challengeId).toBeDefined();
    expect(engine.challengeState.activeChallenge?.type).toBe('cycle');
    expect(['felix', 'milo']).toContain(engine.challengeState.activeChallenge.rider);
  });

  it('triggerChallenge with riderId forces that rider', () => {
    const result = engine.triggerChallenge({ type: 'cycle', selectionId, riderId: 'milo' });
    expect(result.success).toBe(true);
    expect(engine.challengeState.activeChallenge.rider).toBe('milo');
  });

  it('triggerChallenge with riderId bypasses cooldown', () => {
    engine._cycleCooldowns = { milo: nowValue + 100000 };
    const result = engine.triggerChallenge({ type: 'cycle', selectionId, riderId: 'milo' });
    expect(result.success).toBe(true);
    expect(engine.challengeState.activeChallenge.rider).toBe('milo');
  });

  it('rejects unknown selectionId', () => {
    const result = engine.triggerChallenge({ type: 'cycle', selectionId: 'nonexistent' });
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/selection/);
  });

  it('rejects non-eligible riderId', () => {
    const result = engine.triggerChallenge({ type: 'cycle', selectionId, riderId: 'eve' });
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/eligible/);
  });

  it('non-cycle triggerChallenge preserves existing behavior (returns undefined, sets forceStartRequest)', () => {
    // Existing behavior — passing no type OR a different payload shape sets forceStartRequest
    const before = engine.challengeState.forceStartRequest;
    engine.triggerChallenge({ label: 'something' });  // no type
    expect(engine.challengeState.forceStartRequest).not.toBe(before); // mutated
  });
});
