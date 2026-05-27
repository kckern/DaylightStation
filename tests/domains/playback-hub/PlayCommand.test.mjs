import { describe, it, expect } from 'vitest';
import { PlayCommand } from '../../../backend/src/2_domains/playback-hub/value-objects/PlayCommand.mjs';
import { QueueRef } from '../../../backend/src/2_domains/playback-hub/value-objects/QueueRef.mjs';
import { ValidationError } from '../../../backend/src/2_domains/core/errors/ValidationError.mjs';

const aQueue = () => new QueueRef({ source: 'plex', id: '670208' });

describe('PlayCommand', () => {
  describe('actions', () => {
    it('accepts play with a QueueRef', () => {
      const c = new PlayCommand({ action: 'play', queue: aQueue() });
      expect(c.action).toBe('play');
      expect(c.queue).toBeInstanceOf(QueueRef);
    });
    it('accepts stop, pause, next, prev (no queue/volume required)', () => {
      for (const action of ['stop', 'pause', 'next', 'prev']) {
        const c = new PlayCommand({ action });
        expect(c.action).toBe(action);
      }
    });
    it('accepts volume with numeric volume', () => {
      const c = new PlayCommand({ action: 'volume', volume: 50 });
      expect(c.action).toBe('volume');
      expect(c.volume).toBe(50);
    });
    it('rejects unknown action', () => {
      expect(() => new PlayCommand({ action: 'rewind' })).toThrow(ValidationError);
      expect(() => new PlayCommand({ action: '' })).toThrow(ValidationError);
      expect(() => new PlayCommand({ action: null })).toThrow(ValidationError);
    });
  });

  describe('play requires QueueRef', () => {
    it('throws if play missing queue', () => {
      expect(() => new PlayCommand({ action: 'play' })).toThrow(ValidationError);
    });
    it('throws if play has non-QueueRef queue', () => {
      expect(() => new PlayCommand({ action: 'play', queue: 'plex:670208' })).toThrow(ValidationError);
      expect(() => new PlayCommand({ action: 'play', queue: { source: 'plex', id: '1' } })).toThrow(ValidationError);
    });
  });

  describe('volume action requires numeric volume', () => {
    it('throws if volume action missing volume', () => {
      expect(() => new PlayCommand({ action: 'volume' })).toThrow(ValidationError);
    });
    it('throws if volume is non-number', () => {
      expect(() => new PlayCommand({ action: 'volume', volume: '50' })).toThrow(ValidationError);
      expect(() => new PlayCommand({ action: 'volume', volume: null })).toThrow(ValidationError);
    });
  });

  describe('volume range (when supplied)', () => {
    it('accepts 0 and 100 (edges)', () => {
      expect(new PlayCommand({ action: 'volume', volume: 0 }).volume).toBe(0);
      expect(new PlayCommand({ action: 'volume', volume: 100 }).volume).toBe(100);
    });
    it('rejects volume < 0', () => {
      expect(() => new PlayCommand({ action: 'volume', volume: -1 })).toThrow(ValidationError);
    });
    it('rejects volume > 100', () => {
      expect(() => new PlayCommand({ action: 'volume', volume: 101 })).toThrow(ValidationError);
    });
    it('accepts a volume passenger on play action', () => {
      const c = new PlayCommand({ action: 'play', queue: aQueue(), volume: 45 });
      expect(c.volume).toBe(45);
    });
  });

  describe('durationMin (optional)', () => {
    it('defaults to null', () => {
      expect(new PlayCommand({ action: 'stop' }).durationMin).toBeNull();
    });
    it('accepts positive integer', () => {
      expect(new PlayCommand({ action: 'play', queue: aQueue(), durationMin: 30 }).durationMin).toBe(30);
    });
    it('rejects zero', () => {
      expect(() => new PlayCommand({ action: 'play', queue: aQueue(), durationMin: 0 })).toThrow(ValidationError);
    });
    it('rejects negatives and floats', () => {
      expect(() => new PlayCommand({ action: 'play', queue: aQueue(), durationMin: -5 })).toThrow(ValidationError);
      expect(() => new PlayCommand({ action: 'play', queue: aQueue(), durationMin: 1.5 })).toThrow(ValidationError);
    });
    it('rejects non-number', () => {
      expect(() => new PlayCommand({ action: 'play', queue: aQueue(), durationMin: '30' })).toThrow(ValidationError);
    });
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new PlayCommand({ action: 'stop' }))).toBe(true);
  });
});
