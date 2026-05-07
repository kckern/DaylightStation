// tests/isolated/agents/health-coach/adapters/weight_adapter.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { WeightEventAdapter } from '../../../../../backend/src/3_applications/agents/health-coach/services/adapters/WeightEventAdapter.mjs';

const FROZEN_NOW = () => new Date('2026-05-07T12:00:00Z');

// Mimics HealthMetric instances — adapter only needs .weight + .date getters,
// not the full HealthMetric class.
function makeMetric({ date, lbs, fatPercent = null }) {
  return {
    date,
    weight: lbs != null ? { lbs, fatPercent } : null,
    hasWeight() { return this.weight !== null && this.weight.lbs !== undefined; },
  };
}

describe('WeightEventAdapter', () => {
  it('list returns weigh-in events with kind=weigh_in', async () => {
    const range = {
      '2026-05-07': makeMetric({ date: '2026-05-07', lbs: 175.2, fatPercent: 18.4 }),
      '2026-05-06': makeMetric({ date: '2026-05-06', lbs: 175.6 }),
    };
    const svc = new WeightEventAdapter({
      healthService: { getHealthForRange: vi.fn(async () => range) },
      userId: 'kckern',
      now: FROZEN_NOW,
    });
    const r = await svc.list({ period: { rolling: 'last_7d' } });
    expect(r.events).toHaveLength(2);
    expect(r.events[0].kind).toBe('weigh_in');
    expect(r.events[0].scalars.weight_lbs).toBeDefined();
    expect(r.events[0].label).toMatch(/lbs/);
  });

  it('list skips days without weight data', async () => {
    const range = {
      '2026-05-07': makeMetric({ date: '2026-05-07', lbs: 175.2 }),
      '2026-05-06': makeMetric({ date: '2026-05-06', lbs: null }),  // no weigh-in this day
      '2026-05-05': makeMetric({ date: '2026-05-05', lbs: 175.4 }),
    };
    const svc = new WeightEventAdapter({
      healthService: { getHealthForRange: vi.fn(async () => range) },
      userId: 'kckern',
      now: FROZEN_NOW,
    });
    const r = await svc.list({ period: { rolling: 'last_7d' } });
    expect(r.events).toHaveLength(2);
    expect(r.events.map(e => e.id).sort()).toEqual(['2026-05-05', '2026-05-07']);
  });

  it('list orders events newest-first', async () => {
    const range = {
      '2026-05-05': makeMetric({ date: '2026-05-05', lbs: 175.0 }),
      '2026-05-07': makeMetric({ date: '2026-05-07', lbs: 175.2 }),
      '2026-05-06': makeMetric({ date: '2026-05-06', lbs: 175.4 }),
    };
    const svc = new WeightEventAdapter({
      healthService: { getHealthForRange: vi.fn(async () => range) },
      userId: 'kckern',
      now: FROZEN_NOW,
    });
    const r = await svc.list({ period: { rolling: 'last_7d' } });
    expect(r.events.map(e => e.id)).toEqual(['2026-05-07', '2026-05-06', '2026-05-05']);
  });

  it('detail returns the focal day + 5-day context window', async () => {
    const range = {
      '2026-05-03': makeMetric({ date: '2026-05-03', lbs: 175.5 }),
      '2026-05-04': makeMetric({ date: '2026-05-04', lbs: 175.4 }),
      '2026-05-05': makeMetric({ date: '2026-05-05', lbs: 175.2 }),
      '2026-05-06': makeMetric({ date: '2026-05-06', lbs: 175.0 }),
      '2026-05-07': makeMetric({ date: '2026-05-07', lbs: 174.8 }),
    };
    const svc = new WeightEventAdapter({
      healthService: { getHealthForRange: vi.fn(async () => range) },
      userId: 'kckern',
      now: FROZEN_NOW,
    });
    const r = await svc.detail('2026-05-05');
    expect(r.id).toBe('2026-05-05');
    expect(r.scalars.weight_lbs).toBe(175.2);
    expect(r.context_window).toHaveLength(5);
    expect(r.context_window.every(p => /^2026-05-0[3-7]$/.test(p.date))).toBe(true);
  });

  it('detail returns error when date has no weigh-in', async () => {
    const range = { '2026-05-05': makeMetric({ date: '2026-05-05', lbs: null }) };
    const svc = new WeightEventAdapter({
      healthService: { getHealthForRange: vi.fn(async () => range) },
      userId: 'kckern',
      now: FROZEN_NOW,
    });
    const r = await svc.detail('2026-05-05');
    expect(r.error).toMatch(/not found/);
  });

  it('summary returns trim mean + 30d slope', async () => {
    // 30 daily weigh-ins, gentle uptrend (175.0 → 176.45)
    const range = {};
    for (let i = 0; i < 30; i++) {
      const d = `2026-04-${String(i + 1).padStart(2, '0')}`;
      range[d] = makeMetric({ date: d, lbs: 175 + (i * 0.05) });
    }
    const svc = new WeightEventAdapter({
      healthService: { getHealthForRange: vi.fn(async () => range) },
      userId: 'kckern',
      now: FROZEN_NOW,
    });
    const r = await svc.summary({ period: { rolling: 'last_30d' } });
    expect(r.kind).toBe('weigh_in');
    expect(r.n).toBe(30);
    expect(r.trim_mean).toBeCloseTo(175.7, 0);
    expect(r.slope_lbs_per_30d).toBeGreaterThan(0);
  });

  it('summary handles empty range', async () => {
    const svc = new WeightEventAdapter({
      healthService: { getHealthForRange: vi.fn(async () => ({})) },
      userId: 'kckern',
      now: FROZEN_NOW,
    });
    const r = await svc.summary({ period: { rolling: 'last_30d' } });
    expect(r.n).toBe(0);
    expect(r.trim_mean).toBe(null);
    expect(r.slope_lbs_per_30d).toBe(null);
  });
});
