// tests/unit/content/capabilities/Playable.test.mjs
import { PlayableItem } from '#domains/content/capabilities/Playable.mjs';

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

  describe('toJSON() legacy field aliases', () => {
    it('should include media_url alias for mediaUrl', () => {
      const item = new PlayableItem({
        id: 'abs:audiobook-123',
        source: 'abs',
        title: 'Audiobook',
        mediaType: 'audio',
        mediaUrl: '/api/v1/proxy/abs/items/audiobook-123/play',
        resumable: true
      });
      const json = item.toJSON();
      expect(json.media_url).toBe('/api/v1/proxy/abs/items/audiobook-123/play');
      expect(json.mediaUrl).toBe('/api/v1/proxy/abs/items/audiobook-123/play');
    });

    it('should include media_type alias for mediaType', () => {
      const item = new PlayableItem({
        id: 'abs:audiobook-123',
        source: 'abs',
        title: 'Audiobook',
        mediaType: 'audio',
        mediaUrl: '/stream/123',
        resumable: true
      });
      const json = item.toJSON();
      expect(json.media_type).toBe('audio');
      expect(json.mediaType).toBe('audio');
    });

    it('should include image alias for thumbnail', () => {
      const item = new PlayableItem({
        id: 'abs:audiobook-123',
        source: 'abs',
        title: 'Audiobook',
        mediaType: 'audio',
        mediaUrl: '/stream/123',
        thumbnail: '/api/v1/proxy/abs/items/audiobook-123/cover',
        resumable: true
      });
      const json = item.toJSON();
      expect(json.image).toBe('/api/v1/proxy/abs/items/audiobook-123/cover');
      expect(json.thumbnail).toBe('/api/v1/proxy/abs/items/audiobook-123/cover');
    });

    it('should include seconds alias for resumePosition', () => {
      const item = new PlayableItem({
        id: 'abs:audiobook-123',
        source: 'abs',
        title: 'Audiobook',
        mediaType: 'audio',
        mediaUrl: '/stream/123',
        resumable: true,
        resumePosition: 3600
      });
      const json = item.toJSON();
      expect(json.seconds).toBe(3600);
      expect(json.resumePosition).toBe(3600);
    });

    it('should default seconds to 0 when resumePosition is null', () => {
      const item = new PlayableItem({
        id: 'abs:audiobook-123',
        source: 'abs',
        title: 'Audiobook',
        mediaType: 'audio',
        mediaUrl: '/stream/123',
        resumable: true
      });
      const json = item.toJSON();
      expect(json.seconds).toBe(0);
      expect(json.resumePosition).toBeNull();
    });

    it('should include media_key alias for id', () => {
      const item = new PlayableItem({
        id: 'abs:audiobook-123',
        source: 'abs',
        title: 'Audiobook',
        mediaType: 'audio',
        mediaUrl: '/stream/123',
        resumable: true
      });
      const json = item.toJSON();
      expect(json.media_key).toBe('abs:audiobook-123');
    });

    it('should preserve all original fields in toJSON', () => {
      const item = new PlayableItem({
        id: 'abs:audiobook-123',
        source: 'abs',
        title: 'Great Audiobook',
        mediaType: 'audio',
        mediaUrl: '/api/v1/proxy/abs/items/audiobook-123/play',
        duration: 36000,
        resumable: true,
        resumePosition: 1234,
        thumbnail: '/api/v1/proxy/abs/items/audiobook-123/cover',
        description: 'A great listen',
        metadata: { author: 'Jane Doe', narrator: 'John Smith' }
      });
      const json = item.toJSON();

      // DDD fields
      expect(json.id).toBe('abs:audiobook-123');
      expect(json.source).toBe('abs');
      expect(json.title).toBe('Great Audiobook');
      expect(json.mediaType).toBe('audio');
      expect(json.mediaUrl).toBe('/api/v1/proxy/abs/items/audiobook-123/play');
      expect(json.duration).toBe(36000);
      expect(json.resumable).toBe(true);
      expect(json.resumePosition).toBe(1234);
      expect(json.thumbnail).toBe('/api/v1/proxy/abs/items/audiobook-123/cover');
      expect(json.description).toBe('A great listen');
      expect(json.metadata).toEqual({ author: 'Jane Doe', narrator: 'John Smith' });

      // Legacy aliases
      expect(json.media_url).toBe('/api/v1/proxy/abs/items/audiobook-123/play');
      expect(json.media_type).toBe('audio');
      expect(json.media_key).toBe('abs:audiobook-123');
      expect(json.image).toBe('/api/v1/proxy/abs/items/audiobook-123/cover');
      expect(json.seconds).toBe(1234);
    });
  });
});
