import { describe, it, expect } from 'vitest';
import { validateFoodItem, validateNutriLog } from './schemas.mjs';

const baseItem = {
  id: 'aB3dE5fG7h', label: 'Oatmeal', grams: 100, unit: 'g', amount: 100, color: 'yellow',
};

describe('validateFoodItem new lifecycle/group fields', () => {
  it('defaults kind to item and preserves group fields', () => {
    const r = validateFoodItem({ ...baseItem, kind: 'group', parentId: 'zZ9yX8wV7u', photoRef: 'ph_123' });
    expect(r.valid).toBe(true);
    expect(r.value.kind).toBe('group');
    expect(r.value.parentId).toBe('zZ9yX8wV7u');
    expect(r.value.photoRef).toBe('ph_123');
  });
  it('defaults kind=item, parentId/photoRef null when absent', () => {
    const r = validateFoodItem(baseItem);
    expect(r.value.kind).toBe('item');
    expect(r.value.parentId).toBeNull();
    expect(r.value.photoRef).toBeNull();
  });
  it('rejects unknown kind', () => {
    expect(validateFoodItem({ ...baseItem, kind: 'plate' }).valid).toBe(false);
  });
  it('preserves settled=false with settledBy/settledAt, and ABSENCE stays absent', () => {
    const r = validateFoodItem({ ...baseItem, settled: false, settledBy: 'user', settledAt: '2026-09-02 10:00:00' });
    expect(r.value.settled).toBe(false);
    expect(r.value.settledBy).toBe('user');
    const r2 = validateFoodItem(baseItem);
    expect('settled' in r2.value ? r2.value.settled : undefined).toBeUndefined();
  });
  it('preserves microsSource', () => {
    expect(validateFoodItem({ ...baseItem, microsSource: 'ai' }).value.microsSource).toBe('ai');
  });
  it('round-trips through validateNutriLog items', () => {
    const log = {
      id: 'aB3dE5fG7h', userId: 'u', status: 'accepted',
      meal: { date: '2026-09-02', time: 'morning' },
      items: [{ ...baseItem, settled: false, kind: 'item' }],
      createdAt: '2026-09-02 08:00:00', updatedAt: '2026-09-02 08:00:00',
    };
    const r = validateNutriLog(log);
    expect(r.valid).toBe(true);
    expect(r.value.items[0].settled).toBe(false);
  });
});
