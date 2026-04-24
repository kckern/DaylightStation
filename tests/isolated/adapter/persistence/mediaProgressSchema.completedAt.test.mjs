// tests/isolated/adapter/persistence/mediaProgressSchema.completedAt.test.mjs
import { describe, test, expect } from '@jest/globals';
import { MediaProgress } from '#domains/content/entities/MediaProgress.mjs';
import {
  serializeMediaProgress,
  CANONICAL_FIELDS
} from '#adapters/persistence/yaml/mediaProgressSchema.mjs';

describe('mediaProgressSchema.completedAt', () => {
  test('CANONICAL_FIELDS includes completedAt', () => {
    expect(CANONICAL_FIELDS).toContain('completedAt');
  });

  test('serializeMediaProgress includes completedAt when set', () => {
    const progress = new MediaProgress({
      contentId: 'plex:674498',
      playhead: 650,
      duration: 678,
      playCount: 1,
      lastPlayed: '2026-04-20 06:07:44',
      watchTime: 735,
      completedAt: '2026-04-20 06:07:44'
    });
    const serialized = serializeMediaProgress(progress);
    expect(serialized.completedAt).toBe('2026-04-20 06:07:44');
  });

  test('serializeMediaProgress omits completedAt when not set', () => {
    const progress = new MediaProgress({
      contentId: 'plex:674498',
      playhead: 40,
      duration: 678
    });
    const serialized = serializeMediaProgress(progress);
    expect(serialized).not.toHaveProperty('completedAt');
  });
});
