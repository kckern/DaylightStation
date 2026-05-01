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

  describe('warmup filter (built-in patterns)', () => {
    it('drops a "Warm Up" titled video when a workout video also exists', () => {
      const media = [
        { contentId: 'wu', mediaType: 'video', title: 'Warm Up Routine', durationMs: 5 * 60_000 },
        { contentId: 'wo', mediaType: 'video', title: 'Workout',         durationMs: 30 * 60_000 },
      ];
      expect(selectPrimaryMedia(media, {}).contentId).toBe('wo');
    });

    it('drops a "Cool Down" titled video', () => {
      const media = [
        { contentId: 'wo', mediaType: 'video', title: 'Workout',   durationMs: 30 * 60_000 },
        { contentId: 'cd', mediaType: 'video', title: 'Cool Down', durationMs: 5 * 60_000 },
      ];
      expect(selectPrimaryMedia(media, {}).contentId).toBe('wo');
    });

    it('drops a "Stretch" titled video', () => {
      const media = [
        { contentId: 'st', mediaType: 'video', title: 'Stretch Series', durationMs: 5 * 60_000 },
        { contentId: 'wo', mediaType: 'video', title: 'Workout',        durationMs: 30 * 60_000 },
      ];
      expect(selectPrimaryMedia(media, {}).contentId).toBe('wo');
    });
  });

  describe('audio + fallback handling', () => {
    it('returns null when no items', () => {
      expect(selectPrimaryMedia([], {})).toBeNull();
    });

    it('returns null when only audio tracks', () => {
      const media = [{ contentId: 't1', mediaType: 'audio', title: 'song', durationMs: 200_000 }];
      expect(selectPrimaryMedia(media, {})).toBeNull();
    });

    it('falls back to longest of all videos when every video is filtered as warmup', () => {
      const media = [
        { contentId: 'a', mediaType: 'video', title: 'Warm Up',   durationMs: 300_000 },
        { contentId: 'b', mediaType: 'video', title: 'Cool Down', durationMs: 600_000 },
      ];
      expect(selectPrimaryMedia(media, {}).contentId).toBe('b');
    });

    it('uses longest-wins (no positional bias) when only ONE survivor is ≥10 min', () => {
      const media = [
        { contentId: 'short', mediaType: 'video', title: 'Short',      durationMs: 5 * 60_000 },
        { contentId: 'long',  mediaType: 'video', title: 'Long',       durationMs: 12 * 60_000 },
      ];
      expect(selectPrimaryMedia(media, {}).contentId).toBe('long');
    });
  });

  describe('config-driven warmup detection', () => {
    it('drops items whose label is in warmup_labels', () => {
      const media = [
        { contentId: 'a', mediaType: 'video', title: 'Anything',  durationMs: 5 * 60_000, labels: ['warmup'] },
        { contentId: 'b', mediaType: 'video', title: 'Workout',   durationMs: 30 * 60_000 },
      ];
      const cfg = { warmup_labels: ['warmup'] };
      expect(selectPrimaryMedia(media, cfg).contentId).toBe('b');
    });

    it('drops items whose description contains a configured warmup_description_tag', () => {
      const media = [
        { contentId: 'a', mediaType: 'video', title: 'Anything', durationMs: 5 * 60_000,
          description: 'Optional warmup that prepares your muscles' },
        { contentId: 'b', mediaType: 'video', title: 'Workout',  durationMs: 30 * 60_000 },
      ];
      const cfg = { warmup_description_tags: ['Optional warmup'] };
      expect(selectPrimaryMedia(media, cfg).contentId).toBe('b');
    });
  });

  describe('"Cold Start" warmup pattern (regression for 20260501061820.yml bug)', () => {
    it('treats "22 Minute Hard Corps—Cold Start" as a warmup', () => {
      const media = [
        { contentId: 'plex:600877', mediaType: 'video',
          title: '22 Minute Hard Corps—Cold Start', durationMs: 686164 },
        { contentId: 'plex:674501', mediaType: 'video',
          title: 'Week 1 Day 4 - Upper Body',       durationMs: 642081 },
      ];
      expect(selectPrimaryMedia(media, {}).contentId).toBe('plex:674501');
    });

    it('drops "cold start" (case-insensitive) when it is the only ≥10-min video and a shorter non-warmup exists', () => {
      const media = [
        { contentId: 'cs', mediaType: 'video', title: 'cold start',    durationMs: 12 * 60_000 },
        { contentId: 'wo', mediaType: 'video', title: 'Workout Short', durationMs: 8 * 60_000 },
      ];
      expect(selectPrimaryMedia(media, {}).contentId).toBe('wo');
    });
  });
});
