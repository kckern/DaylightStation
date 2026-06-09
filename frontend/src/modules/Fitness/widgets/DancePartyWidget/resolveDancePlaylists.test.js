import { describe, it, expect } from 'vitest';
import { resolveDancePlaylists } from './resolveDancePlaylists.js';

describe('resolveDancePlaylists', () => {
  it('uses configured audio + video ids', () => {
    const r = resolveDancePlaylists({ dance_party: { audio_playlist_id: 463801, video_playlist_id: 99, shuffle: true } }, []);
    expect(r).toEqual({ audioPlaylistId: 463801, videoPlaylistId: 99, shuffle: true, hasVideo: true });
  });

  it('falls back to the first music_playlists entry when no audio id', () => {
    const r = resolveDancePlaylists({ dance_party: {} }, [{ name: 'EDM', id: 463801 }, { name: 'X', id: 1 }]);
    expect(r.audioPlaylistId).toBe(463801);
  });

  it('coerces a string video id ("99") → numeric id + hasVideo', () => {
    const r = resolveDancePlaylists({ dance_party: { audio_playlist_id: 1, video_playlist_id: '99' } }, []);
    expect(r.videoPlaylistId).toBe(99);
    expect(r.hasVideo).toBe(true);
  });

  it('no video id → hasVideo false (CSS backdrop fallback)', () => {
    const r = resolveDancePlaylists({ dance_party: { audio_playlist_id: 1 } }, []);
    expect(r.hasVideo).toBe(false);
    expect(r.videoPlaylistId).toBeNull();
  });

  it('rejects "0", 0, and absent video ids → null/false', () => {
    expect(resolveDancePlaylists({ dance_party: { video_playlist_id: '0' } }, []).videoPlaylistId).toBeNull();
    expect(resolveDancePlaylists({ dance_party: { video_playlist_id: '0' } }, []).hasVideo).toBe(false);
    expect(resolveDancePlaylists({ dance_party: { video_playlist_id: 0 } }, []).videoPlaylistId).toBeNull();
    expect(resolveDancePlaylists({ dance_party: { video_playlist_id: 0 } }, []).hasVideo).toBe(false);
    expect(resolveDancePlaylists({ dance_party: {} }, []).videoPlaylistId).toBeNull();
    expect(resolveDancePlaylists({ dance_party: {} }, []).hasVideo).toBe(false);
  });

  it('defaults shuffle to true', () => {
    expect(resolveDancePlaylists({ dance_party: { audio_playlist_id: 1 } }, []).shuffle).toBe(true);
    expect(resolveDancePlaylists({ dance_party: { audio_playlist_id: 1, shuffle: false } }, []).shuffle).toBe(false);
  });
});
