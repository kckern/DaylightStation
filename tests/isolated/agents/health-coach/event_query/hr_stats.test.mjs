// tests/isolated/agents/health-coach/event_query/hr_stats.test.mjs
import { describe, it, expect } from 'vitest';
import { computeHrStats } from '../../../../../backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs';

describe('computeHrStats', () => {
  it('returns null fields for empty/missing series', () => {
    const empty = {
      n: 0, mean: null, max: null, min: null, p50: null, p90: null,
      drift_pct: null,
      bands: { lt120: 0, b120_139: 0, b140_159: 0, b160_179: 0, gte180: 0 },
    };
    expect(computeHrStats([])).toEqual(empty);
    expect(computeHrStats(null)).toEqual(empty);
    expect(computeHrStats(undefined)).toEqual(empty);
  });

  it('computes mean/max/min over a flat series', () => {
    const s = Array(60).fill(140);
    const r = computeHrStats(s);
    expect(r.n).toBe(60);
    expect(r.mean).toBe(140);
    expect(r.max).toBe(140);
    expect(r.min).toBe(140);
    expect(r.p50).toBe(140);
    expect(r.p90).toBe(140);
  });

  it('drops nullish values', () => {
    const s = [120, null, 130, undefined, 140, 'oops', 150]; // string + null/undefined dropped
    const r = computeHrStats(s);
    expect(r.n).toBe(4);
    expect(r.min).toBe(120);
    expect(r.max).toBe(150);
  });

  it('computes drift_pct as (last-third mean / first-third mean - 1) * 100', () => {
    // First third 130, last third 150 → drift = (150/130 - 1)*100 ≈ 15.38
    const s = [...Array(20).fill(130), ...Array(20).fill(140), ...Array(20).fill(150)];
    const r = computeHrStats(s);
    expect(r.drift_pct).toBeCloseTo(15.38, 1);
  });

  it('counts seconds in HR bands', () => {
    const s = [
      ...Array(10).fill(110),  // <120 → 10
      ...Array(20).fill(130),  // 120-139 → 20
      ...Array(30).fill(150),  // 140-159 → 30
      ...Array(15).fill(170),  // 160-179 → 15
      ...Array(5).fill(185),   // ≥180 → 5
    ];
    const r = computeHrStats(s);
    expect(r.bands).toEqual({ lt120: 10, b120_139: 20, b140_159: 30, b160_179: 15, gte180: 5 });
  });

  it('returns drift_pct null when series < 9 points', () => {
    const r = computeHrStats([130, 140, 150, 160]);
    expect(r.drift_pct).toBe(null);
  });

  it('rounds mean and drift_pct to 1dp / 2dp', () => {
    // n=10, sum=1234, mean=123.4
    const s = [120, 121, 122, 123, 124, 125, 126, 124, 125, 124];
    const r = computeHrStats(s);
    expect(r.mean).toBe(123.4);
  });
});
