// tests/isolated/agents/health-coach/adapters/nutrition_adapter.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { NutritionEventAdapter } from '../../../../../backend/src/3_applications/agents/health-coach/services/adapters/NutritionEventAdapter.mjs';

const FROZEN_NOW = () => new Date('2026-05-07T12:00:00Z');

function makeLog({ id, createdAt, time = 'afternoon', date = '2026-05-07', calories = 480, protein = 32, items = [] }) {
  // Match NutriLog instance shape (getters)
  return {
    id, userId: 'kckern',
    meal: { date, time },
    items,
    nutrition: { calories, protein, carbs: 50, fat: 18 },
    createdAt: createdAt ?? `${date}T12:30:00Z`,
    isAccepted: true,
    totalGrams: 0,
    gramsByColor: { green: 0, yellow: 0, orange: 0 },
  };
}

describe('NutritionEventAdapter', () => {
  it('list returns meal events with kind=meal + scalars from nutrition', async () => {
    const logs = [
      makeLog({ id: 'a', createdAt: '2026-05-07T12:30:00Z', time: 'afternoon', calories: 480, protein: 32 }),
      makeLog({ id: 'b', createdAt: '2026-05-07T08:00:00Z', time: 'morning',   calories: 380, protein: 28 }),
    ];
    const svc = new NutritionEventAdapter({
      foodLogService: { getLogsInRange: vi.fn(async () => logs) },
      userId: 'kckern',
      now: FROZEN_NOW,
    });
    const r = await svc.list({ period: { rolling: 'last_1d' } });
    expect(r.events).toHaveLength(2);
    expect(r.events[0].kind).toBe('meal');
    expect(r.events[0].id).toBe('a');
    expect(r.events[0].scalars.kcal).toBe(480);
    expect(r.events[0].scalars.protein_g).toBe(32);
    expect(r.events[0].domain_extras.meal_time).toBe('afternoon');
    expect(r.events[0].label).toMatch(/afternoon.*480/);
  });

  it('list filters by meal time via filter.kind or filter.type', async () => {
    const logs = [
      makeLog({ id: 'a', time: 'morning', calories: 400 }),
      makeLog({ id: 'b', time: 'afternoon', calories: 600 }),
      makeLog({ id: 'c', time: 'morning', calories: 350 }),
    ];
    const svc = new NutritionEventAdapter({
      foodLogService: { getLogsInRange: vi.fn(async () => logs) },
      userId: 'kckern', now: FROZEN_NOW,
    });
    const r = await svc.list({ period: { rolling: 'last_1d' }, filter: { kind: 'morning' } });
    expect(r.events).toHaveLength(2);
    expect(r.events.every(e => e.domain_extras.meal_time === 'morning')).toBe(true);

    const r2 = await svc.list({ period: { rolling: 'last_1d' }, filter: { type: 'afternoon' } });
    expect(r2.events).toHaveLength(1);
    expect(r2.events[0].id).toBe('b');
  });

  it('detail returns full log + items_summary', async () => {
    const log = makeLog({
      id: 'a', createdAt: '2026-05-07T12:30:00Z', time: 'afternoon', calories: 480,
      items: [
        { name: 'Chicken thigh', calories: 280 },
        { name: 'Rice', calories: 200 },
        { name: 'Olive oil', calories: 60 },
      ],
    });
    const svc = new NutritionEventAdapter({
      foodLogService: { getLogById: vi.fn(async () => log) },
      userId: 'kckern', now: FROZEN_NOW,
    });
    const r = await svc.detail('a');
    expect(r.id).toBe('a');
    expect(r.scalars.kcal).toBe(480);
    expect(r.items_summary.count).toBe(3);
    expect(r.items_summary.top_kcal).toEqual(['Chicken thigh', 'Rice', 'Olive oil']);
    expect(r.log_full).toBeDefined();
  });

  it('detail returns error when log missing', async () => {
    const svc = new NutritionEventAdapter({
      foodLogService: { getLogById: vi.fn(async () => null) },
      userId: 'kckern', now: FROZEN_NOW,
    });
    const r = await svc.detail('missing');
    expect(r.error).toMatch(/not found/);
  });

  it('summary aggregates calories + protein across logs in the range', async () => {
    const logs = [
      makeLog({ id: 'a', createdAt: '2026-05-01T12:30:00Z', date: '2026-05-01', calories: 2200, protein: 130 }),
      makeLog({ id: 'b', createdAt: '2026-05-02T12:30:00Z', date: '2026-05-02', calories: 2400, protein: 140 }),
      makeLog({ id: 'c', createdAt: '2026-05-03T12:30:00Z', date: '2026-05-03', calories: 2000, protein: 120 }),
    ];
    const svc = new NutritionEventAdapter({
      foodLogService: { getLogsInRange: vi.fn(async () => logs) },
      userId: 'kckern', now: FROZEN_NOW,
    });
    const r = await svc.summary({ period: { rolling: 'last_7d' } });
    expect(r.kind).toBe('meal');
    expect(r.n).toBe(3);
    expect(r.days).toBe(3);
    expect(r.kcal_total).toBe(6600);
    expect(r.kcal_avg).toBe(2200);
    expect(r.protein_g_avg).toBe(130);
  });
});
