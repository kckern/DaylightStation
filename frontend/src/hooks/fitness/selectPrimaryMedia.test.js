import { describe, it, expect } from 'vitest';
import { selectPrimaryMedia } from './selectPrimaryMedia.js';

const MIN_LONG_MS = 10 * 60 * 1000; // 10 minutes

describe('selectPrimaryMedia', () => {
  describe('positional bias for multiple ≥10-min survivors', () => {
    it('prefers the LAST ≥10-min video when two or more survive warmup filtering', () => {
      const media = [
        { contentId: 'a', mediaType: 'video', title: 'First Workout',  durationMs: MIN_LONG_MS + 60000 },
        { contentId: 'b', mediaType: 'video', title: 'Second Workout', durationMs: MIN_LONG_MS + 30000 },
      ];
      const primary = selectPrimaryMedia(media, {});
      expect(primary.contentId).toBe('b');
    });

    it('prefers the LAST ≥10-min video even when an earlier one is longer', () => {
      const media = [
        { contentId: 'a', mediaType: 'video', title: 'First',  durationMs: MIN_LONG_MS + 5 * 60_000 }, // 15 min
        { contentId: 'b', mediaType: 'video', title: 'Second', durationMs: MIN_LONG_MS + 30_000 },     // 10.5 min
      ];
      const primary = selectPrimaryMedia(media, {});
      expect(primary.contentId).toBe('b');
    });
  });
});
