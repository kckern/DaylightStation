import { describe, it, expect, beforeEach } from '@jest/globals';

const { FitnessSession } = await import('#frontend/hooks/fitness/FitnessSession.js');
const { applyEquipmentCatalogFromConfig } = await import('#frontend/context/fitnessConfigBridge.js');

describe('fitnessConfigBridge.applyEquipmentCatalogFromConfig', () => {
  let session;

  beforeEach(() => {
    session = new FitnessSession({});
  });

  it('passes equipment from config.fitness.equipment to the session', () => {
    const cfg = {
      fitness: {
        equipment: [
          { id: 'cycle_ace', cadence: 49904, eligible_users: ['felix'] }
        ]
      }
    };
    applyEquipmentCatalogFromConfig(session, cfg);
    expect(session.getEquipmentCatalog()).toEqual(cfg.fitness.equipment);
  });

  it('passes equipment from top-level config.equipment as fallback', () => {
    const cfg = { equipment: [{ id: 'tricycle', cadence: 7153 }] };
    applyEquipmentCatalogFromConfig(session, cfg);
    expect(session.getEquipmentCatalog()).toEqual(cfg.equipment);
  });

  it('clears the catalog when config has no equipment', () => {
    session.setEquipmentCatalog([{ id: 'old' }]);
    applyEquipmentCatalogFromConfig(session, { fitness: {} });
    expect(session.getEquipmentCatalog()).toEqual([]);
  });

  it('is a no-op when session is null', () => {
    expect(() => applyEquipmentCatalogFromConfig(null, {})).not.toThrow();
  });
});
