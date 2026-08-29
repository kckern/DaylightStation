import { describe, expect, test } from 'vitest';
import {
  applyFeedStateAction,
  canonicalizeFeedUrl,
  feedStateKey,
  normalizeFeedItem,
} from '#domains/feed/feedItem.mjs';

describe('normalized feed item identity and state', () => {
  test('canonical URLs remove tracking without changing meaningful query params', () => {
    expect(canonicalizeFeedUrl('https://EXAMPLE.com/story/?utm_source=rss&id=7#top'))
      .toBe('https://example.com/story?id=7');
  });

  test('the same story shares a state key across modes and source IDs', () => {
    const reader = feedStateKey({ id: 'reader-1', link: 'https://example.com/story?utm_medium=rss' });
    const headline = feedStateKey({ id: 'headline-9', link: 'https://example.com/story/' });
    expect(reader).toBe(headline);
  });

  test('reader items retain legacy aliases while exposing the normalized contract', () => {
    const item = normalizeFeedItem(
      { id: 'reader-1', title: 'Story', link: 'https://example.com/story', isRead: true },
      { origin: 'reader', nowMs: Date.parse('2026-08-24T00:00:00.000Z') },
    );
    expect(item.source).toBe('freshrss');
    expect(item.sourceInfo.type).toBe('freshrss');
    expect(item.origins).toContain('reader');
    expect(item.state.isRead).toBe(true);
    expect(item.link).toBe('https://example.com/story');
    expect(item.state.readAt).toBe('2026-08-24T00:00:00.000Z');
  });

  test('fallback IDs and read timestamps use the caller-supplied operation time', () => {
    const nowMs = Date.parse('2026-08-24T00:00:00.123Z');
    const item = normalizeFeedItem(
      { isRead: true },
      { nowMs },
    );
    expect(item.id).toBe(`feed:${nowMs}`);
    expect(item.state.readAt).toBe('2026-08-24T00:00:00.123Z');
  });

  test('normalization and state changes reject an implicit clock', () => {
    expect(() => normalizeFeedItem({ id: 'reader-1' })).toThrow('nowMs is required');
    expect(() => applyFeedStateAction(null, 'read')).toThrow('now is required');
  });

  test('read, save, and archive remain independent and reversible', () => {
    const read = applyFeedStateAction(null, 'read', '2026-08-24T00:00:00.000Z');
    const saved = applyFeedStateAction(read, 'save', '2026-08-24T00:01:00.000Z');
    const archived = applyFeedStateAction(saved, 'archive', '2026-08-24T00:02:00.000Z');
    const restored = applyFeedStateAction(archived, 'unarchive', '2026-08-24T00:03:00.000Z');
    expect(restored).toMatchObject({ isRead: true, isSaved: true, isArchived: false });
  });
});
