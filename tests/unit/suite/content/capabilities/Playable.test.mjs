// tests/unit/content/capabilities/Playable.test.mjs
import { PlayableItem } from '#backend/src/1_domains/content/capabilities/Playable.mjs';

describe('Playable capability', () => {
  test('creates playable video item', () => {
    const item = new PlayableItem({
      id: 'plex:12345',
      source: 'plex',
      title: 'Movie',
      mediaType: 'video',
      mediaUrl: '/proxy/plex/stream/12345',
      duration: 7200,
      resumable: true
    });

    expect(item.mediaType).toBe('video');
    expect(item.mediaUrl).toBe('/proxy/plex/stream/12345');
    expect(item.duration).toBe(7200);
    expect(item.resumable).toBe(true);
  });

  test('audio items are not resumable by default', () => {
    const item = new PlayableItem({
      id: 'filesystem:audio/song.mp3',
      source: 'filesystem',
      title: 'Song',
      mediaType: 'audio',
      mediaUrl: '/proxy/filesystem/stream/audio/song.mp3',
      duration: 180,
      resumable: false
    });

    expect(item.resumable).toBe(false);
  });

  test('supports resume position', () => {
    const item = new PlayableItem({
      id: 'plex:12345',
      source: 'plex',
      title: 'Movie',
      mediaType: 'video',
      mediaUrl: '/proxy/plex/stream/12345',
      duration: 7200,
      resumable: true,
      resumePosition: 3600
    });

    expect(item.resumePosition).toBe(3600);
  });

  describe('getProgress()', () => {
    test('returns null when resumable is false', () => {
      const item = new PlayableItem({
        id: 'plex:12345',
        source: 'plex',
        title: 'Movie',
        mediaType: 'video',
        mediaUrl: '/proxy/plex/stream/12345',
        duration: 7200,
        resumable: false,
        resumePosition: 3600
      });

      expect(item.getProgress()).toBeNull();
    });

    test('returns null when duration is missing', () => {
      const item = new PlayableItem({
        id: 'plex:12345',
        source: 'plex',
        title: 'Movie',
        mediaType: 'video',
        mediaUrl: '/proxy/plex/stream/12345',
        resumable: true,
        resumePosition: 3600
      });

      expect(item.getProgress()).toBeNull();
    });

    test('returns null when duration is null', () => {
      const item = new PlayableItem({
        id: 'plex:12345',
        source: 'plex',
        title: 'Movie',
        mediaType: 'video',
        mediaUrl: '/proxy/plex/stream/12345',
        duration: null,
        resumable: true,
        resumePosition: 3600
      });

      expect(item.getProgress()).toBeNull();
    });

    test('returns null when resumePosition is missing', () => {
      const item = new PlayableItem({
        id: 'plex:12345',
        source: 'plex',
        title: 'Movie',
        mediaType: 'video',
        mediaUrl: '/proxy/plex/stream/12345',
        duration: 7200,
        resumable: true
      });

      expect(item.getProgress()).toBeNull();
    });

    test('returns null when resumePosition is null', () => {
      const item = new PlayableItem({
        id: 'plex:12345',
        source: 'plex',
        title: 'Movie',
        mediaType: 'video',
        mediaUrl: '/proxy/plex/stream/12345',
        duration: 7200,
        resumable: true,
        resumePosition: null
      });

      expect(item.getProgress()).toBeNull();
    });

    test('returns correct percentage', () => {
      const item = new PlayableItem({
        id: 'plex:12345',
        source: 'plex',
        title: 'Movie',
        mediaType: 'video',
        mediaUrl: '/proxy/plex/stream/12345',
        duration: 7200,
        resumable: true,
        resumePosition: 3600
      });

      expect(item.getProgress()).toBe(50);
    });

    test('handles 0% progress', () => {
      const item = new PlayableItem({
        id: 'plex:12345',
        source: 'plex',
        title: 'Movie',
        mediaType: 'video',
        mediaUrl: '/proxy/plex/stream/12345',
        duration: 7200,
        resumable: true,
        resumePosition: 0
      });

      expect(item.getProgress()).toBeNull(); // resumePosition 0 is falsy
    });

    test('handles 100% progress', () => {
      const item = new PlayableItem({
        id: 'plex:12345',
        source: 'plex',
        title: 'Movie',
        mediaType: 'video',
        mediaUrl: '/proxy/plex/stream/12345',
        duration: 7200,
        resumable: true,
        resumePosition: 7200
      });

      expect(item.getProgress()).toBe(100);
    });
  });

  describe('playbackRate default value', () => {
    test('defaults to 1.0 when not provided', () => {
      const item = new PlayableItem({
        id: 'plex:12345',
        source: 'plex',
        title: 'Movie',
        mediaType: 'video',
        mediaUrl: '/proxy/plex/stream/12345',
        duration: 7200,
        resumable: true
      });

      expect(item.playbackRate).toBe(1.0);
    });

    test('can be overridden with custom value', () => {
      const item = new PlayableItem({
        id: 'plex:12345',
        source: 'plex',
        title: 'Movie',
        mediaType: 'video',
        mediaUrl: '/proxy/plex/stream/12345',
        duration: 7200,
        resumable: true,
        playbackRate: 1.5
      });

      expect(item.playbackRate).toBe(1.5);
    });
  });

  describe('optional field defaults', () => {
    test('duration defaults to null when not provided', () => {
      const item = new PlayableItem({
        id: 'plex:12345',
        source: 'plex',
        title: 'Movie',
        mediaType: 'video',
        mediaUrl: '/proxy/plex/stream/12345',
        resumable: true
      });

      expect(item.duration).toBeNull();
    });

    test('resumePosition defaults to null when not provided', () => {
      const item = new PlayableItem({
        id: 'plex:12345',
        source: 'plex',
        title: 'Movie',
        mediaType: 'video',
        mediaUrl: '/proxy/plex/stream/12345',
        duration: 7200,
        resumable: true
      });

      expect(item.resumePosition).toBeNull();
    });
  });

  describe('watch state fields', () => {
    test('should include watch progress percentage', () => {
      const item = new PlayableItem({
        id: 'plex:123',
        source: 'plex',
        title: 'Movie',
        mediaType: 'video',
        mediaUrl: '/stream/123',
        duration: 7200,
        resumable: true,
        resumePosition: 3600,
        watchProgress: 50
      });
      expect(item.watchProgress).toBe(50);
    });

    test('should calculate watchProgress from resumePosition/duration', () => {
      const item = new PlayableItem({
        id: 'plex:123',
        source: 'plex',
        title: 'Movie',
        mediaType: 'video',
        mediaUrl: '/stream/123',
        duration: 7200,
        resumable: true,
        resumePosition: 3600
      });
      expect(item.watchProgress).toBe(50);
    });

    test('should include watchSeconds alias for resumePosition', () => {
      const item = new PlayableItem({
        id: 'plex:123',
        source: 'plex',
        title: 'Movie',
        mediaType: 'video',
        mediaUrl: '/stream/123',
        resumable: true,
        resumePosition: 3600
      });
      expect(item.watchSeconds).toBe(3600);
    });

    test('should include lastPlayed timestamp', () => {
      const item = new PlayableItem({
        id: 'plex:123',
        source: 'plex',
        title: 'Movie',
        mediaType: 'video',
        mediaUrl: '/stream/123',
        resumable: true,
        lastPlayed: '2026-01-13T14:30:00Z'
      });
      expect(item.lastPlayed).toBe('2026-01-13T14:30:00Z');
    });

    test('should include playCount', () => {
      const item = new PlayableItem({
        id: 'plex:123',
        source: 'plex',
        title: 'Movie',
        mediaType: 'video',
        mediaUrl: '/stream/123',
        resumable: true,
        playCount: 3
      });
      expect(item.playCount).toBe(3);
    });

    test('watchProgress returns null when no resumePosition or duration', () => {
      const item = new PlayableItem({
        id: 'plex:123',
        source: 'plex',
        title: 'Movie',
        mediaType: 'video',
        mediaUrl: '/stream/123',
        resumable: true
      });
      expect(item.watchProgress).toBeNull();
    });

    test('watchSeconds returns null when no resumePosition', () => {
      const item = new PlayableItem({
        id: 'plex:123',
        source: 'plex',
        title: 'Movie',
        mediaType: 'video',
        mediaUrl: '/stream/123',
        resumable: true
      });
      expect(item.watchSeconds).toBeNull();
    });

    test('lastPlayed defaults to null', () => {
      const item = new PlayableItem({
        id: 'plex:123',
        source: 'plex',
        title: 'Movie',
        mediaType: 'video',
        mediaUrl: '/stream/123',
        resumable: true
      });
      expect(item.lastPlayed).toBeNull();
    });

    test('playCount defaults to 0', () => {
      const item = new PlayableItem({
        id: 'plex:123',
        source: 'plex',
        title: 'Movie',
        mediaType: 'video',
        mediaUrl: '/stream/123',
        resumable: true
      });
      expect(item.playCount).toBe(0);
    });
  });

  describe('behavior flags', () => {
    it('should support shuffle flag', () => {
      const item = new PlayableItem({
        id: 'folder:music',
        source: 'folder',
        title: 'Music',
        mediaType: 'audio',
        mediaUrl: '/stream/music',
        shuffle: true
      });
      expect(item.shuffle).toBe(true);
    });

    it('should support continuous flag', () => {
      const item = new PlayableItem({
        id: 'folder:ambient',
        source: 'folder',
        title: 'Ambient',
        mediaType: 'audio',
        mediaUrl: '/stream/ambient',
        continuous: true
      });
      expect(item.continuous).toBe(true);
    });

    it('should support resume flag', () => {
      const item = new PlayableItem({
        id: 'plex:123',
        source: 'plex',
        title: 'Movie',
        mediaType: 'video',
        mediaUrl: '/stream/123',
        resume: true
      });
      expect(item.resume).toBe(true);
    });

    it('should support active flag for queue filtering', () => {
      const item = new PlayableItem({
        id: 'plex:123',
        source: 'plex',
        title: 'Movie',
        mediaType: 'video',
        mediaUrl: '/stream/123',
        active: false
      });
      expect(item.active).toBe(false);
    });

    it('should default active to true', () => {
      const item = new PlayableItem({
        id: 'plex:123',
        source: 'plex',
        title: 'Movie',
        mediaType: 'video',
        mediaUrl: '/stream/123'
      });
      expect(item.active).toBe(true);
    });

    it('should default other flags to false', () => {
      const item = new PlayableItem({
        id: 'plex:123',
        source: 'plex',
        title: 'Movie',
        mediaType: 'video',
        mediaUrl: '/stream/123'
      });
      expect(item.shuffle).toBe(false);
      expect(item.continuous).toBe(false);
      expect(item.resume).toBe(false);
    });
  });
});
