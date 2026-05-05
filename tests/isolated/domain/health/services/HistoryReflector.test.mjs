// tests/isolated/domain/health/services/HistoryReflector.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { HistoryReflector } from '../../../../../backend/src/2_domains/health/services/HistoryReflector.mjs';

function makeReflector(overrides = {}) {
  const aggregator = {
    snapshot: vi.fn(async () => ({
      period: { from: '2020-01-01', to: '2026-05-05', label: 'all_time', source: 'rolling' },
      metrics: [
        { metric: 'weight_lbs', value: 195, daysCovered: 100, daysInPeriod: 1900 },
      ],
    })),
  };
  const trendAnalyzer = {
    detectRegimeChange: vi.fn(async () => ({ changes: [] })),
  };
  const periodMemory = {
    deducePeriod: vi.fn(async () => ({ candidates: [] })),
  };
  return new HistoryReflector({
    aggregator: overrides.aggregator || aggregator,
    trendAnalyzer: overrides.trendAnalyzer || trendAnalyzer,
    periodMemory: overrides.periodMemory || periodMemory,
  });
}

describe('HistoryReflector.analyzeHistory', () => {
  it('returns snapshot + candidates + observations shape', async () => {
    const reflector = makeReflector();
    const out = await reflector.analyzeHistory({ userId: 'kc' });
    expect(out.summary).toBeDefined();
    expect(out.summary.metrics.length).toBeGreaterThan(0);
    expect(Array.isArray(out.candidates)).toBe(true);
    expect(Array.isArray(out.observations)).toBe(true);
  });

  it('focus=weight only runs weight-related criteria', async () => {
    const periodMemory = {
      deducePeriod: vi.fn(async () => ({ candidates: [] })),
    };
    const reflector = makeReflector({ periodMemory });
    await reflector.analyzeHistory({ userId: 'kc', focus: 'weight' });
    // deducePeriod called at least once for weight_lbs
    const calls = periodMemory.deducePeriod.mock.calls.map(c => c[0]?.criteria?.metric);
    expect(calls).toContain('weight_lbs');
    expect(calls).not.toContain('tracking_density');
  });

  it('surfaces regime-change observations as text', async () => {
    const trendAnalyzer = {
      detectRegimeChange: vi.fn(async ({ metric }) => ({
        changes: [
          { date: '2024-08-15', confidence: 0.8, magnitude: 2.5, before: { mean: 200 }, after: { mean: 195 }, description: `mean shifted from 200 to 195` },
        ],
      })),
    };
    const reflector = makeReflector({ trendAnalyzer });
    const out = await reflector.analyzeHistory({ userId: 'kc' });
    expect(out.observations.length).toBeGreaterThan(0);
    const obs = out.observations.join(' ');
    expect(obs).toMatch(/2024-08-15/);
  });

  it('aggregates candidates from periodMemory across criteria', async () => {
    const periodMemory = {
      deducePeriod: vi.fn(async ({ criteria }) => ({
        candidates: [{
          slug: `${criteria.metric}-fake-1`,
          from: '2024-01-01', to: '2024-03-31', durationDays: 90,
          label: 'fake', stats: { mean: 195 }, score: 90,
        }],
      })),
    };
    const reflector = makeReflector({ periodMemory });
    const out = await reflector.analyzeHistory({ userId: 'kc' });
    expect(out.candidates.length).toBeGreaterThan(0);
  });
});
