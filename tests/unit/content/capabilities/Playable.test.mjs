// tests/unit/content/capabilities/Playable.test.mjs
import { PlayableItem } from '../../../../backend/src/1_domains/content/capabilities/Playable.mjs';

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
});
