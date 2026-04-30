import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));
const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

// Normalized (camelCase) shape — matches what _normalizePolicies produces and
// what _generateCyclePhases expects when engine.policies is set directly.
const BASE_SELECTION = {
  id: 'cycle_sprint',
  type: 'cycle',
  equipment: 'cycle_ace',
  init: { minRpm: 30, timeAllowedSeconds: 60 },
  segmentCount: [3, 4],
  segmentDurationSeconds: [20, 40],
  rampSeconds: [10, 20],
  hiRpmRange: [50, 85],
  loRpmRatio: 0.75,
  sequenceType: 'progressive',
  explicitPhases: null,
  boost: { zoneMultipliers: {}, maxTotalMultiplier: 3.0 }
};

describe('GovernanceEngine.triggerChallenge — cycle rejection reasons', () => {
  let engine;

  beforeEach(() => {
    globalThis.window = {};
    engine = new GovernanceEngine({
      roster: [],
      snapshot: { zoneConfig: [] }
    });
    engine.policies = [{
      id: 'p',
      challenges: [{
        id: 'c',
        selections: [{ ...BASE_SELECTION }]
      }]
    }];
  });

  it('returns specific reason when selection id is unknown', () => {
    const result = engine.triggerChallenge({ type: 'cycle', selectionId: 'does_not_exist' });
    expect(result.success).toBe(false);
    expect(result.reason).toBe('selection_not_found');
    expect(result.reason).not.toBe('failed_to_start');
  });

  it('returns specific reason when equipment is missing from the catalog', () => {
    // No session / empty catalog — equipment 'cycle_ace' won't be found
    const result = engine.triggerChallenge({ type: 'cycle', selectionId: 'cycle_sprint' });
    expect(result.success).toBe(false);
    expect(['equipment_not_found', 'no_eligible_riders']).toContain(result.reason);
    expect(result.reason).not.toBe('failed_to_start');
  });

  it('returns specific reason when no riders are eligible', () => {
    engine.session = {
      _deviceRouter: {
        getEquipmentCatalog: () => [{ id: 'cycle_ace', cadence: 49904, eligible_users: [] }]
      }
    };
    const result = engine.triggerChallenge({ type: 'cycle', selectionId: 'cycle_sprint' });
    expect(result.success).toBe(false);
    expect(result.reason).toBe('no_eligible_riders');
    expect(result.reason).not.toBe('failed_to_start');
  });

  it('returns specific reason when all eligible riders are on cooldown', () => {
    engine.session = {
      _deviceRouter: {
        getEquipmentCatalog: () => [{ id: 'cycle_ace', eligible_users: ['felix'] }]
      }
    };
    // Put 'felix' on cooldown far in the future
    engine._cycleCooldowns = { felix: Date.now() + 999_000 };
    const result = engine.triggerChallenge({ type: 'cycle', selectionId: 'cycle_sprint' });
    expect(result.success).toBe(false);
    expect(result.reason).toBe('all_riders_on_cooldown');
    expect(result.reason).not.toBe('failed_to_start');
  });

  it('succeeds when a rider is available', () => {
    engine.session = {
      _deviceRouter: {
        getEquipmentCatalog: () => [{ id: 'cycle_ace', eligible_users: ['felix'] }]
      }
    };
    engine._cycleCooldowns = {};
    const result = engine.triggerChallenge({ type: 'cycle', selectionId: 'cycle_sprint' });
    expect(result.success).toBe(true);
    expect(result.challengeId).toBeDefined();
  });
});
