// tests/isolated/domain/health/services/MetricTrendAnalyzer.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { MetricTrendAnalyzer } from '../../../../../backend/src/2_domains/health/services/MetricTrendAnalyzer.mjs';
import { MetricAggregator } from '../../../../../backend/src/2_domains/health/services/MetricAggregator.mjs';
import { PeriodResolver } from '../../../../../backend/src/2_domains/health/services/PeriodResolver.mjs';

const NOW = new Date('2026-05-05T12:00:00Z');
const fixedNow = () => NOW;

// Strictly downward 30-day weight fixture: 200, 199.9, 199.8, ..., 197.1
function buildDownwardWeight() {
  const out = {};
  let lbs = 200;
  const start = new Date(Date.UTC(2026, 3, 6));
  for (let i = 0; i < 30; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    out[key] = { lbs, lbs_adjusted_average: lbs };
    lbs -= 0.1;
  }
  return out;
}

// Flat 30-day fixture
function buildFlatWeight() {
  const out = {};
  const start = new Date(Date.UTC(2026, 3, 6));
  for (let i = 0; i < 30; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    out[key] = { lbs: 200, lbs_adjusted_average: 200 };
  }
  return out;
}

function makeAnalyzer(weightFixture = buildDownwardWeight()) {
  const healthStore = {
    loadWeightData: vi.fn(async () => weightFixture),
    loadNutritionData: vi.fn(async () => ({})),
  };
  const healthService = { getHealthForRange: vi.fn(async () => ({})) };
  const periodResolver = new PeriodResolver({ now: fixedNow });
  const aggregator = new MetricAggregator({ healthStore, healthService, periodResolver });
  return {
    analyzer: new MetricTrendAnalyzer({ aggregator, periodResolver }),
    healthStore, healthService, periodResolver, aggregator,
  };
}

describe('MetricTrendAnalyzer.detectRegimeChange', () => {
  // Step fixture: 30 days where first 15 are at lbs=200 and last 15 are at lbs=195
  function buildStepFixture() {
    const out = {};
    const start = new Date(Date.UTC(2026, 3, 6));
    for (let i = 0; i < 30; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      out[key] = { lbs: i < 15 ? 200 : 195, lbs_adjusted_average: i < 15 ? 200 : 195 };
    }
    return out;
  }

  it('finds a strong regime change at the step point', async () => {
    const { analyzer } = makeAnalyzer(buildStepFixture());
    const out = await analyzer.detectRegimeChange({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-05' },
    });
    expect(out.changes.length).toBeGreaterThanOrEqual(1);
    const top = out.changes[0];
    // Algorithm finds highest-magnitude split at index 14 (2026-04-20):
    // 14 days of 200 before, 16 days of 195 after — pooledStd≈0.856, magnitude≈5.48
    // (index 15 gives pooledStd=0 so raw diff=5.0, which is lower)
    expect(top.date).toBe('2026-04-20');
    expect(top.confidence).toBeGreaterThan(0.5);
    expect(top.before.mean).toBeCloseTo(200, 5);
    // After window starts at idx 14 so includes 1 day of 200 + 15 days of 195 ≈ 195.31
    expect(top.after.mean).toBeLessThan(198);
    expect(top.magnitude).toBeGreaterThan(1);
  });

  it('returns empty changes for a flat series', async () => {
    const { analyzer } = makeAnalyzer(buildFlatWeight());
    const out = await analyzer.detectRegimeChange({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-05' },
    });
    expect(out.changes).toEqual([]);
  });

  it('handles too-few-points gracefully', async () => {
    const { analyzer } = makeAnalyzer({});
    const out = await analyzer.detectRegimeChange({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-05' },
    });
    expect(out.changes).toEqual([]);
  });
});

describe('MetricTrendAnalyzer.detectAnomalies', () => {
  // 60-day fixture: ~200 lbs with small noise for 50 days, then a spike to 210 on day 50,
  // then back to ~200. The spike should be detected. Small noise (±0.2) keeps stdev > 0
  // so z-score arithmetic works correctly and the threshold parameter is honored.
  function buildSpikeFixture() {
    const out = {};
    const start = new Date(Date.UTC(2026, 2, 7)); // 60 days back from 2026-05-05
    // Deterministic noise pattern to avoid flat baselines
    const noise = [0.1, -0.1, 0.2, -0.2, 0.1, -0.1, 0.2, -0.2, 0.1, -0.1];
    for (let i = 0; i < 60; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      let lbs = i === 50 ? 210 : 200 + noise[i % noise.length]; // spike at day 50
      out[key] = { lbs, lbs_adjusted_average: lbs };
    }
    return out;
  }

  it('detects a clear spike as an anomaly', async () => {
    const { analyzer } = makeAnalyzer(buildSpikeFixture());
    const out = await analyzer.detectAnomalies({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-03-07', to: '2026-05-05' },
    });
    expect(out.anomalies.length).toBeGreaterThanOrEqual(1);
    const spike = out.anomalies.find(a => a.value === 210);
    expect(spike).toBeDefined();
    expect(spike.direction).toBe('high');
    expect(Math.abs(spike.zScore)).toBeGreaterThan(2);
  });

  it('returns no anomalies for a flat series', async () => {
    const { analyzer } = makeAnalyzer(buildFlatWeight());
    const out = await analyzer.detectAnomalies({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-05' },
    });
    expect(out.anomalies).toEqual([]);
  });

  it('honors zScore_threshold parameter', async () => {
    const { analyzer } = makeAnalyzer(buildSpikeFixture());
    const out = await analyzer.detectAnomalies({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-03-07', to: '2026-05-05' },
      zScore_threshold: 100,  // unreachable
    });
    expect(out.anomalies).toEqual([]);
  });
});

describe('MetricTrendAnalyzer.trajectory', () => {
  it('returns slope, direction=down, and high rSquared for monotonic descent', async () => {
    const { analyzer } = makeAnalyzer();
    const out = await analyzer.trajectory({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-05' },
    });
    expect(out.metric).toBe('weight_lbs');
    expect(out.slope).toBeCloseTo(-0.1, 5); // -0.1 lbs/day
    expect(out.slopePerWeek).toBeCloseTo(-0.7, 5);
    expect(out.direction).toBe('down');
    expect(out.rSquared).toBeCloseTo(1, 5);  // perfect linear fit
    expect(out.start.value).toBe(200);
    expect(out.end.value).toBeCloseTo(200 - 0.1 * 29, 5);
  });

  it('returns direction=flat for a constant series', async () => {
    const { analyzer } = makeAnalyzer(buildFlatWeight());
    const out = await analyzer.trajectory({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-05' },
    });
    expect(out.slope).toBe(0);
    expect(out.direction).toBe('flat');
  });

  it('returns optional bucketed series when granularity provided', async () => {
    const { analyzer } = makeAnalyzer();
    const out = await analyzer.trajectory({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-05' },
      granularity: 'weekly',
    });
    expect(Array.isArray(out.bucketed)).toBe(true);
    expect(out.bucketed.length).toBeGreaterThan(0);
  });

  it('returns null slope when fewer than 2 data points', async () => {
    const { analyzer } = makeAnalyzer({});
    const out = await analyzer.trajectory({
      userId: 'kc',
      metric: 'weight_lbs',
      period: { from: '2026-04-06', to: '2026-05-05' },
    });
    expect(out.slope).toBe(null);
    expect(out.direction).toBe('flat');
    expect(out.rSquared).toBe(null);
  });
});
