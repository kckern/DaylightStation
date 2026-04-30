import { describe, it, expect, beforeEach } from '@jest/globals';

const { DeviceEventRouter } = await import('#frontend/hooks/fitness/DeviceEventRouter.js');

describe('DeviceEventRouter equipment catalog', () => {
  let router;

  beforeEach(() => {
    router = new DeviceEventRouter({});
  });

  it('returns [] before any catalog is set', () => {
    expect(router.getEquipmentCatalog()).toEqual([]);
  });

  it('returns the entries previously set via setEquipmentCatalog', () => {
    const entries = [
      { id: 'cycle_ace', cadence: 49904, eligible_users: ['felix'] },
      { id: 'tricycle', cadence: 7153, eligible_users: ['niels'] }
    ];
    router.setEquipmentCatalog(entries);
    expect(router.getEquipmentCatalog()).toEqual(entries);
  });

  it('returns a defensive copy so callers cannot mutate the internal list', () => {
    const entries = [{ id: 'x', cadence: 1 }];
    router.setEquipmentCatalog(entries);
    const result = router.getEquipmentCatalog();
    result.push({ id: 'mutation' });
    expect(router.getEquipmentCatalog()).toHaveLength(1);
  });
});
