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

  it('includes bookmark in toJSON when present', () => {
    const bookmark = { playhead: 500, reason: 'pre-jump', createdAt: '2026-02-12T10:00:00Z' };
    const progress = new MediaProgress({ itemId: 'abs:123', playhead: 800, duration: 1000, bookmark });
    const json = progress.toJSON();
    expect(json.bookmark).toEqual(bookmark);
  });

  it('omits bookmark from toJSON when null', () => {
    const progress = new MediaProgress({ itemId: 'abs:123', playhead: 800, duration: 1000 });
    const json = progress.toJSON();
    expect(json).not.toHaveProperty('bookmark');
  });

  it('ignores expired bookmarks (>7 days old)', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const bookmark = { playhead: 500, reason: 'session-start', createdAt: eightDaysAgo };
    const progress = new MediaProgress({ itemId: 'abs:123', playhead: 800, duration: 1000, bookmark });
    expect(progress.bookmark).toBeNull();
  });
});
