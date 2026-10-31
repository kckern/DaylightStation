import { describe, expect, it, vi } from 'vitest';
import { applyEquipmentCatalogFromConfig, equipmentCatalogIdentity, riderSelectorsFromConfig } from "./fitnessConfigBridge.js";

describe('rider selector config bridge', () => {
  const selectors = [{ id: 'bike-selector', equipment: 'bike', buttons: { '1_single': 'rider' } }];
  it('preserves flat API selectors when the app has created a nested fitness envelope', () => {
    expect(riderSelectorsFromConfig({ selectors, fitness: { users: {} } })).toBe(selectors);
  });
  it('supports both config shapes and respects an explicitly empty nested roster', () => {
    expect(riderSelectorsFromConfig({ selectors })).toBe(selectors);
    expect(riderSelectorsFromConfig({ fitness: { selectors } })).toBe(selectors);
    expect(riderSelectorsFromConfig({ selectors, fitness: { selectors: [] } })).toEqual([]);
    expect(riderSelectorsFromConfig({})).toEqual([]);
  });
});

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
