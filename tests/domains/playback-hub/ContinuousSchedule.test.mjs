import { describe, it, expect } from 'vitest';
import { ContinuousSchedule } from '../../../backend/src/2_domains/playback-hub/value-objects/ContinuousSchedule.mjs';
import { QueueRef } from '../../../backend/src/2_domains/playback-hub/value-objects/QueueRef.mjs';
import { ValidationError } from '../../../backend/src/2_domains/core/errors/ValidationError.mjs';

const aQueue = () => new QueueRef({ source: 'plex', id: '670208' });
const at = (h, m = 0) => new Date(2026, 4, 25, h, m); // Mon 2026-05-25

describe('ContinuousSchedule', () => {
  describe('construction', () => {
    it('accepts valid args', () => {
      const s = new ContinuousSchedule({ start: '07:00', end: '21:00', queue: aQueue(), shuffle: true });
      expect(s.start).toBe('07:00');
      expect(s.end).toBe('21:00');
      expect(s.queue).toBeInstanceOf(QueueRef);
      expect(s.shuffle).toBe(true);
    });
    it('shuffle defaults to false', () => {
      const s = new ContinuousSchedule({ start: '07:00', end: '21:00', queue: aQueue() });
      expect(s.shuffle).toBe(false);
    });
    it('rejects bad time format "25:00"', () => {
      expect(() => new ContinuousSchedule({ start: '25:00', end: '21:00', queue: aQueue() })).toThrow(ValidationError);
    });
    it('rejects bad time format "07:5" (single digit minute)', () => {
      expect(() => new ContinuousSchedule({ start: '07:5', end: '21:00', queue: aQueue() })).toThrow(ValidationError);
    });
    it('rejects bad end time', () => {
      expect(() => new ContinuousSchedule({ start: '07:00', end: '99:99', queue: aQueue() })).toThrow(ValidationError);
    });
    it('rejects non-string time', () => {
      expect(() => new ContinuousSchedule({ start: 700, end: '21:00', queue: aQueue() })).toThrow(ValidationError);
    });
    it('rejects non-QueueRef queue', () => {
      expect(() => new ContinuousSchedule({ start: '07:00', end: '21:00', queue: 'plex:1' })).toThrow(ValidationError);
      expect(() => new ContinuousSchedule({ start: '07:00', end: '21:00', queue: null })).toThrow(ValidationError);
    });
    it('rejects non-boolean shuffle', () => {
      expect(() => new ContinuousSchedule({ start: '07:00', end: '21:00', queue: aQueue(), shuffle: 'yes' })).toThrow(ValidationError);
    });
    it('rejects start === end (zero-length window)', () => {
      expect(() => new ContinuousSchedule({ start: '07:00', end: '07:00', queue: aQueue() })).toThrow(ValidationError);
    });
    it('accepts the boundary time 23:59', () => {
      const s = new ContinuousSchedule({ start: '00:00', end: '23:59', queue: aQueue() });
      expect(s.end).toBe('23:59');
    });
  });

  describe('activeAt — normal (non-wrap) window 07:00-21:00', () => {
    const s = new ContinuousSchedule({ start: '07:00', end: '21:00', queue: aQueue() });
    it('active at 07:00 (inclusive start)', () => {
      expect(s.activeAt(at(7, 0))).toBe(true);
    });
    it('active at 12:00 (mid-window)', () => {
      expect(s.activeAt(at(12, 0))).toBe(true);
    });
    it('active at 20:59', () => {
      expect(s.activeAt(at(20, 59))).toBe(true);
    });
    it('inactive at 21:00 (exclusive end)', () => {
      expect(s.activeAt(at(21, 0))).toBe(false);
    });
    it('inactive at 06:59', () => {
      expect(s.activeAt(at(6, 59))).toBe(false);
    });
    it('inactive at 23:00', () => {
      expect(s.activeAt(at(23, 0))).toBe(false);
    });
  });

  describe('activeAt — wrap-around window 21:00-07:00', () => {
    const s = new ContinuousSchedule({ start: '21:00', end: '07:00', queue: aQueue() });
    it('active at 23:00', () => {
      expect(s.activeAt(at(23, 0))).toBe(true);
    });
    it('active at 03:00', () => {
      expect(s.activeAt(at(3, 0))).toBe(true);
    });
    it('active at 21:00 (inclusive start)', () => {
      expect(s.activeAt(at(21, 0))).toBe(true);
    });
    it('inactive at 12:00 (mid-day, outside window)', () => {
      expect(s.activeAt(at(12, 0))).toBe(false);
    });
    it('inactive at 07:00 (exclusive end)', () => {
      expect(s.activeAt(at(7, 0))).toBe(false);
    });
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new ContinuousSchedule({ start: '07:00', end: '21:00', queue: aQueue() }))).toBe(true);
  });
});
