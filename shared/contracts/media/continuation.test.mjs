import { describe, it, expect } from 'vitest';
import {
  selectContinuationBatch, isLibraryFallbackParent, AUTO_CONTINUE_ADDED_BY, RECENTLY_PLAYED_MS,
} from './continuation.mjs';
import { orderWatchedByRecency } from '../../../backend/src/2_domains/content/utils/recencyOrder.mjs';

const NOW = Date.parse('2026-10-02T12:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();
const ep = (n, lastPlayed = null, duration = 420) => ({ contentId: `plex:${n}`, title: `E${n}`, lastPlayed, duration });

describe('selectContinuationBatch', () => {
  it('prefers never-played items after the finished one, in natural order', () => {
    const items = [ep(1), ep(2), ep(3, daysAgo(1)), ep(4), ep(5)];
    expect(selectContinuationBatch({ items, finishedId: 'plex:2', now: NOW }).map(i => i.contentId))
      .toEqual(['plex:4', 'plex:5', 'plex:1', 'plex:3']);
  });

  it('then items not played in 7 days (wrapping), then least-recently played — the 7-day rule never empties the batch', () => {
    const items = [ep(1, daysAgo(10)), ep(2), ep(3, daysAgo(2)), ep(4, daysAgo(1)), ep(5, daysAgo(30))];
    const batch = selectContinuationBatch({ items, finishedId: 'plex:2', now: NOW });
    expect(batch.map(i => i.contentId)).toEqual(['plex:5', 'plex:1', 'plex:3', 'plex:4']);
  });

  it('orders the recently-played tail exactly like orderWatchedByRecency (shuffle off)', () => {
    const recent = [ep(7, daysAgo(1)), ep(8, daysAgo(3)), ep(9, daysAgo(2))];
    const batch = selectContinuationBatch({ items: [ep(6), ...recent], finishedId: 'plex:6', now: NOW });
    const recency = new Map(recent.map(i => [i.contentId, i.lastPlayed]));
    const expected = orderWatchedByRecency(recent.map(i => ({ ...i, id: i.contentId })), recency).map(i => i.contentId);
    expect(batch.map(i => i.contentId)).toEqual(expected);
  });

  it('caps a batch at 5 items or about 30 minutes', () => {
    const many = Array.from({ length: 12 }, (_, i) => ep(i + 1));
    expect(selectContinuationBatch({ items: many, finishedId: 'plex:1', now: NOW })).toHaveLength(5);
    const long = Array.from({ length: 6 }, (_, i) => ep(i + 1, null, 1200));
    expect(selectContinuationBatch({ items: long, finishedId: 'plex:1', now: NOW }).map(i => i.contentId))
      .toEqual(['plex:2', 'plex:3']);
  });

  it('never adds the finished item, queued items, items playing elsewhere, or live items', () => {
    const items = [ep(1), ep(2), ep(3), { ...ep(4), isLive: true }, ep(5)];
    expect(selectContinuationBatch({ items, finishedId: 'plex:1', exclude: ['plex:2', 'plex:3'], now: NOW }).map(i => i.contentId))
      .toEqual(['plex:5']);
  });

  it('plays the rest of a playlist in order and then stops — no wrap, no re-ordering', () => {
    const items = [ep(1), ep(2, daysAgo(1)), ep(3), ep(4)];
    expect(selectContinuationBatch({ items, finishedId: 'plex:2', kind: 'playlist', now: NOW }).map(i => i.contentId))
      .toEqual(['plex:3', 'plex:4']);
    expect(selectContinuationBatch({ items, finishedId: 'plex:4', kind: 'playlist', now: NOW })).toEqual([]);
  });

  it('returns nothing when the container holds nothing else', () => {
    expect(selectContinuationBatch({ items: [ep(1)], finishedId: 'plex:1', now: NOW })).toEqual([]);
    expect(selectContinuationBatch({ items: [], finishedId: 'plex:1', now: NOW })).toEqual([]);
  });

  it('exposes the marker and window constants', () => {
    expect(AUTO_CONTINUE_ADDED_BY).toBe('auto-continue');
    expect(RECENTLY_PLAYED_MS).toBe(7 * 86400000);
  });
});

describe('isLibraryFallbackParent', () => {
  it('treats the adapter whole-library fallback as no container', () => {
    expect(isLibraryFallbackParent({ id: 'library:6' })).toBe(true);
    expect(isLibraryFallbackParent(null)).toBe(true);
    expect(isLibraryFallbackParent({ id: 'plex:59494' })).toBe(false);
    expect(isLibraryFallbackParent({ id: 'plex:672301', type: 'collection' })).toBe(false);
  });
});
