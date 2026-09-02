import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/api.mjs', () => ({ DaylightAPI: vi.fn().mockResolvedValue({}) }));
const { FitnessTimeline } = await import('./FitnessTimeline.js');

/**
 * Regression: the history cap dropped the OLDEST ticks with no record. Session
 * 20260725132556 ran 195 minutes and kept a 2000-tick series while tick_count
 * reported 2346 — 29 minutes gone, and nothing in the file said so, which made
 * a windowed series indistinguishable from a whole one.
 */
describe('FitnessTimeline history cap', () => {
  const build = () => new FitnessTimeline(1_700_000_000_000, 5000);

  it('holds a session far longer than any workout without pruning', () => {
    const t = build();
    // 3 hours — past the old 2h47m cap, which silently truncated here.
    for (let i = 0; i < 2160; i++) t.tick({ 'a:hr': 100 + (i % 30) });
    expect(t.series['a:hr']).toHaveLength(2160);
    expect(t.timebase.prunedTickCount).toBe(0);
  });

  it('records the loss when the cap is finally crossed', () => {
    const t = build();
    t.series['a:hr'] = new Array(8700).fill(1);
    t.timebase.tickCount = 8700;
    const removed = t._pruneSeriesWindow();
    expect(removed).toBeGreaterThan(0);
    expect(t.series['a:hr']).toHaveLength(8640);
    // The count is what lets a reader realign index 0 to its true tick.
    expect(t.timebase.prunedTickCount).toBe(removed);
  });

  it('prunes from the FRONT, keeping the most recent ticks', () => {
    const t = build();
    t.series['a:hr'] = Array.from({ length: 8700 }, (_, i) => i);
    t.timebase.tickCount = 8700;
    t._pruneSeriesWindow();
    // The last value must still be the newest sample, not an older one.
    expect(t.series['a:hr'].at(-1)).toBe(8699);
  });

  it('leaves a short session untouched', () => {
    const t = build();
    for (let i = 0; i < 50; i++) t.tick({ 'a:hr': 120 });
    expect(t._pruneSeriesWindow()).toBe(0);
    expect(t.timebase.prunedTickCount).toBe(0);
  });
});
