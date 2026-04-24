// tests/isolated/domain/content/MediaProgress.completedAt.test.mjs
import { describe, test, expect } from '@jest/globals';
import { MediaProgress } from '#domains/content/entities/MediaProgress.mjs';

describe('MediaProgress.completedAt', () => {
  test('preserves completedAt when provided', () => {
    const p = new MediaProgress({
      contentId: 'plex:674498',
      completedAt: '2026-04-20 06:07:44'
    });
    expect(p.completedAt).toBe('2026-04-20 06:07:44');
  });

  test('defaults completedAt to null when not provided', () => {
    const p = new MediaProgress({ contentId: 'plex:674498' });
    expect(p.completedAt).toBeNull();
  });
});
