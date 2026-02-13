import { describe, it, expect } from '@jest/globals';
import { MediaProgress } from '#domains/content/entities/MediaProgress.mjs';

describe('MediaProgress bookmark', () => {
  it('stores bookmark when provided', () => {
    const bookmark = { playhead: 500, reason: 'session-start', createdAt: '2026-02-12T10:00:00Z' };
    const progress = new MediaProgress({ itemId: 'abs:123', playhead: 800, duration: 1000, bookmark });
    expect(progress.bookmark).toEqual(bookmark);
  });

  it('defaults bookmark to null when not provided', () => {
    const progress = new MediaProgress({ itemId: 'abs:123', playhead: 800, duration: 1000 });
    expect(progress.bookmark).toBeNull();
  });

  it('keeps bookmark accessible as property when present', () => {
    const bookmark = { playhead: 500, reason: 'pre-jump', createdAt: '2026-02-12T10:00:00Z' };
    const progress = new MediaProgress({ itemId: 'abs:123', playhead: 800, duration: 1000, bookmark });
    expect(progress.bookmark).toEqual(bookmark);
    expect(progress.bookmark.reason).toBe('pre-jump');
  });

  it('ignores expired bookmarks (>7 days old) using injected now', () => {
    const createdAt = '2026-02-01T10:00:00Z';
    const eightDaysLater = Date.parse(createdAt) + 8 * 24 * 60 * 60 * 1000;
    const bookmark = { playhead: 500, reason: 'session-start', createdAt };
    const progress = new MediaProgress({ itemId: 'abs:123', playhead: 800, duration: 1000, bookmark, now: eightDaysLater });
    expect(progress.bookmark).toBeNull();
  });

  it('keeps bookmark within 7-day window using injected now', () => {
    const createdAt = '2026-02-10T10:00:00Z';
    const twoDaysLater = Date.parse(createdAt) + 2 * 24 * 60 * 60 * 1000;
    const bookmark = { playhead: 500, reason: 'session-start', createdAt };
    const progress = new MediaProgress({ itemId: 'abs:123', playhead: 800, duration: 1000, bookmark, now: twoDaysLater });
    expect(progress.bookmark).toEqual(bookmark);
  });
});
