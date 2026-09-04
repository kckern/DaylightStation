import { describe, expect, it, vi } from 'vitest';
import { applyEquipmentCatalogFromConfig, equipmentCatalogIdentity } from './fitnessConfigBridge.js';

describe('equipment config bridge', () => {
  const mat = { id: 'step_mat', type: 'pressure_mat', pressure_mat: 'mat-1', activity: { spm_window_seconds: 15 } };
  it('logs an identity independent of equipment ordering but sensitive to mat binding and rate settings', () => {
    const bike = { id: 'bike', type: 'cycle' };
    expect(equipmentCatalogIdentity([mat, bike])).toBe(equipmentCatalogIdentity([bike, mat]));
    expect(equipmentCatalogIdentity([mat])).not.toBe(equipmentCatalogIdentity([{ ...mat, pressure_mat: 'mat-2' }]));
    expect(equipmentCatalogIdentity([mat])).not.toBe(equipmentCatalogIdentity([{ ...mat, activity: { spm_window_seconds: 30 } }]));
  });
  it('passes the effective catalog to the session on every refresh without owning runtime state', () => {
    const session = { setEquipmentCatalog: vi.fn() };
    applyEquipmentCatalogFromConfig(session, { fitness: { equipment: [mat] } });
    applyEquipmentCatalogFromConfig(session, { equipment: [mat] });
    applyEquipmentCatalogFromConfig(session, {});
    expect(session.setEquipmentCatalog.mock.calls).toEqual([[[mat]], [[mat]], [[]]]);
  });
});
