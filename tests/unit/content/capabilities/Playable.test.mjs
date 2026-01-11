// tests/unit/content/capabilities/Playable.test.mjs
import { PlayableItem } from '../../../../backend/src/domains/content/capabilities/Playable.mjs';

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
});
