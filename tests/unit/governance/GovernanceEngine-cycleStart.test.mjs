// tests/unit/governance/GovernanceEngine-cycleStart.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));
const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

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
          { id: 'cycle_ace', eligible_users: ['felix', 'milo'] }
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
    expect(active.rider).toMatch(/felix|milo/);
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

  it('returns null when no eligible users available', () => {
    const selection = { ...sampleSelection(), equipment: 'nonexistent' };
    expect(engine._startCycleChallenge(selection, {})).toBeNull();
  });

  it('filters out riders on cooldown', () => {
    engine._cycleCooldowns = { felix: nowValue + 5000, milo: nowValue + 5000 };
    expect(engine._startCycleChallenge(sampleSelection(), {})).toBeNull();
  });

  it('rider with expired cooldown is eligible', () => {
    engine._cycleCooldowns = { felix: nowValue - 1, milo: nowValue - 1 };
    const active = engine._startCycleChallenge(sampleSelection(), {});
    expect(active).toBeTruthy();
    expect(active.rider).toMatch(/felix|milo/);
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
