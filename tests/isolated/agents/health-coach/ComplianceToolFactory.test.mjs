// Tests for ComplianceToolFactory (F-002 / F2-B).
//
// The factory exposes `get_compliance_summary({ userId, days })` which reads
// the per-day `coaching` field from the health datastore and the
// `coaching_dimensions` schema from the user's playbook (via
// personalContextLoader). Dimensions are NOT hardcoded — the test schema
// uses synthetic dimension keys to verify genericity.
//
// "today" is pinned with vi.useFakeTimers so streak/gap math is deterministic.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ComplianceToolFactory } from '../../../../backend/src/3_applications/agents/health-coach/tools/ComplianceToolFactory.mjs';

const TODAY = '2026-05-01';

function utc(dateStr) {
  return new Date(dateStr + 'T00:00:00Z');
}

function daysBefore(dateStr, n) {
  const d = utc(dateStr);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function buildHealthData(entries) {
  const out = {};
  for (const [offset, entry] of Object.entries(entries)) {
    const date = daysBefore(TODAY, Number(offset));
    out[date] = entry;
  }
  return out;
}

// Synthetic dimensions — explicitly NOT the legacy KC names.
const BOOLEAN_DIM_KEY = 'morning_meditation';
const NUMERIC_DIM_KEY = 'mobility_drill';
const TEXT_DIM_KEY = 'reflection';

const STANDARD_SCHEMA = [
  {
    key: BOOLEAN_DIM_KEY,
    type: 'boolean',
    fields: {
      taken: { type: 'boolean', required: true },
      timestamp: { type: 'string', required: false },
    },
  },
  {
    key: NUMERIC_DIM_KEY,
    type: 'numeric',
    fields: {
      movement: { type: 'string', required: true },
      reps: { type: 'integer', required: true, min: 0 },
    },
    average_field: 'reps',
  },
  {
    key: TEXT_DIM_KEY,
    type: 'text',
    fields: {
      value: { type: 'string', required: true, max_length: 200 },
    },
  },
];

function makeFactory({ data = {}, schema = STANDARD_SCHEMA } = {}) {
  const healthStore = {
    loadHealthData: vi.fn(async () => data),
  };
  const personalContextLoader = {
    loadPlaybook: vi.fn(async () => (
      schema === null ? null : { coaching_dimensions: schema }
    )),
  };
  return {
    factory: new ComplianceToolFactory({
      healthStore,
      personalContextLoader,
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    }),
    healthStore,
    personalContextLoader,
  };
}

function getTool(factory) {
  return factory.createTools().find(t => t.name === 'get_compliance_summary');
}

describe('ComplianceToolFactory', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(utc(TODAY));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('tool definition has correct schema (name, description, params)', () => {
    const { factory } = makeFactory();
    const tool = getTool(factory);

    expect(tool).toBeTruthy();
    expect(tool.name).toBe('get_compliance_summary');
    expect(typeof tool.description).toBe('string');
    expect(tool.description.length).toBeGreaterThan(0);
    expect(tool.parameters?.type).toBe('object');

    const props = tool.parameters?.properties || {};
    expect(props.userId).toBeTruthy();
    expect(props.userId.type).toBe('string');
    expect(props.days).toBeTruthy();
    expect(props.days.type).toBe('number');
    expect(props.days.default).toBe(30);

    expect(tool.parameters?.required).toEqual(expect.arrayContaining(['userId']));
    expect(tool.parameters?.required).not.toContain('days');
  });

  it('boolean dim: counts logged/missed/untracked over the window', async () => {
    // 30-day window. We populate:
    //   - 22 days where taken=true
    //   - 5 days where taken=false
    //   - 3 days with no entry at all (untracked)
    const entries = {};
    let i = 0;
    for (let k = 0; k < 22; k++) entries[i++] = { coaching: { [BOOLEAN_DIM_KEY]: { taken: true } } };
    for (let k = 0; k < 5; k++) entries[i++] = { coaching: { [BOOLEAN_DIM_KEY]: { taken: false } } };

    const { factory } = makeFactory({ data: buildHealthData(entries) });
    const tool = getTool(factory);
    const result = await tool.execute({ userId: 'test-user', days: 30 });

    expect(result.windowDays).toBe(30);
    const dim = result.dimensions[BOOLEAN_DIM_KEY];
    expect(dim.logged).toBe(22);
    expect(dim.missed).toBe(5);
    expect(dim.untracked).toBe(3);
  });

  it('boolean dim: complianceRate = logged / (logged + missed) — excluding untracked', async () => {
    const entries = {};
    let i = 0;
    for (let k = 0; k < 22; k++) entries[i++] = { coaching: { [BOOLEAN_DIM_KEY]: { taken: true } } };
    for (let k = 0; k < 5; k++) entries[i++] = { coaching: { [BOOLEAN_DIM_KEY]: { taken: false } } };

    const { factory } = makeFactory({ data: buildHealthData(entries) });
    const tool = getTool(factory);
    const result = await tool.execute({ userId: 'test-user', days: 30 });
    expect(result.dimensions[BOOLEAN_DIM_KEY].complianceRate).toBeCloseTo(22 / 27, 4);
  });

  it('boolean dim: currentStreak counts trailing taken=true (untracked breaks)', async () => {
    const entries = {};
    for (let i = 0; i <= 6; i++) {
      entries[i] = { coaching: { [BOOLEAN_DIM_KEY]: { taken: true } } };
    }
    entries[7] = { coaching: { [BOOLEAN_DIM_KEY]: { taken: false } } };
    // offset 8 absent → untracked.
    entries[9] = { coaching: { [BOOLEAN_DIM_KEY]: { taken: true } } };

    const { factory } = makeFactory({ data: buildHealthData(entries) });
    const tool = getTool(factory);
    const result = await tool.execute({ userId: 'test-user', days: 30 });
    expect(result.dimensions[BOOLEAN_DIM_KEY].currentStreak).toBe(7);
  });

  it('boolean dim: longestGap counts the longest run of consecutive missed days', async () => {
    const entries = {};
    for (let i = 0; i < 30; i++) {
      entries[i] = { coaching: { [BOOLEAN_DIM_KEY]: { taken: true } } };
    }
    for (let i = 10; i <= 13; i++) {
      entries[i] = { coaching: { [BOOLEAN_DIM_KEY]: { taken: false } } };
    }
    entries[20] = { coaching: { [BOOLEAN_DIM_KEY]: { taken: false } } };
    entries[21] = { coaching: { [BOOLEAN_DIM_KEY]: { taken: false } } };

    const { factory } = makeFactory({ data: buildHealthData(entries) });
    const tool = getTool(factory);
    const result = await tool.execute({ userId: 'test-user', days: 30 });
    expect(result.dimensions[BOOLEAN_DIM_KEY].longestGap).toBe(4);
  });

  it('numeric dim: avgValue/avgReps is the mean of average_field across logged days', async () => {
    const entries = {
      0: { coaching: { [NUMERIC_DIM_KEY]: { movement: 'pull_up', reps: 5 } } },
      1: { coaching: { [NUMERIC_DIM_KEY]: { movement: 'push_up', reps: 7 } } },
      2: { coaching: { [NUMERIC_DIM_KEY]: { movement: 'squat', reps: 9 } } },
      // movement-only entry → untracked (reps required).
      3: { coaching: { [NUMERIC_DIM_KEY]: { movement: 'lunge' } } },
    };

    const { factory } = makeFactory({ data: buildHealthData(entries) });
    const tool = getTool(factory);
    const result = await tool.execute({ userId: 'test-user', days: 30 });

    const dim = result.dimensions[NUMERIC_DIM_KEY];
    expect(dim.logged).toBe(3);
    expect(dim.untracked).toBe(27);
    expect(dim.avgValue).toBeCloseTo((5 + 7 + 9) / 3, 4);
    // avgReps alias preserved when average_field === 'reps'.
    expect(dim.avgReps).toBeCloseTo((5 + 7 + 9) / 3, 4);
    // averages exposes per-field means.
    expect(dim.averages.reps).toBeCloseTo((5 + 7 + 9) / 3, 4);
  });

  it('text dim: counts only days with non-empty value', async () => {
    const entries = {
      0: { coaching: { [TEXT_DIM_KEY]: 'felt strong' } },
      1: { coaching: { [TEXT_DIM_KEY]: 'tired' } },
      2: { coaching: { [TEXT_DIM_KEY]: '   ' } }, // whitespace-only → untracked
      3: { coaching: { [TEXT_DIM_KEY]: '' } },
      4: { coaching: { [TEXT_DIM_KEY]: 'great workout' } },
    };

    const { factory } = makeFactory({ data: buildHealthData(entries) });
    const tool = getTool(factory);
    const result = await tool.execute({ userId: 'test-user', days: 30 });

    const dim = result.dimensions[TEXT_DIM_KEY];
    expect(dim.logged).toBe(3);
    expect(dim.untracked).toBe(27);
    expect(dim.complianceRate).toBeCloseTo(3 / 30, 4);
  });

  it('respects days parameter (window of 7 vs 30 vs 84)', async () => {
    const entries = {};
    for (let i = 0; i < 90; i++) {
      entries[i] = { coaching: { [BOOLEAN_DIM_KEY]: { taken: true } } };
    }
    const data = buildHealthData(entries);

    for (const days of [7, 30, 84]) {
      const { factory } = makeFactory({ data });
      const tool = getTool(factory);
      const result = await tool.execute({ userId: 'test-user', days });
      expect(result.windowDays).toBe(days);
      expect(result.dimensions[BOOLEAN_DIM_KEY].logged).toBe(days);
      expect(result.dimensions[BOOLEAN_DIM_KEY].untracked).toBe(0);
    }
  });

  it('gracefully handles userId without any health data — returns zero counts', async () => {
    const { factory } = makeFactory({ data: {} });
    const tool = getTool(factory);
    const result = await tool.execute({ userId: 'test-user', days: 30 });

    expect(result.windowDays).toBe(30);
    expect(result.dimensions[BOOLEAN_DIM_KEY].logged).toBe(0);
    expect(result.dimensions[BOOLEAN_DIM_KEY].missed).toBe(0);
    expect(result.dimensions[BOOLEAN_DIM_KEY].untracked).toBe(30);
    expect(result.dimensions[BOOLEAN_DIM_KEY].currentStreak).toBe(0);
    expect(result.dimensions[BOOLEAN_DIM_KEY].longestGap).toBe(0);
    expect(result.dimensions[BOOLEAN_DIM_KEY].complianceRate).toBe(0);

    expect(result.dimensions[NUMERIC_DIM_KEY].logged).toBe(0);
    expect(result.dimensions[NUMERIC_DIM_KEY].untracked).toBe(30);
    expect(result.dimensions[NUMERIC_DIM_KEY].avgValue).toBe(null);

    expect(result.dimensions[TEXT_DIM_KEY].logged).toBe(0);
    expect(result.dimensions[TEXT_DIM_KEY].untracked).toBe(30);
  });

  it('boolean dim: currentMissStreak counts trailing taken=false days', async () => {
    const entries = {
      0: { coaching: { [BOOLEAN_DIM_KEY]: { taken: false } } },
      1: { coaching: { [BOOLEAN_DIM_KEY]: { taken: false } } },
      2: { coaching: { [BOOLEAN_DIM_KEY]: { taken: false } } },
      3: { coaching: { [BOOLEAN_DIM_KEY]: { taken: true } } },
      4: { coaching: { [BOOLEAN_DIM_KEY]: { taken: false } } },
    };
    const { factory } = makeFactory({ data: buildHealthData(entries) });
    const tool = getTool(factory);
    const result = await tool.execute({ userId: 'test-user', days: 30 });

    expect(result.dimensions[BOOLEAN_DIM_KEY].currentMissStreak).toBe(3);
    expect(result.dimensions[BOOLEAN_DIM_KEY].currentUntrackedStreak).toBe(0);
  });

  it('boolean dim: currentMissStreak is broken by an untracked day', async () => {
    const entries = {
      // offset 0 absent (untracked)
      1: { coaching: { [BOOLEAN_DIM_KEY]: { taken: false } } },
      2: { coaching: { [BOOLEAN_DIM_KEY]: { taken: false } } },
      3: { coaching: { [BOOLEAN_DIM_KEY]: { taken: false } } },
    };
    const { factory } = makeFactory({ data: buildHealthData(entries) });
    const tool = getTool(factory);
    const result = await tool.execute({ userId: 'test-user', days: 30 });
    expect(result.dimensions[BOOLEAN_DIM_KEY].currentMissStreak).toBe(0);
    expect(result.dimensions[BOOLEAN_DIM_KEY].currentUntrackedStreak).toBe(1);
  });

  it('numeric dim: currentUntrackedStreak counts trailing untracked days', async () => {
    const entries = {
      5: { coaching: { [NUMERIC_DIM_KEY]: { movement: 'pull_up', reps: 5 } } },
    };
    const { factory } = makeFactory({ data: buildHealthData(entries) });
    const tool = getTool(factory);
    const result = await tool.execute({ userId: 'test-user', days: 30 });
    expect(result.dimensions[NUMERIC_DIM_KEY].currentUntrackedStreak).toBe(5);
    expect(result.dimensions[NUMERIC_DIM_KEY].currentStreak).toBe(0);
  });

  it('excludes future dates (only counts dates <= today)', async () => {
    const data = {};
    for (let n = 0; n <= 5; n++) {
      const futureDate = new Date(utc(TODAY));
      futureDate.setUTCDate(futureDate.getUTCDate() + n);
      const date = futureDate.toISOString().slice(0, 10);
      data[date] = { coaching: { [BOOLEAN_DIM_KEY]: { taken: true } } };
    }

    const { factory } = makeFactory({ data });
    const tool = getTool(factory);
    const result = await tool.execute({ userId: 'test-user', days: 7 });
    expect(result.windowDays).toBe(7);
    expect(result.dimensions[BOOLEAN_DIM_KEY].logged).toBe(1);
    expect(result.dimensions[BOOLEAN_DIM_KEY].untracked).toBe(6);
  });

  // ---------- mixed-type playbook ----------

  it('mixed-type playbook: every declared dimension appears in result keyed by its declared key', async () => {
    const entries = {
      0: {
        coaching: {
          [BOOLEAN_DIM_KEY]: { taken: true },
          [NUMERIC_DIM_KEY]: { movement: 'a', reps: 4 },
          [TEXT_DIM_KEY]: 'feeling solid',
        },
      },
    };
    const { factory } = makeFactory({ data: buildHealthData(entries) });
    const tool = getTool(factory);
    const result = await tool.execute({ userId: 'test-user', days: 7 });

    // All three declared dims present, with no extras.
    expect(Object.keys(result.dimensions).sort()).toEqual(
      [BOOLEAN_DIM_KEY, NUMERIC_DIM_KEY, TEXT_DIM_KEY].sort()
    );
  });

  it('arbitrary dimension keys (custom playbook) — no hardcoded dimension assumed', async () => {
    const customSchema = [
      {
        key: 'cold_exposure',
        type: 'numeric',
        fields: { duration_min: { type: 'integer', required: true, min: 0 } },
        average_field: 'duration_min',
      },
      {
        key: 'water_oz',
        type: 'numeric',
        fields: { ounces: { type: 'integer', required: true, min: 0 } },
        average_field: 'ounces',
      },
    ];
    const entries = {
      0: { coaching: { cold_exposure: { duration_min: 3 }, water_oz: { ounces: 80 } } },
      1: { coaching: { water_oz: { ounces: 100 } } },
    };
    const { factory } = makeFactory({ data: buildHealthData(entries), schema: customSchema });
    const tool = getTool(factory);
    const result = await tool.execute({ userId: 'test-user', days: 7 });

    expect(Object.keys(result.dimensions).sort()).toEqual(['cold_exposure', 'water_oz']);
    expect(result.dimensions.cold_exposure.logged).toBe(1);
    expect(result.dimensions.cold_exposure.avgValue).toBe(3);
    expect(result.dimensions.water_oz.logged).toBe(2);
    expect(result.dimensions.water_oz.avgValue).toBe(90);
  });

  // ---------- empty playbook ----------

  it('empty playbook: returns { windowDays, dimensions: {} } with no error', async () => {
    const { factory } = makeFactory({ schema: null });
    const tool = getTool(factory);
    const result = await tool.execute({ userId: 'test-user', days: 7 });
    expect(result.windowDays).toBe(7);
    expect(result.dimensions).toEqual({});
    expect(result.error).toBeUndefined();
  });

  it('returns error when userId is missing', async () => {
    const { factory } = makeFactory();
    const tool = getTool(factory);
    const result = await tool.execute({ days: 7 });
    expect(result.error).toMatch(/userId/);
    expect(result.dimensions).toEqual({});
  });
});
