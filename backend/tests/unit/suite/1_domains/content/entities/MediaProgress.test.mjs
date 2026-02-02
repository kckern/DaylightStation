import { describe, it, expect } from 'vitest';
import { MediaProgress } from '#domains/content/entities/MediaProgress.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

describe('MediaProgress', () => {
  describe('constructor', () => {
    it('should create a MediaProgress with all canonical fields', () => {
      const progress = new MediaProgress({
        itemId: 'movie:12345',
        playhead: 3600,
        duration: 7200,
        playCount: 2,
        lastPlayed: '2026-01-15T10:30:00Z',
        watchTime: 5400
      });

      expect(progress.itemId).toBe('movie:12345');
      expect(progress.playhead).toBe(3600);
      expect(progress.duration).toBe(7200);
      expect(progress.playCount).toBe(2);
      expect(progress.lastPlayed).toBe('2026-01-15T10:30:00Z');
      expect(progress.watchTime).toBe(5400);
    });

    it('should default optional fields to appropriate values', () => {
      const progress = new MediaProgress({
        itemId: 'movie:12345'
      });

      expect(progress.itemId).toBe('movie:12345');
      expect(progress.playhead).toBe(0);
      expect(progress.duration).toBe(0);
      expect(progress.playCount).toBe(0);
      expect(progress.lastPlayed).toBeNull();
      expect(progress.watchTime).toBe(0);
    });

    it('should throw ValidationError when itemId is missing', () => {
      expect(() => new MediaProgress({
        playhead: 100,
        duration: 200
      })).toThrow(ValidationError);
    });

    it('should throw ValidationError with correct code when itemId is missing', () => {
      try {
        new MediaProgress({
          playhead: 100,
          duration: 200
        });
        // Should not reach here
        expect.fail('Expected ValidationError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect(error.code).toBe('MISSING_ITEM_ID');
        expect(error.field).toBe('itemId');
      }
    });

    it('should throw ValidationError when itemId is empty string', () => {
      expect(() => new MediaProgress({
        itemId: '',
        playhead: 100,
        duration: 200
      })).toThrow(ValidationError);
    });

    it('should throw ValidationError when itemId is null', () => {
      expect(() => new MediaProgress({
        itemId: null,
        playhead: 100,
        duration: 200
      })).toThrow(ValidationError);
    });
  });

  describe('percent getter', () => {
    it('should calculate percentage correctly', () => {
      const progress = new MediaProgress({
        itemId: 'movie:12345',
        playhead: 3600,
        duration: 7200
      });

      expect(progress.percent).toBe(50);
    });

    it('should return 0 when duration is 0', () => {
      const progress = new MediaProgress({
        itemId: 'movie:12345',
        playhead: 100,
        duration: 0
      });

      expect(progress.percent).toBe(0);
    });

    it('should return 0 when duration is undefined (defaults to 0)', () => {
      const progress = new MediaProgress({
        itemId: 'movie:12345',
        playhead: 100
      });

      expect(progress.percent).toBe(0);
    });

    it('should round percentage to nearest integer', () => {
      const progress = new MediaProgress({
        itemId: 'movie:12345',
        playhead: 1,
        duration: 3
      });

      // 1/3 = 33.33... should round to 33
      expect(progress.percent).toBe(33);
    });

    it('should return 100 when playhead equals duration', () => {
      const progress = new MediaProgress({
        itemId: 'movie:12345',
        playhead: 7200,
        duration: 7200
      });

      expect(progress.percent).toBe(100);
    });

    it('should handle playhead greater than duration', () => {
      const progress = new MediaProgress({
        itemId: 'movie:12345',
        playhead: 8000,
        duration: 7200
      });

      // Could be over 100% but percentage is just the calculation
      expect(progress.percent).toBe(111);
    });
  });

  describe('isWatched', () => {
    it('should return true when percent is exactly 90', () => {
      const progress = new MediaProgress({
        itemId: 'movie:12345',
        playhead: 90,
        duration: 100
      });

      expect(progress.isWatched()).toBe(true);
    });

    it('should return true when percent is above 90', () => {
      const progress = new MediaProgress({
        itemId: 'movie:12345',
        playhead: 95,
        duration: 100
      });

      expect(progress.isWatched()).toBe(true);
    });

    it('should return true when percent is 100', () => {
      const progress = new MediaProgress({
        itemId: 'movie:12345',
        playhead: 100,
        duration: 100
      });

      expect(progress.isWatched()).toBe(true);
    });

    it('should return false when percent is below 90', () => {
      const progress = new MediaProgress({
        itemId: 'movie:12345',
        playhead: 89,
        duration: 100
      });

      expect(progress.isWatched()).toBe(false);
    });

    it('should return false when percent is 0', () => {
      const progress = new MediaProgress({
        itemId: 'movie:12345',
        playhead: 0,
        duration: 100
      });

      expect(progress.isWatched()).toBe(false);
    });

    it('should return false when duration is 0 (percent is 0)', () => {
      const progress = new MediaProgress({
        itemId: 'movie:12345',
        playhead: 100,
        duration: 0
      });

      expect(progress.isWatched()).toBe(false);
    });
  });

  describe('isInProgress', () => {
    it('should return true when started but not finished', () => {
      const progress = new MediaProgress({
        itemId: 'movie:12345',
        playhead: 50,
        duration: 100
      });

      expect(progress.isInProgress()).toBe(true);
    });

    it('should return true when playhead is just started (1 second)', () => {
      const progress = new MediaProgress({
        itemId: 'movie:12345',
        playhead: 1,
        duration: 100
      });

      expect(progress.isInProgress()).toBe(true);
    });

    it('should return true when percent is 89 (just below watched threshold)', () => {
      const progress = new MediaProgress({
        itemId: 'movie:12345',
        playhead: 89,
        duration: 100
      });

      expect(progress.isInProgress()).toBe(true);
    });

    it('should return false when not started (playhead is 0)', () => {
      const progress = new MediaProgress({
        itemId: 'movie:12345',
        playhead: 0,
        duration: 100
      });

      expect(progress.isInProgress()).toBe(false);
    });

    it('should return false when fully watched (percent >= 90)', () => {
      const progress = new MediaProgress({
        itemId: 'movie:12345',
        playhead: 90,
        duration: 100
      });

      expect(progress.isInProgress()).toBe(false);
    });

    it('should return false when playhead > 0 but duration is 0 (edge case)', () => {
      const progress = new MediaProgress({
        itemId: 'movie:12345',
        playhead: 100,
        duration: 0
      });

      // playhead > 0 but percent is 0 (no duration), so not watched
      // but playhead > 0, so technically in progress?
      // Based on implementation: playhead > 0 && !isWatched()
      // isWatched() returns percent >= 90, percent is 0, so isWatched() is false
      // Therefore: true && true = true
      expect(progress.isInProgress()).toBe(true);
    });
  });

  describe('toJSON', () => {
    it('should serialize all fields with canonical field names', () => {
      const progress = new MediaProgress({
        itemId: 'movie:12345',
        playhead: 3600,
        duration: 7200,
        playCount: 2,
        lastPlayed: '2026-01-15T10:30:00Z',
        watchTime: 5400
      });

      const json = progress.toJSON();

      expect(json).toEqual({
        itemId: 'movie:12345',
        playhead: 3600,
        duration: 7200,
        percent: 50,
        playCount: 2,
        lastPlayed: '2026-01-15T10:30:00Z',
        watchTime: 5400
      });
    });

    it('should include calculated percent in serialization', () => {
      const progress = new MediaProgress({
        itemId: 'movie:12345',
        playhead: 75,
        duration: 100
      });

      const json = progress.toJSON();

      expect(json.percent).toBe(75);
    });

    it('should serialize null lastPlayed correctly', () => {
      const progress = new MediaProgress({
        itemId: 'movie:12345'
      });

      const json = progress.toJSON();

      expect(json.lastPlayed).toBeNull();
    });

    it('should NOT include legacy field name "seconds"', () => {
      const progress = new MediaProgress({
        itemId: 'movie:12345',
        playhead: 100,
        duration: 200
      });

      const json = progress.toJSON();

      expect(json).not.toHaveProperty('seconds');
    });

    it('should NOT include legacy field name "mediaDuration"', () => {
      const progress = new MediaProgress({
        itemId: 'movie:12345',
        playhead: 100,
        duration: 200
      });

      const json = progress.toJSON();

      expect(json).not.toHaveProperty('mediaDuration');
    });

    it('should NOT include legacy field name "time"', () => {
      const progress = new MediaProgress({
        itemId: 'movie:12345',
        playhead: 100,
        duration: 200
      });

      const json = progress.toJSON();

      expect(json).not.toHaveProperty('time');
    });

    it('should serialize default values correctly', () => {
      const progress = new MediaProgress({
        itemId: 'movie:12345'
      });

      const json = progress.toJSON();

      expect(json).toEqual({
        itemId: 'movie:12345',
        playhead: 0,
        duration: 0,
        percent: 0,
        playCount: 0,
        lastPlayed: null,
        watchTime: 0
      });
    });
  });
});
