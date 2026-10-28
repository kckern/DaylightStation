// tests/unit/governance/GovernanceEngine-cycleTrigger.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() }),
  getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() })
}));
const { GovernanceEngine } = await import("../../../__app_modules/wellness/fitness/browser/hooks/fitness/GovernanceEngine.js");

function seededRng(seed) { let s = seed; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }

describe('GovernanceEngine.triggerChallenge with type=cycle', () => {
  let engine, nowValue, selectionId;

  beforeEach(() => {
    nowValue = 10000;
    const session = {
      _deviceRouter: { getEquipmentCatalog: () => [{ id: 'cycle_ace', eligible_users: ['user_2', 'user_3'] }] },
      getParticipantProfile: () => null, zoneProfileStore: null,
      getActiveParticipantState: () => ({ participants: ['user_2'], zoneMap: { user_2: 'warm' }, totalCount: 1 })
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
    expect(['user_2', 'user_3']).toContain(engine.challengeState.activeChallenge.rider);
  });

  it('triggerChallenge with riderId forces that rider', () => {
    const result = engine.triggerChallenge({ type: 'cycle', selectionId, riderId: 'user_3' });
    expect(result.success).toBe(true);
    expect(engine.challengeState.activeChallenge.rider).toBe('user_3');
  });

  it('triggerChallenge with riderId bypasses cooldown', () => {
    engine._cycleCooldowns = { user_3: nowValue + 100000 };
    const result = engine.triggerChallenge({ type: 'cycle', selectionId, riderId: 'user_3' });
    expect(result.success).toBe(true);
    expect(engine.challengeState.activeChallenge.rider).toBe('user_3');
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

  it('non-cycle triggerChallenge preserves existing behavior (returns undefined, queues forceStartRequest)', () => {
    // Legacy path: a payload with no type sets forceStartRequest and pulses.
    // The pulse evaluates synchronously (session has getActiveParticipantState),
    // and since 2153e4d9e2 a manual start cannot override an unmet floor — it
    // is dropped in that same evaluate (the floor is unmet in this fixture —
    // verified: the drop at the force_start_dropped branch is what clears it).
    // Observe the queued request at the moment the pulse runs.
    const seenAtEvaluate = [];
    const originalEvaluate = engine.evaluate.bind(engine);
    engine.evaluate = (...args) => {
      seenAtEvaluate.push(engine.challengeState.forceStartRequest);
      return originalEvaluate(...args);
    };
    const result = engine.triggerChallenge({ label: 'something' });  // no type
    expect(result).toBeUndefined();
    expect(seenAtEvaluate[0]).toEqual({ requestedAt: nowValue, payload: { label: 'something' } });
    // Dropped (floor unmet), and it never fell into the cycle path.
    expect(engine.challengeState.forceStartRequest).toBeNull();
    expect(engine.challengeState.activeChallenge).toBeFalsy();
  });
});
