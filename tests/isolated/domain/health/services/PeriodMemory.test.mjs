// tests/isolated/domain/health/services/PeriodMemory.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { PeriodMemory } from '../../../../../backend/src/2_domains/health/services/PeriodMemory.mjs';

// Fake WorkingMemoryState with KV semantics
function makeState(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get: (k) => map.get(k),
    set: (k, v, opts = {}) => { map.set(k, v); return opts; },
    remove: (k) => { map.delete(k); },
    getAll: () => Object.fromEntries(map),
  };
}

function makeAdapter(initialState = {}) {
  let state = makeState(initialState);
  return {
    load: vi.fn(async () => state),
    save: vi.fn(async (_a, _u, s) => { state = s; }),
    __getState: () => state,
  };
}

function makePlaybookLoader(playbook) {
  return { loadPlaybook: vi.fn(async () => playbook) };
}

function makeAggregator() {
  return {
    aggregateSeries: vi.fn(async ({ metric, period }) => ({
      metric, period: { from: period.from || '2024-01-01', to: period.to || '2024-12-31', label: 'fake', source: 'explicit' },
      buckets: [],
    })),
  };
}

describe('PeriodMemory.listPeriods', () => {
  it('returns declared + remembered + deduced merged with sources', async () => {
    const adapter = makeAdapter({
      'period.remembered.stable-195': { from: '2024-08-01', to: '2024-11-15', label: 'Stable 195' },
      'period.deduced.weight-low':    { from: '2024-03-01', to: '2024-04-30', label: 'Weight low' },
    });
    const playbookLoader = makePlaybookLoader({
      named_periods: {
        '2017-cut': { from: '2017-01-15', to: '2017-04-30', description: 'Initial cut' },
      },
    });
    const memory = new PeriodMemory({ workingMemoryAdapter: adapter, playbookLoader });

    const out = await memory.listPeriods({ userId: 'kc' });
    expect(out.periods).toHaveLength(3);

    const slugs = out.periods.map(p => p.slug).sort();
    expect(slugs).toEqual(['2017-cut', 'stable-195', 'weight-low']);

    const sources = Object.fromEntries(out.periods.map(p => [p.slug, p.source]));
    expect(sources['2017-cut']).toBe('declared');
    expect(sources['stable-195']).toBe('remembered');
    expect(sources['weight-low']).toBe('deduced');
  });

  it('returns empty list when no sources have any periods', async () => {
    const adapter = makeAdapter({});
    const playbookLoader = makePlaybookLoader({});
    const memory = new PeriodMemory({ workingMemoryAdapter: adapter, playbookLoader });
    const out = await memory.listPeriods({ userId: 'kc' });
    expect(out.periods).toEqual([]);
  });
});

describe('PeriodMemory.rememberPeriod / forgetPeriod', () => {
  it('remembers a period under period.remembered.<slug>', async () => {
    const adapter = makeAdapter();
    const memory = new PeriodMemory({ workingMemoryAdapter: adapter });
    const out = await memory.rememberPeriod({
      userId: 'kc', slug: 'stable-195',
      from: '2024-08-01', to: '2024-11-15',
      label: 'Stable 195',
      description: 'Maintenance window',
    });
    expect(out.slug).toBe('stable-195');
    const stored = adapter.__getState().get('period.remembered.stable-195');
    expect(stored).toMatchObject({ from: '2024-08-01', to: '2024-11-15', label: 'Stable 195' });
    expect(adapter.save).toHaveBeenCalled();
  });

  it('forgets a remembered period', async () => {
    const adapter = makeAdapter({
      'period.remembered.stable-195': { from: '2024-08-01', to: '2024-11-15', label: 'Stable 195' },
    });
    const memory = new PeriodMemory({ workingMemoryAdapter: adapter });
    await memory.forgetPeriod({ userId: 'kc', slug: 'stable-195' });
    expect(adapter.__getState().get('period.remembered.stable-195')).toBeUndefined();
  });

  it('throws on invalid slug', async () => {
    const adapter = makeAdapter();
    const memory = new PeriodMemory({ workingMemoryAdapter: adapter });
    await expect(memory.rememberPeriod({
      userId: 'kc', slug: 'NOT VALID', from: '2024-01-01', to: '2024-12-31', label: 'x',
    })).rejects.toThrow(/invalid slug/i);
  });
});

describe('PeriodMemory.deducePeriod', () => {
  // Fixture: 60 days. Days 10-40 have weight in [193,197], else outside.
  function buildBandedFixture() {
    const out = {};
    const start = new Date(Date.UTC(2024, 0, 1));
    for (let i = 0; i < 60; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      let lbs;
      if (i < 10) lbs = 200;
      else if (i < 41) lbs = 195;
      else lbs = 200;
      out[key] = { lbs, lbs_adjusted_average: lbs };
    }
    return out;
  }

  it('finds candidates matching value_range over all_time', async () => {
    const adapter = makeAdapter();
    const trendAnalyzer = {
      detectSustained: vi.fn(async (args) => ({
        runs: [
          { from: '2024-01-11', to: '2024-02-10', durationDays: 31, summary: { mean: 195, min: 195, max: 195 } },
        ],
      })),
    };
    const memory = new PeriodMemory({ workingMemoryAdapter: adapter, trendAnalyzer });

    const out = await memory.deducePeriod({
      userId: 'kc',
      criteria: { metric: 'weight_lbs', value_range: [193, 197], min_duration_days: 21 },
      max_results: 3,
    });
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0].from).toBe('2024-01-11');
    expect(out.candidates[0].durationDays).toBe(31);
    expect(out.candidates[0].score).toBeGreaterThan(0);
    // Caches under period.deduced.<auto-slug>
    const all = adapter.__getState().getAll();
    const deducedKeys = Object.keys(all).filter(k => k.startsWith('period.deduced.'));
    expect(deducedKeys.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty candidates when criteria match nothing', async () => {
    const adapter = makeAdapter();
    const trendAnalyzer = {
      detectSustained: vi.fn(async () => ({ runs: [] })),
    };
    const memory = new PeriodMemory({ workingMemoryAdapter: adapter, trendAnalyzer });
    const out = await memory.deducePeriod({
      userId: 'kc',
      criteria: { metric: 'weight_lbs', value_range: [50, 60], min_duration_days: 30 },
    });
    expect(out.candidates).toEqual([]);
  });
});
