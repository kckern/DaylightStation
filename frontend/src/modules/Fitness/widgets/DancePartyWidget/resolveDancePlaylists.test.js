import { describe, it, expect } from 'vitest';
import { resolveDancePlaylists } from './resolveDancePlaylists.js';

describe('resolveDancePlaylists', () => {
  it('uses configured audio + video ids', () => {
    const r = resolveDancePlaylists({ audio_playlist_id: 463801, video_playlist_id: 99, shuffle: true });
    expect(r).toEqual({ configured: true, audioPlaylistId: 463801, videoPlaylistId: 99, shuffle: true, hasVideo: true });
  });

  it('missing/null config block → configured false, no ids (NO silent fallback)', () => {
    for (const cfg of [null, undefined]) {
      const r = resolveDancePlaylists(cfg);
      expect(r.configured).toBe(false);
      expect(r.audioPlaylistId).toBeNull();
      expect(r.videoPlaylistId).toBeNull();
      expect(r.hasVideo).toBe(false);
    }
  });

  it('empty block is configured but yields no ids — never substitutes another playlist', () => {
    const r = resolveDancePlaylists({});
    expect(r.configured).toBe(true);
    expect(r.audioPlaylistId).toBeNull();
    expect(r.videoPlaylistId).toBeNull();
  });

  it('coerces string ids ("99") → numeric id + hasVideo', () => {
    const r = resolveDancePlaylists({ audio_playlist_id: '622869', video_playlist_id: '99' });
    expect(r.audioPlaylistId).toBe(622869);
    expect(r.videoPlaylistId).toBe(99);
    expect(r.hasVideo).toBe(true);
  });

  it('rejects "0", 0, and absent video ids → null/false', () => {
    expect(resolveDancePlaylists({ video_playlist_id: '0' }).videoPlaylistId).toBeNull();
    expect(resolveDancePlaylists({ video_playlist_id: '0' }).hasVideo).toBe(false);
    expect(resolveDancePlaylists({ video_playlist_id: 0 }).videoPlaylistId).toBeNull();
    expect(resolveDancePlaylists({ video_playlist_id: 0 }).hasVideo).toBe(false);
    expect(resolveDancePlaylists({}).videoPlaylistId).toBeNull();
    expect(resolveDancePlaylists({}).hasVideo).toBe(false);
  });

  it('defaults shuffle to true', () => {
    expect(resolveDancePlaylists({ audio_playlist_id: 1 }).shuffle).toBe(true);
    expect(resolveDancePlaylists({ audio_playlist_id: 1, shuffle: false }).shuffle).toBe(false);
  });
});
