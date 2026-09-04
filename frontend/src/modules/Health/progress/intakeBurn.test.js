import { describe, it, expect } from 'vitest';
import { buildIntakeBurn } from './intakeBurn.js';

const day = (date, food, exercise) => ({ date, budget: 2000, food, exercise, status: 'under' });
const gap = (date) => ({ date, error: 'NO_WEIGHT_DATA' });
const iso = (i) => new Date(Date.UTC(2026, 7, 6 + i)).toISOString().slice(0, 10);

describe('buildIntakeBurn', () => {
  // THE rule: one kcal is the same number of pixels above the line as below it.
  it('splits the box between the two halves in proportion to their maxima — one shared scale', () => {
    const m = buildIntakeBurn([day(iso(0), 2000, 500), day(iso(1), 1000, 250)]);
    // max food 2000, max burn 500 -> 80/20 split.
    expect(m.foodAreaPct).toBe(80);
    expect(m.exerciseAreaPct).toBe(20);
    // A 1000 kcal day fills half of the 80% half; a 250 kcal burn fills half of
    // the 20% half. Same kcal-per-pixel: 1000/2000*80 === 250/500*20 * 4.
    expect(m.bars[1].foodPct).toBe(50);
    expect(m.bars[1].exercisePct).toBe(50);
    const px = (b) => [b.foodPct * m.foodAreaPct / 100, b.exercisePct * m.exerciseAreaPct / 100];
    const [fPx, ePx] = px(m.bars[1]);
    expect(fPx / 1000).toBeCloseTo(ePx / 250, 6); // identical kcal-per-pixel
  });

  it('does not let a quiet exercise month inflate the burn bars', () => {
    const m = buildIntakeBurn([day(iso(0), 2000, 100), day(iso(1), 2000, 50)]);
    // Burn tops out at 100 against a 2000 food max: the burn half is thin, and
    // that is the truth about the month.
    expect(m.exerciseAreaPct).toBeCloseTo(4.8, 1);
    expect(m.foodAreaPct).toBeCloseTo(95.2, 1);
  });

  it('marks a server gap as a gap and gives it no bars', () => {
    const m = buildIntakeBurn([day(iso(0), 2000, 300), gap(iso(1))]);
    expect(m.bars[1].kind).toBe('gap');
    expect(m.bars[1].foodPct).toBe(0);
    expect(m.bars[1].exercisePct).toBe(0);
    // A gap carries no numbers at all, so it cannot move the scale either.
    expect(m.scaleMaxKcal).toBe(2300);
  });

  it('a genuine zero day is a DAY with zero-height bars, not a gap', () => {
    const m = buildIntakeBurn([day(iso(0), 2000, 300), day(iso(1), 0, 0)]);
    expect(m.bars[1].kind).toBe('day');
    expect(m.bars[1].foodPct).toBe(0);
  });

  // M4. A gap entry can arrive without a `date`; two of them sharing `undefined`
  // collapse into one React key, and the chart draws ONE gap column where there
  // were several.
  it('gives every slot a distinct identity, even gaps with no date', () => {
    const m = buildIntakeBurn([{ error: 'NO_WEIGHT_DATA' }, { error: 'NO_WEIGHT_DATA' }, day(iso(2), 2000, 300)]);
    const keys = m.bars.map((b) => b.date);
    expect(new Set(keys).size).toBe(3);
    expect(keys.every(Boolean)).toBe(true);
  });

  it('never divides by zero on an empty or all-zero range', () => {
    for (const input of [[], null, undefined, [day(iso(0), 0, 0)]]) {
      const m = buildIntakeBurn(input);
      expect(m.foodAreaPct + m.exerciseAreaPct).toBe(100);
      expect(m.bars.every((b) => Number.isFinite(b.foodPct) && Number.isFinite(b.exercisePct))).toBe(true);
    }
  });

  it('treats a negative or non-numeric total as zero rather than an inverted bar', () => {
    const m = buildIntakeBurn([day(iso(0), 2000, 300), day(iso(1), -500, 'x')]);
    expect(m.bars[1].foodPct).toBe(0);
    expect(m.bars[1].exercisePct).toBe(0);
  });
});
