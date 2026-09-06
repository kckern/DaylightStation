import { describe, it, expect } from 'vitest';
import { provisionalReview, reviewExpired, canAutoReview, stabilizeReview, confirmReview, REVIEW_WINDOW_MS } from './reviewLifecycle.mjs';

describe('capture review lifecycle', () => {
  const start = Date.parse('2026-10-31T20:48:16Z'); // window crosses DST
  const item = { calories: 160, ...provisionalReview({}, start, 'upc') };
  it('counts a provisional item and expires after exactly 72 elapsed hours', () => {
    expect(item.settled).toBe(false);
    expect(canAutoReview(item, start + REVIEW_WINDOW_MS - 1)).toBe(true);
    expect(reviewExpired(item, start + REVIEW_WINDOW_MS)).toBe(true);
    expect(stabilizeReview(item, start + REVIEW_WINDOW_MS)).toMatchObject({ settled: true, settledBy: 'auto', review: { state: 'stable' } });
  });
  it('never restarts the window on retry or reopens a confirmation', () => {
    expect(provisionalReview(item, start + 10000)).toEqual({});
    const confirmed = { ...item, ...confirmReview(item, start + 1000) };
    expect(canAutoReview(confirmed, start + 2000)).toBe(false);
    expect(stabilizeReview(confirmed, start + REVIEW_WINDOW_MS)).toEqual({});
    expect(provisionalReview(confirmed, start + 2000)).toEqual({});
  });
  it('does not reopen legacy entries', () => {
    expect(canAutoReview({ calories: 160 }, start)).toBe(false);
    expect(stabilizeReview({ settled: false }, start)).toEqual({});
  });
});
