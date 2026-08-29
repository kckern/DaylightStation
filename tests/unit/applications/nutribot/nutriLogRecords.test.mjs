import { describe, expect, it, vi } from 'vitest';
import { createNutriLog } from '#apps/nutribot/nutriLogRecords.mjs';

describe('createNutriLog identifier compatibility', () => {
  it('replaces a caller log id and reuses a UUID-valued item id as its uuid', () => {
    const itemId = '550e8400-e29b-41d4-a716-446655440000';
    const newUuid = vi.fn(() => '11111111-1111-4111-8111-111111111111');
    const log = createNutriLog({
      id: 'caller-owned-id',
      userId: 'u1',
      conversationId: 'c1',
      text: 'peas',
      items: [{ id: itemId, label: 'Peas', grams: 100, color: 'green', calories: 50, unit: 'g', amount: 100 }],
      meal: { date: '2026-08-28', time: 'afternoon' },
      timestamp: new Date('2026-08-28T12:00:00-07:00'),
    }, { newId: () => 'ZyXwVuTsRq', newUuid });

    expect(log.id).toBe('ZyXwVuTsRq');
    expect(log.items[0].id).toBe(itemId);
    expect(log.items[0].uuid).toBe(itemId);
    expect(newUuid).not.toHaveBeenCalled();
  });
});
