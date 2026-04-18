import { describe, it, expect, jest } from '@jest/globals';
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));
const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine eligible users lookup', () => {
  it('returns eligible_users for equipment from session catalog', () => {
    const session = {
      _deviceRouter: {
        getEquipmentCatalog: () => [
          { id: 'cycle_ace', eligible_users: ['kckern', 'felix'] },
          { id: 'tricycle', eligible_users: ['milo'] }
        ]
      }
    };
    const engine = new GovernanceEngine(session);
    expect(engine._getEligibleUsers('cycle_ace')).toEqual(['kckern', 'felix']);
    expect(engine._getEligibleUsers('tricycle')).toEqual(['milo']);
    expect(engine._getEligibleUsers('unknown')).toEqual([]);
  });

  it('returns empty array when no session', () => {
    const engine = new GovernanceEngine(null);
    expect(engine._getEligibleUsers('anything')).toEqual([]);
  });

  it('returns empty array when equipment has no eligible_users field', () => {
    const session = {
      _deviceRouter: {
        getEquipmentCatalog: () => [{ id: 'cycle_ace' }]  // no eligible_users
      }
    };
    const engine = new GovernanceEngine(session);
    expect(engine._getEligibleUsers('cycle_ace')).toEqual([]);
  });

  it('returns a copy, not a reference', () => {
    const session = {
      _deviceRouter: {
        getEquipmentCatalog: () => [{ id: 'cycle_ace', eligible_users: ['kckern'] }]
      }
    };
    const engine = new GovernanceEngine(session);
    const result = engine._getEligibleUsers('cycle_ace');
    result.push('felix');
    expect(engine._getEligibleUsers('cycle_ace')).toEqual(['kckern']);
  });
});
