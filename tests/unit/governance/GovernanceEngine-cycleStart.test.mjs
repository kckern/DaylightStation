// tests/unit/governance/GovernanceEngine-cycleStart.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() }),
  getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() })
}));
const { GovernanceEngine } = await import("../../../__app_modules/wellness/fitness/browser/hooks/fitness/GovernanceEngine.js");

function seededRng(seed) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

describe('GovernanceEngine cycle challenge start', () => {
  let engine;
  let nowValue;
  beforeEach(() => {
    nowValue = 10000;
    const session = {
      _deviceRouter: {
        getEquipmentCatalog: () => [
          { id: 'cycle_ace', eligible_users: ['user_2', 'user_3'] }
        ]
      }
    };
    engine = new GovernanceEngine(session, { now: () => nowValue, random: seededRng(1) });
  });

  const sampleSelection = () => ({
    id: 'test_cycle',
    type: 'cycle',
    equipment: 'cycle_ace',
    label: 'Test cycle',
    init: { minRpm: 30, timeAllowedSeconds: 60 },
    hiRpmRange: [50, 80],
    segmentCount: [3, 3],
    segmentDurationSeconds: [20, 20],
    rampSeconds: [10, 10],
    loRpmRatio: 0.75,
    sequenceType: 'random',
    userCooldownSeconds: 600,
    boost: { zoneMultipliers: {}, maxTotalMultiplier: 3.0 }
  });

  it('picks a rider from eligible users and sets cycleState=init', () => {
    const active = engine._startCycleChallenge(sampleSelection(), { policyId: 'default', policyName: 'Default', configId: 'default_challenge_0' });
    expect(active).toBeTruthy();
    expect(active.type).toBe('cycle');
    expect(active.cycleState).toBe('init');
    expect(active.rider).toMatch(/user_2|user_3/);
    expect(active.ridersUsed).toEqual([active.rider]);
    expect(active.currentPhaseIndex).toBe(0);
    expect(active.generatedPhases).toHaveLength(3);
    expect(active.initStartedAt).toBe(nowValue);
    expect(active.phaseProgressMs).toBe(0);
    expect(active.rampElapsedMs).toBe(0);
    expect(active.initElapsedMs).toBe(0);
    expect(active.totalLockEventsCount).toBe(0);
    expect(active.totalBoostedMs).toBe(0);
    expect(active.status).toBe('pending');
    expect(active.equipment).toBe('cycle_ace');
    expect(active.startedAt).toBe(nowValue);
    expect(active.selection).toBeTruthy();
    expect(active.boostContributors instanceof Set).toBe(true);
  });

  it('rejects with equipment_not_found when the equipment has no catalog entry (no eligible users)', () => {
    // Since 50a77af429 the start helper returns a { ok: false, reason } result
    // instead of null so triggerChallenge can surface the specific reason.
    const selection = { ...sampleSelection(), equipment: 'nonexistent' };
    expect(engine._startCycleChallenge(selection, {})).toEqual({ ok: false, reason: 'equipment_not_found' });
  });

  it('filters out riders on cooldown', () => {
    engine._cycleCooldowns = { user_2: nowValue + 5000, user_3: nowValue + 5000 };
    expect(engine._startCycleChallenge(sampleSelection(), {})).toEqual({ ok: false, reason: 'all_riders_on_cooldown' });
  });

  it('rider with expired cooldown is eligible', () => {
    engine._cycleCooldowns = { user_2: nowValue - 1, user_3: nowValue - 1 };
    const active = engine._startCycleChallenge(sampleSelection(), {});
    expect(active).toBeTruthy();
    expect(active.rider).toMatch(/user_2|user_3/);
  });

  it('populates id with timestamp suffix', () => {
    const active = engine._startCycleChallenge(sampleSelection(), {});
    expect(active.id).toMatch(/^test_cycle_\d+$/);
  });

  it('initTotalMs correctly computed from selection.init.timeAllowedSeconds', () => {
    const active = engine._startCycleChallenge(sampleSelection(), {});
    expect(active.initTotalMs).toBe(60000);
  });
});
