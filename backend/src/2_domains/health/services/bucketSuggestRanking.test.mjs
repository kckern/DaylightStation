import { describe, it, expect } from 'vitest';
import {
  rankSuggestions,
  bucketScore,
  globalScore,
  recencyDecay,
  BUCKET_HISTORY_MIN_ENTRIES,
  RECENCY_HALF_LIFE_DAYS,
  FREQUENCY_WINDOW_DAYS,
} from './bucketSuggestRanking.mjs';

// Fixed clock. Nothing in this module may read the wall clock
// (`domains-no-ambient-clock`), so every case below pins the instant and the
// expected numbers are arithmetic, not "whatever it produced".
const NOW = Date.parse('2026-09-04T12:00:00Z');
const DAY = 86400000;
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString().slice(0, 10);

const entry = (over = {}) => ({
  id: over.id,
  normalizedName: over.normalizedName ?? over.id,
  useCount: over.useCount ?? 1,
  favorite: over.favorite === true,
  lastUsed: over.lastUsed ?? daysAgo(0),
  usageByBucket: over.usageByBucket ?? {},
});
const used = (count, lastUsed) => ({ count, lastUsed });

describe('recencyDecay — half-life is 14 days, exactly', () => {
  // LITERAL 14 and 28, never `RECENCY_HALF_LIFE_DAYS` — an assertion written in
  // terms of the constant moves WITH the constant and can never fail when it
  // changes, which is the inert-test shape this program has caught four times.
  it('is 1 today, 1/2 at 14 days, 1/4 at 28', () => {
    expect(RECENCY_HALF_LIFE_DAYS).toBe(14);
    expect(recencyDecay(daysAgo(0), NOW)).toBeCloseTo(1, 10);
    expect(recencyDecay(daysAgo(14), NOW)).toBeCloseTo(0.5, 10);
    expect(recencyDecay(daysAgo(28), NOW)).toBeCloseTo(0.25, 10);
  });

  it('is 0 — not NaN, not 1 — for a missing or unparseable date', () => {
    expect(recencyDecay(undefined, NOW)).toBe(0);
    expect(recencyDecay('', NOW)).toBe(0);
    expect(recencyDecay('not-a-date', NOW)).toBe(0);
  });
});

describe('bucketScore — 0.6 * frequency + 0.4 * recency', () => {
  it('normalises frequency over the 90-day window and caps it at 1', () => {
    expect(FREQUENCY_WINDOW_DAYS).toBe(90);
    // 45 uses in a 90-day window = 0.5 frequency; used today = 1.0 recency.
    expect(bucketScore(used(45, daysAgo(0)), NOW)).toBeCloseTo(0.6 * 0.5 + 0.4 * 1, 10);
    // 90 uses = 1.0 frequency; 900 cannot score more — the cap, not a runaway.
    expect(bucketScore(used(90, daysAgo(0)), NOW)).toBeCloseTo(1, 10);
    expect(bucketScore(used(900, daysAgo(0)), NOW)).toBeCloseTo(1, 10);
  });

  it('weights the two halves 0.6 / 0.4, so recency alone cannot outrank a habit', () => {
    // Eaten every day for 90 days but not for 14: 0.6*1 + 0.4*0.5 = 0.8
    const habit = bucketScore(used(90, daysAgo(14)), NOW);
    // Eaten once, today: 0.6*(1/90) + 0.4*1 ≈ 0.4067
    const novelty = bucketScore(used(1, daysAgo(0)), NOW);
    expect(habit).toBeCloseTo(0.8, 10);
    expect(novelty).toBeCloseTo(0.6 / 90 + 0.4, 10);
    expect(habit).toBeGreaterThan(novelty);
  });

  it('is 0 for an entry with no history in the bucket', () => {
    expect(bucketScore(undefined, NOW)).toBe(0);
    expect(bucketScore(null, NOW)).toBe(0);
    expect(bucketScore({ count: 0, lastUsed: daysAgo(0) }, NOW)).toBe(0);
  });
});

