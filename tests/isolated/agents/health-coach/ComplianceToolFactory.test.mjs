// Tests for ComplianceToolFactory (F-002).
//
// The factory exposes `get_compliance_summary({ userId, days })` which reads
// the per-day `coaching` field from the health datastore (written by F-001's
// SetDailyCoachingUseCase) and returns counts, percentages, current streak,
// and longest gap for each tracked compliance dimension.
//
// "today" is pinned with vi.useFakeTimers so streak/gap math is deterministic.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ComplianceToolFactory } from '../../../../backend/src/3_applications/agents/health-coach/tools/ComplianceToolFactory.mjs';

const TODAY = '2026-05-01';

// Build a UTC midnight Date for a YYYY-MM-DD string. Using UTC keeps streak/gap
// math invariant under the test runner's local timezone.
function utc(dateStr) {
  return new Date(dateStr + 'T00:00:00Z');
}

// Subtract `n` days from a YYYY-MM-DD string, returning YYYY-MM-DD (UTC).
function daysBefore(dateStr, n) {
  const d = utc(dateStr);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Build a date-keyed health-data fixture. `entries` is an object whose keys are
 * day-offsets relative to TODAY (0 = today, 1 = yesterday, ...) and whose
 * values are the per-day entry to drop in (typically `{ coaching: ... }`).
 *
 * Days not listed in `entries` are simply absent from the resulting object —
 * which is how an "untracked" day looks at the datastore level.
 */
function buildHealthData(entries) {
  const out = {};
  for (const [offset, entry] of Object.entries(entries)) {
    const date = daysBefore(TODAY, Number(offset));
    out[date] = entry;
  }
  return out;
}

/** Convenience: factory with a healthStore mock returning `data`. */
function makeFactory(data = {}) {
  const healthStore = {
    loadHealthData: vi.fn(async () => data),
  };
  return {
    factory: new ComplianceToolFactory({ healthStore }),
    healthStore,
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
    // Days has a default of 30
    expect(props.days.default).toBe(30);

    // userId is required; days is optional (falls back to default).
    expect(tool.parameters?.required).toEqual(expect.arrayContaining(['userId']));
    expect(tool.parameters?.required).not.toContain('days');
  });

  it('computes logged/missed/untracked counts for post_workout_protein over the window', async () => {
    // 30-day window. We populate:
    //   - 22 days where taken=true
    //   - 5 days where taken=false
    //   - 3 days with no entry at all (untracked)
    const entries = {};
    let i = 0;
    for (let k = 0; k < 22; k++) entries[i++] = { coaching: { post_workout_protein: { taken: true } } };
    for (let k = 0; k < 5; k++) entries[i++] = { coaching: { post_workout_protein: { taken: false } } };
    // i is now 27. Days 27, 28, 29 (offsets) are intentionally not added → untracked.

    const { factory } = makeFactory(buildHealthData(entries));
    const tool = getTool(factory);
    const result = await tool.execute({ userId: 'test-user', days: 30 });

    expect(result.windowDays).toBe(30);
    const dim = result.dimensions.post_workout_protein;
    expect(dim.logged).toBe(22);
    expect(dim.missed).toBe(5);
    expect(dim.untracked).toBe(3);
  });

  it('computes complianceRate = logged / (logged + missed) — excluding untracked from denominator', async () => {
    // 22 logged, 5 missed, 3 untracked over 30-day window.
    const entries = {};
    let i = 0;
    for (let k = 0; k < 22; k++) entries[i++] = { coaching: { post_workout_protein: { taken: true } } };
    for (let k = 0; k < 5; k++) entries[i++] = { coaching: { post_workout_protein: { taken: false } } };

    const { factory } = makeFactory(buildHealthData(entries));
    const tool = getTool(factory);
    const result = await tool.execute({ userId: 'test-user', days: 30 });

    const dim = result.dimensions.post_workout_protein;
    // 22 / (22 + 5) = 0.8148148...
    expect(dim.complianceRate).toBeCloseTo(22 / 27, 4);
  });

  it('currentStreak counts trailing days where taken=true (untracked breaks the streak)', async () => {
    // Lay out the most recent 10 days (offset 0 = today, 1 = yesterday, ...):
    //   offsets 0..6: taken=true   (current streak = 7)
    //   offset 7:     taken=false
    //   offset 8:     untracked   (no entry at all)
    //   offset 9:     taken=true
    const entries = {};
    for (let i = 0; i <= 6; i++) {
      entries[i] = { coaching: { post_workout_protein: { taken: true } } };
    }
    entries[7] = { coaching: { post_workout_protein: { taken: false } } };
    // offset 8 is intentionally absent → untracked.
    entries[9] = { coaching: { post_workout_protein: { taken: true } } };

    const { factory } = makeFactory(buildHealthData(entries));
    const tool = getTool(factory);
    const result = await tool.execute({ userId: 'test-user', days: 30 });

    expect(result.dimensions.post_workout_protein.currentStreak).toBe(7);
  });

  it('longestGap counts the longest run of consecutive missed days (only explicit misses)', async () => {
    // Spread misses across the 30-day window:
    //   - A 4-day run of explicit misses (offsets 10..13)
    //   - A 2-day run elsewhere (offsets 20..21)
    //   - Untracked days do NOT extend a gap.
    const entries = {};
    // Default: lots of taken=true days
    for (let i = 0; i < 30; i++) {
      entries[i] = { coaching: { post_workout_protein: { taken: true } } };
    }
    // Override with misses for the longer run
    for (let i = 10; i <= 13; i++) {
      entries[i] = { coaching: { post_workout_protein: { taken: false } } };
    }
    // And the shorter run
    entries[20] = { coaching: { post_workout_protein: { taken: false } } };
    entries[21] = { coaching: { post_workout_protein: { taken: false } } };

    const { factory } = makeFactory(buildHealthData(entries));
    const tool = getTool(factory);
    const result = await tool.execute({ userId: 'test-user', days: 30 });

    expect(result.dimensions.post_workout_protein.longestGap).toBe(4);
  });

  it('daily_strength_micro: avgReps is the mean across logged days; logged requires movement+reps', async () => {
    // 4 days: 3 valid (reps 5, 7, 9 → mean 7) and 1 with movement only (untracked).
    const entries = {
      0: { coaching: { daily_strength_micro: { movement: 'pull_up', reps: 5 } } },
      1: { coaching: { daily_strength_micro: { movement: 'push_up', reps: 7 } } },
      2: { coaching: { daily_strength_micro: { movement: 'squat', reps: 9 } } },
      // movement-only entry is invalid per DailyCoachingEntry — but the
      // datastore could still hold malformed coaching from older code paths,
      // so we ensure the tool treats missing reps as untracked (not logged).
      3: { coaching: { daily_strength_micro: { movement: 'lunge' } } },
    };

    const { factory } = makeFactory(buildHealthData(entries));
    const tool = getTool(factory);
    const result = await tool.execute({ userId: 'test-user', days: 30 });

    const dim = result.dimensions.daily_strength_micro;
    expect(dim.logged).toBe(3);
    expect(dim.untracked).toBe(27); // 30 - 3 logged
    expect(dim.avgReps).toBeCloseTo((5 + 7 + 9) / 3, 4);
  });

  it('daily_note: counts only days with non-empty note', async () => {
    const entries = {
      0: { coaching: { daily_note: 'felt strong' } },
      1: { coaching: { daily_note: 'tired' } },
      2: { coaching: { daily_note: '   ' } }, // whitespace-only → not counted
      3: { coaching: { daily_note: '' } },     // empty → not counted
      4: { coaching: { daily_note: 'great workout' } },
      // others: untracked
    };

    const { factory } = makeFactory(buildHealthData(entries));
    const tool = getTool(factory);
    const result = await tool.execute({ userId: 'test-user', days: 30 });

    const dim = result.dimensions.daily_note;
    expect(dim.logged).toBe(3); // offsets 0, 1, 4
    expect(dim.untracked).toBe(27);
    // complianceRate = logged / (logged + 0 missed); daily_note has no
    // explicit "missed" channel → rate equals logged / windowDays since
    // there's nothing to exclude from the denominator.
    expect(dim.complianceRate).toBeCloseTo(3 / 30, 4);
  });

  it('respects days parameter (window of 7 vs 30 vs 84)', async () => {
    // Lay out 90 consecutive logged days; then verify the count matches the
    // requested window size.
    const entries = {};
    for (let i = 0; i < 90; i++) {
      entries[i] = { coaching: { post_workout_protein: { taken: true } } };
    }
    const data = buildHealthData(entries);

    for (const days of [7, 30, 84]) {
      const { factory } = makeFactory(data);
      const tool = getTool(factory);
      const result = await tool.execute({ userId: 'test-user', days });
      expect(result.windowDays).toBe(days);
      expect(result.dimensions.post_workout_protein.logged).toBe(days);
      expect(result.dimensions.post_workout_protein.untracked).toBe(0);
    }
  });

  it('gracefully handles userId without any health data — returns zeros', async () => {
    const { factory } = makeFactory({}); // empty fixture
    const tool = getTool(factory);
    const result = await tool.execute({ userId: 'test-user', days: 30 });

    expect(result.windowDays).toBe(30);
    expect(result.dimensions.post_workout_protein.logged).toBe(0);
    expect(result.dimensions.post_workout_protein.missed).toBe(0);
    expect(result.dimensions.post_workout_protein.untracked).toBe(30);
    expect(result.dimensions.post_workout_protein.currentStreak).toBe(0);
    expect(result.dimensions.post_workout_protein.longestGap).toBe(0);
    // complianceRate is 0 when there are no logged-or-missed days at all.
    expect(result.dimensions.post_workout_protein.complianceRate).toBe(0);

    expect(result.dimensions.daily_strength_micro.logged).toBe(0);
    expect(result.dimensions.daily_strength_micro.untracked).toBe(30);
    expect(result.dimensions.daily_strength_micro.currentStreak).toBe(0);
    expect(result.dimensions.daily_strength_micro.longestGap).toBe(0);
    expect(result.dimensions.daily_strength_micro.avgReps).toBe(null);

    expect(result.dimensions.daily_note.logged).toBe(0);
    expect(result.dimensions.daily_note.untracked).toBe(30);
  });

  it('excludes future dates (only counts dates <= today)', async () => {
    // Populate today + 5 future days with coaching entries. The future entries
    // must NOT count toward `logged` because they fall outside the window
    // (which extends backward from today).
    const data = {};
    for (let n = 0; n <= 5; n++) {
      const futureDate = new Date(utc(TODAY));
      futureDate.setUTCDate(futureDate.getUTCDate() + n);
      const date = futureDate.toISOString().slice(0, 10);
      data[date] = { coaching: { post_workout_protein: { taken: true } } };
    }

    const { factory } = makeFactory(data);
    const tool = getTool(factory);
    const result = await tool.execute({ userId: 'test-user', days: 7 });

    // Only today (offset 0) is in the window. The other 5 future days are
    // outside the [today-6, today] window. So: 1 logged, 6 untracked.
    expect(result.windowDays).toBe(7);
    expect(result.dimensions.post_workout_protein.logged).toBe(1);
    expect(result.dimensions.post_workout_protein.untracked).toBe(6);
  });
});
