// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { StreamChannel } from '../../../backend/src/2_domains/livestream/StreamChannel.mjs';

describe('StreamChannel', () => {
  let channel;

  beforeEach(() => {
    channel = new StreamChannel({
      name: 'yoto',
      format: 'aac',
      bitrate: 96,
      ambient: 'silence',
    });
  });

  describe('construction', () => {
    it('initializes with name and config', () => {
      expect(channel.name).toBe('yoto');
      expect(channel.format).toBe('aac');
      expect(channel.bitrate).toBe(96);
      expect(channel.ambient).toBe('silence');
      expect(channel.status).toBe('idle');
    });

    it('defaults to aac/96 if not specified', () => {
      const ch = new StreamChannel({ name: 'test' });
      expect(ch.format).toBe('aac');
      expect(ch.bitrate).toBe(96);
      expect(ch.ambient).toBe('silence');
    });
  });

  describe('queue operations', () => {
    it('enqueues files and reports length', () => {
      channel.enqueue('/audio/track1.mp3');
      channel.enqueue('/audio/track2.mp3');
      expect(channel.queueLength).toBe(2);
      expect(channel.queue).toEqual(['/audio/track1.mp3', '/audio/track2.mp3']);
    });

    it('enqueues multiple files at once', () => {
      channel.enqueueAll(['/audio/a.mp3', '/audio/b.mp3', '/audio/c.mp3']);
      expect(channel.queueLength).toBe(3);
    });

    it('dequeues the next track (FIFO)', () => {
      channel.enqueue('/audio/track1.mp3');
      channel.enqueue('/audio/track2.mp3');
      const next = channel.dequeue();
      expect(next).toBe('/audio/track1.mp3');
      expect(channel.queueLength).toBe(1);
    });

    it('returns null when dequeuing empty queue', () => {
      expect(channel.dequeue()).toBeNull();
    });

    it('removes item at index', () => {
      channel.enqueueAll(['/a.mp3', '/b.mp3', '/c.mp3']);
      channel.removeAt(1);
      expect(channel.queue).toEqual(['/a.mp3', '/c.mp3']);
    });

    it('clears the queue', () => {
      channel.enqueueAll(['/a.mp3', '/b.mp3']);
      channel.clearQueue();
      expect(channel.queueLength).toBe(0);
    });
  });

  describe('current track', () => {
    it('tracks the currently playing file', () => {
      channel.setCurrentTrack('/audio/now.mp3');
      expect(channel.currentTrack).toBe('/audio/now.mp3');
      expect(channel.status).toBe('playing');
    });

    it('returns to idle when current track cleared', () => {
      channel.setCurrentTrack('/audio/now.mp3');
      channel.setCurrentTrack(null);
      expect(channel.status).toBe('idle');
    });
  });

  describe('force play', () => {
    it('sets forceTrack and status', () => {
      channel.enqueue('/audio/queued.mp3');
      channel.setCurrentTrack('/audio/playing.mp3');
      channel.forcePlay('/audio/urgent.mp3');
      expect(channel.forceTrack).toBe('/audio/urgent.mp3');
    });

    it('consumeForce returns and clears the forced track', () => {
      channel.forcePlay('/audio/urgent.mp3');
      const forced = channel.consumeForce();
      expect(forced).toBe('/audio/urgent.mp3');
      expect(channel.forceTrack).toBeNull();
    });

    it('consumeForce returns null when nothing forced', () => {
      expect(channel.consumeForce()).toBeNull();
    });
  });

  describe('program state', () => {
    it('tracks waiting-for-input state', () => {
      channel.setWaitingForInput(true, { timeout: 30, default: 'a' });
      expect(channel.waitingForInput).toBe(true);
      expect(channel.inputConfig).toEqual({ timeout: 30, default: 'a' });
    });

    it('clears waiting state', () => {
      channel.setWaitingForInput(true, { timeout: 30 });
      channel.setWaitingForInput(false);
      expect(channel.waitingForInput).toBe(false);
      expect(channel.inputConfig).toBeNull();
    });

    it('tracks active program name', () => {
      channel.setProgram('story-adventure');
      expect(channel.activeProgram).toBe('story-adventure');
    });
  });

  describe('toJSON', () => {
    it('serializes channel state', () => {
      channel.enqueue('/audio/next.mp3');
      channel.setCurrentTrack('/audio/now.mp3');
      channel.setProgram('bedtime');

      const json = channel.toJSON();
      expect(json).toEqual({
        name: 'yoto',
        status: 'playing',
        format: 'aac',
        bitrate: 96,
        ambient: 'silence',
        currentTrack: '/audio/now.mp3',
        queue: ['/audio/next.mp3'],
        queueLength: 1,
        activeProgram: 'bedtime',
        waitingForInput: false,
        listenerCount: 0,
      });
    });
  });
});
