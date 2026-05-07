import { describe, it, expect } from 'vitest';
import {
  computeFitnessBaseline, computeNutritionBaseline, computeWeightBaseline,
} from '../../../../../backend/src/3_applications/agents/health-coach/services/PersonalBaselineService.mjs';

describe('computeFitnessBaseline', () => {
  it('rolls workouts/week by kind from event list', () => {
    const events = [
      ...Array(12).fill(null).map(() => ({ kind: 'run', duration_min: 35, hr_avg: 148, hr_max: 172, distance_mi: 4.5 })),
      ...Array(8).fill(null).map(() => ({ kind: 'strength', duration_min: 30 })),
    ];
    const r = computeFitnessBaseline({ events, period_days: 90 });
    expect(r.n).toBe(20);
    expect(r.workouts_per_week_total).toBeCloseTo(1.55, 1); // 20/90*7
    expect(r.workouts_per_week_by_kind.run).toBeCloseTo(0.93, 1);
    expect(r.workouts_per_week_by_kind.strength).toBeCloseTo(0.62, 1);
    expect(r.run.median_duration_min).toBe(35);
    expect(r.run.median_hr_avg).toBe(148);
    expect(r.run.median_hr_max).toBe(172);
    expect(r.strength.median_duration_min).toBe(30);
  });

  it('handles empty input', () => {
    const r = computeFitnessBaseline({ events: [], period_days: 90 });
    expect(r.n).toBe(0);
    expect(r.workouts_per_week_total).toBe(0);
    expect(r.run).toBe(null);
    expect(r.strength).toBe(null);
  });

  it('returns null kind block when no events of that kind', () => {
    const events = [{ kind: 'walk', duration_min: 30 }];
    const r = computeFitnessBaseline({ events, period_days: 90 });
    expect(r.run).toBe(null);
    expect(r.strength).toBe(null);
  });

  it('skips events with missing duration when computing medians', () => {
    const events = [
      { kind: 'run', duration_min: 30, hr_avg: 145 },
      { kind: 'run', duration_min: null, hr_avg: 150 },  // dropped from medians
      { kind: 'run', duration_min: 40, hr_avg: 155 },
    ];
    const r = computeFitnessBaseline({ events, period_days: 90 });
    expect(r.run.n).toBe(2);  // only 2 had duration_min
  });
});

describe('computeNutritionBaseline', () => {
  it('returns kcal_avg + protein_g_avg from per-day logs', () => {
    const logs = [
      { date: '2026-04-01', totals: { calories: 2200, protein_g: 130 } },
      { date: '2026-04-02', totals: { calories: 2400, protein_g: 140 } },
      { date: '2026-04-03', totals: { calories: 2000, protein_g: 120 } },
    ];
    const r = computeNutritionBaseline({ logs, period_days: 30 });
    expect(r.n).toBe(3);
    expect(r.days).toBe(3);
    expect(r.kcal_avg).toBe(2200);
    expect(r.protein_g_avg).toBe(130);
  });

  it('aggregates multiple logs on the same day', () => {
    const logs = [
      { date: '2026-04-01', totals: { calories: 800, protein_g: 50 } },
      { date: '2026-04-01', totals: { calories: 1400, protein_g: 80 } },  // same day
      { date: '2026-04-02', totals: { calories: 2400, protein_g: 140 } },
    ];
    const r = computeNutritionBaseline({ logs, period_days: 30 });
    expect(r.days).toBe(2);
    expect(r.kcal_avg).toBe(2300);  // 4600 / 2
  });

  it('handles empty input', () => {
    const r = computeNutritionBaseline({ logs: [], period_days: 30 });
    expect(r.n).toBe(0);
    expect(r.kcal_avg).toBe(null);
    expect(r.protein_g_avg).toBe(null);
  });
});

describe('computeWeightBaseline', () => {
  it('returns trim mean + slope', () => {
    const points = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-04-${String(i + 1).padStart(2, '0')}`,
      weight_lbs: 175 + (i * 0.05),
    }));
    const r = computeWeightBaseline({ points, period_days: 30 });
    expect(r.n).toBe(30);
    expect(r.trim_mean).toBeCloseTo(175.7, 0);
    expect(r.slope_lbs_per_30d).toBeGreaterThan(0);
  });

  it('handles empty input', () => {
    const r = computeWeightBaseline({ points: [], period_days: 30 });
    expect(r.n).toBe(0);
    expect(r.trim_mean).toBe(null);
    expect(r.slope_lbs_per_30d).toBe(null);
  });

  it('drops non-finite weight values', () => {
    const points = [
      { date: '2026-04-01', weight_lbs: 175 },
      { date: '2026-04-02', weight_lbs: null },
      { date: '2026-04-03', weight_lbs: 175.2 },
    ];
    const r = computeWeightBaseline({ points, period_days: 30 });
    expect(r.n).toBe(2);
  });
});
