import { describe, it, expect } from 'vitest';
import { buildWeightSeries, fmtLbs, fmtDelta, VIEW_W, VIEW_H } from './weightSeries.js';

// The real /health/weight payload shape: keyed by date, entries carrying both
// the raw reading and the smoothed average the budget is computed from.
// `measurement` is set alongside `lbs` because these fixtures mean "a day that
// was actually weighed"; see the forward-fill tests below for the other case.
const entry = (date, lbs, avg) => [date, { date, lbs, measurement: lbs, lbs_adjusted_average: avg }];
const data = (...pairs) => Object.fromEntries(pairs);

const day = (n) => `2026-09-${String(n).padStart(2, '0')}`;

describe('buildWeightSeries', () => {
  it('windows to the last N readings, oldest first', () => {
    const iso = (i) => new Date(Date.UTC(2026, 6, 1 + i)).toISOString().slice(0, 10); // 2026-07-01 +i
    const wide = data(...Array.from({ length: 40 }, (_, i) => entry(iso(i), 170 + i, 170 + i)));
    const s = buildWeightSeries(wide, { days: 30 });
    expect(s.entries).toHaveLength(30);
    expect(s.entries[0].date < s.entries[29].date).toBe(true);
    expect(s.latest.date).toBe(s.entries[29].date);
  });

  it('reports the trend as ADJUSTED AVERAGE now vs 7 days ago, not raw vs raw', () => {
    // The raw readings swing 4 lb on the last day; the average moves 0.4.
    const s = buildWeightSeries(data(
      entry(day(1), 171.0, 171.0),
      entry(day(4), 168.0, 171.2),
      entry(day(8), 175.0, 171.4),
    ));
    expect(s.deltaLbs).toBe(0.4); // 171.4 (09-08) vs 171.0 (09-01)
    expect(s.trendFrom).toBe(day(1));
    expect(s.direction).toBe('up');
  });

  it('compares against the NEAREST reading at or before the 7-day mark, never an invented one', () => {
    // Nothing was logged exactly 7 days back (09-03); 09-02 is the comparison.
    const s = buildWeightSeries(data(
      entry(day(2), 172.0, 172.0),
      entry(day(9), 170.0, 170.5),
    ));
    expect(s.trendFrom).toBe(day(2));
    expect(s.deltaLbs).toBe(-1.5);
    expect(s.direction).toBe('down');
  });

  it('has NO delta when the history is too short to have one', () => {
    const s = buildWeightSeries(data(entry(day(9), 170, 170)));
    expect(s.deltaLbs).toBeNull();
    expect(s.direction).toBeNull();
    // A single reading is not a line either.
    expect(s.rawPoints).toBe('');
    expect(s.avgPoints).toBe('');
  });

  it('is empty, not broken, with no weight data at all', () => {
    for (const empty of [undefined, null, {}]) {
      const s = buildWeightSeries(empty);
      expect(s.latestLbs).toBeNull();
      expect(s.deltaLbs).toBeNull();
      expect(s.rawPoints).toBe('');
    }
  });

  it('draws BOTH series on one shared scale so they cross where they really cross', () => {
    const s = buildWeightSeries(data(
      entry(day(1), 168, 172),
      entry(day(2), 176, 172),
    ));
    const raw = s.rawPoints.split(' ').map((p) => Number(p.split(',')[1]));
    const avg = s.avgPoints.split(' ').map((p) => Number(p.split(',')[1]));
    // Raw spans the full height (168 is the min, 176 the max)...
    expect(raw[0]).toBe(VIEW_H);
    expect(raw[1]).toBe(0);
    // ...and the average sits at the midpoint of that SAME scale, not
    // re-normalized to its own flat range.
    expect(avg[0]).toBe(VIEW_H / 2);
    expect(avg[1]).toBe(VIEW_H / 2);
  });

  it('spreads x evenly across the box and does not divide by zero on a flat series', () => {
    const s = buildWeightSeries(data(entry(day(1), 170, 170), entry(day(2), 170, 170), entry(day(3), 170, 170)));
    const xs = s.avgPoints.split(' ').map((p) => Number(p.split(',')[0]));
    expect(xs).toEqual([0, VIEW_W / 2, VIEW_W]);
    const ys = s.avgPoints.split(' ').map((p) => Number(p.split(',')[1]));
    expect(ys.every(Number.isFinite)).toBe(true);
    expect(new Set(ys).size).toBe(1); // flat stays flat
  });

  it('skips a reading missing a value rather than plotting it as zero', () => {
    const s = buildWeightSeries({
      [day(1)]: { date: day(1), lbs: 170, measurement: 170, lbs_adjusted_average: 170 },
      [day(2)]: { date: day(2), lbs: 170, measurement: null, lbs_adjusted_average: 170.5 },
      [day(3)]: { date: day(3), lbs: 171, measurement: 171, lbs_adjusted_average: 171 },
    });
    expect(s.rawPoints.split(' ')).toHaveLength(2);  // the null is dropped...
    expect(s.avgPoints.split(' ')).toHaveLength(3);  // ...not zeroed
    // The surviving raw points keep their own x positions (0 and 100) — the
    // missing middle reading is absent, not slid into the gap at x=50.
    expect(s.rawPoints.split(' ').map((p) => Number(p.split(',')[0]))).toEqual([0, 100]);
  });

  it('plots ONLY real weigh-ins as raw points — a forward-filled lbs is not a reading', () => {
    // Weighed on the 1st and the 3rd. The 2nd carries the 1st's `lbs` forward,
    // which is the shape of every unweighed day in the real file.
    const s = buildWeightSeries({
      [day(1)]: { date: day(1), lbs: 170, measurement: 170, lbs_adjusted_average: 170 },
      [day(2)]: { date: day(2), lbs: 170, lbs_adjusted_average: 170.2 },
      [day(3)]: { date: day(3), lbs: 174, measurement: 174, lbs_adjusted_average: 170.4 },
    });
    // Two dots, not three: the middle day was never measured.
    expect(s.rawPoints.split(' ')).toHaveLength(2);
    expect(s.rawPoints.split(' ').map((p) => Number(p.split(',')[0]))).toEqual([0, VIEW_W]);
    // The average is still defined every day.
    expect(s.avgPoints.split(' ')).toHaveLength(3);
  });

  it('scales to the real readings, so a forward-filled run cannot stretch the axis', () => {
    const s = buildWeightSeries({
      [day(1)]: { date: day(1), lbs: 170, measurement: 170, lbs_adjusted_average: 171 },
      [day(2)]: { date: day(2), lbs: 999, lbs_adjusted_average: 171 },
      [day(3)]: { date: day(3), lbs: 172, measurement: 172, lbs_adjusted_average: 171 },
    });
    const ys = s.rawPoints.split(' ').map((p) => Number(p.split(',')[1]));
    expect(ys[0]).toBe(VIEW_H); // 170 is the floor
    expect(ys[1]).toBe(0);      // 172 is the ceiling — the stray 999 lbs is not in the scale
  });

  it('keeps per-day water weight and composition on the entry', () => {
    const s = buildWeightSeries({
      [day(1)]: { date: day(1), lbs: 170, measurement: 170, lbs_adjusted_average: 171,
        water_weight: 3.5, fat_percent_adjusted_average: 21.4, calorie_balance: -320 },
      [day(2)]: { date: day(2), lbs: 170, lbs_adjusted_average: 171, water_weight: 4.1 },
    });
    expect(s.entries[0].waterWeight).toBe(3.5);
    expect(s.entries[1].waterWeight).toBe(4.1); // not the first day's, not the last day's
    expect(s.entries[0].fatPct).toBe(21.4);
    expect(s.entries[0].calorieBalance).toBe(-320);
  });

  it('leaves water weight null rather than defaulting it to zero', () => {
    // A zero fallback would drop the derived line ~4 lb and read as sudden loss.
    const s = buildWeightSeries({
      [day(1)]: { date: day(1), lbs: 170, measurement: 170, lbs_adjusted_average: 171 },
      [day(2)]: { date: day(2), lbs: 170, measurement: 170, lbs_adjusted_average: 171, water_weight: 4 },
    });
    expect(s.entries[0].waterWeight).toBeNull();
    expect(s.entries[1].waterWeight).toBe(4);
  });

  it('skips a row whose date is not a real calendar date instead of throwing', () => {
    const s = buildWeightSeries({
      '2026-08-32': { date: '2026-08-32', lbs: 999, measurement: 999, lbs_adjusted_average: 999 },
      [day(1)]: { date: day(1), lbs: 170, measurement: 170, lbs_adjusted_average: 170 },
      [day(9)]: { date: day(9), lbs: 171, measurement: 171, lbs_adjusted_average: 171 },
    });
    expect(s.entries).toHaveLength(2);
    expect(s.deltaLbs).toBe(1);
  });
});

describe('formatters', () => {
  it('fmtLbs keeps one decimal and dashes the unknown', () => {
    expect(fmtLbs(171.64)).toBe('171.6');
    expect(fmtLbs(171)).toBe('171.0');
    expect(fmtLbs(null)).toBe('—');
  });

  it('fmtDelta always carries an explicit sign, and null stays null', () => {
    expect(fmtDelta(0.4)).toBe('+0.4');
    expect(fmtDelta(-1.5)).toBe('−1.5');
    expect(fmtDelta(0)).toBe('±0.0');
    expect(fmtDelta(null)).toBeNull();
  });
});