describe('rankSuggestions — bucket-aware ordering', () => {
  it('with NO bucket, reproduces the shipped contract: favorites, then global score, then name', () => {
    const out = rankSuggestions([
      entry({ id: 'oatmeal', useCount: 90, lastUsed: daysAgo(3) }),
      entry({ id: 'thigh', useCount: 3, lastUsed: daysAgo(3), favorite: true }),
      entry({ id: 'breast', useCount: 40, lastUsed: daysAgo(93) }),
    ], { nowMs: NOW, limit: 12 });
    expect(out.map((e) => e.id)).toEqual(['thigh', 'oatmeal', 'breast']);
  });

  it('ranks a bucket\'s own regulars above a globally more popular food', () => {
    const out = rankSuggestions([
      // Eaten constantly, but never at breakfast.
      entry({ id: 'burrito', useCount: 200, lastUsed: daysAgo(0) }),
      entry({ id: 'oatmeal', useCount: 20, lastUsed: daysAgo(1), usageByBucket: { morning: used(18, daysAgo(1)) } }),
    ], { bucket: 'morning', nowMs: NOW, limit: 12 });
    expect(out.map((e) => e.id)).toEqual(['oatmeal', 'burrito']);
  });

  it('orders within the bucket by the blend, not by raw count', () => {
    const out = rankSuggestions([
      // 60 uses but stale by 4 half-lives: 0.6*(60/90) + 0.4*0.0625 = 0.425
      entry({ id: 'stale', useCount: 60, usageByBucket: { morning: used(60, daysAgo(56)) } }),
      // 30 uses, eaten today: 0.6*(30/90) + 0.4*1 = 0.6
      entry({ id: 'fresh', useCount: 30, usageByBucket: { morning: used(30, daysAgo(0)) } }),
    ], { bucket: 'morning', nowMs: NOW, limit: 12 });
    expect(out.map((e) => e.id)).toEqual(['fresh', 'stale']);
  });

  it('keeps favorites first even when they have no history in this bucket', () => {
    const out = rankSuggestions([
      entry({ id: 'oatmeal', useCount: 20, usageByBucket: { morning: used(18, daysAgo(0)) } }),
      entry({ id: 'kefir', useCount: 1, lastUsed: daysAgo(60), favorite: true }),
    ], { bucket: 'morning', nowMs: NOW, limit: 12 });
    expect(out.map((e) => e.id)).toEqual(['kefir', 'oatmeal']);
  });

  // ── the backfill threshold, at the boundary ───────────────────────────────
  const bucketRegular = (n) => entry({
    id: `reg${n}`, useCount: 10, usageByBucket: { morning: used(10 - n, daysAgo(n)) },
  });
  const stranger = entry({ id: 'stranger', useCount: 500, lastUsed: daysAgo(0) });

  it(`backfills from the global ranking while bucket history is under ${BUCKET_HISTORY_MIN_ENTRIES} entries`, () => {
    const four = [1, 2, 3, 4].map(bucketRegular);
    const out = rankSuggestions([...four, stranger], { bucket: 'morning', nowMs: NOW, limit: 12 });
    expect(out.map((e) => e.id)).toEqual(['reg1', 'reg2', 'reg3', 'reg4', 'stranger']);
  });

  it(`stops backfilling at EXACTLY ${BUCKET_HISTORY_MIN_ENTRIES} entries of bucket history`, () => {
    const five = [1, 2, 3, 4, 5].map(bucketRegular);
    const out = rankSuggestions([...five, stranger], { bucket: 'morning', nowMs: NOW, limit: 12 });
    expect(out.map((e) => e.id)).toEqual(['reg1', 'reg2', 'reg3', 'reg4', 'reg5']);
    expect(out.map((e) => e.id)).not.toContain('stranger');
  });

  it('a favorite is NOT the thing the threshold cuts — it survives a full bucket', () => {
    const five = [1, 2, 3, 4, 5].map(bucketRegular);
    const fav = entry({ id: 'kefir', useCount: 1, lastUsed: daysAgo(200), favorite: true });
    const out = rankSuggestions([...five, fav, stranger], { bucket: 'morning', nowMs: NOW, limit: 12 });
    expect(out[0].id).toBe('kefir');
    expect(out.map((e) => e.id)).not.toContain('stranger');
  });

  it('an empty bucket history falls all the way back to the global ranking', () => {
    const out = rankSuggestions([
      entry({ id: 'b', useCount: 5, lastUsed: daysAgo(0) }),
      entry({ id: 'a', useCount: 50, lastUsed: daysAgo(0) }),
    ], { bucket: 'night', nowMs: NOW, limit: 12 });
    expect(out.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('an empty candidate list returns an empty list, not a throw', () => {
    expect(rankSuggestions([], { bucket: 'morning', nowMs: NOW })).toEqual([]);
    expect(rankSuggestions(undefined, { bucket: 'morning', nowMs: NOW })).toEqual([]);
  });

  // ── determinism ──────────────────────────────────────────────────────────
  it('breaks an exact tie by name, so the same input always yields the same order', () => {
    const a = entry({ id: 'zucchini', normalizedName: 'zucchini', useCount: 7, lastUsed: daysAgo(2), usageByBucket: { morning: used(6, daysAgo(2)) } });
    const b = entry({ id: 'apricot', normalizedName: 'apricot', useCount: 7, lastUsed: daysAgo(2), usageByBucket: { morning: used(6, daysAgo(2)) } });
    expect(bucketScore(a.usageByBucket.morning, NOW)).toBe(bucketScore(b.usageByBucket.morning, NOW));
    expect(globalScore(a, NOW)).toBe(globalScore(b, NOW));
    expect(rankSuggestions([a, b], { bucket: 'morning', nowMs: NOW }).map((e) => e.id))
      .toEqual(['apricot', 'zucchini']);
    // Reversed input, identical output — the ordering is total, not incidental.
    expect(rankSuggestions([b, a], { bucket: 'morning', nowMs: NOW }).map((e) => e.id))
      .toEqual(['apricot', 'zucchini']);
  });

  it('does not mutate or reorder the array it was handed', () => {
    const input = [entry({ id: 'b', useCount: 1 }), entry({ id: 'a', useCount: 99 })];
    rankSuggestions(input, { bucket: 'morning', nowMs: NOW });
    expect(input.map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('honours the limit', () => {
    const many = [1, 2, 3, 4, 5, 6].map(bucketRegular);
    expect(rankSuggestions(many, { bucket: 'morning', nowMs: NOW, limit: 3 })).toHaveLength(3);
  });

  it('is bucket-scoped: history in one bucket does not rank a food in another', () => {
    const candidates = [
      entry({ id: 'oatmeal', useCount: 20, lastUsed: daysAgo(30), usageByBucket: { morning: used(18, daysAgo(0)) } }),
      entry({ id: 'steak', useCount: 21, lastUsed: daysAgo(0), usageByBucket: { evening: used(19, daysAgo(0)) } }),
    ];
    expect(rankSuggestions(candidates, { bucket: 'morning', nowMs: NOW }).map((e) => e.id)).toEqual(['oatmeal', 'steak']);
    expect(rankSuggestions(candidates, { bucket: 'evening', nowMs: NOW }).map((e) => e.id)).toEqual(['steak', 'oatmeal']);
  });
});
