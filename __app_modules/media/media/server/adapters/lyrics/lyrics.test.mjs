import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { LrclibLyricsAdapter, LRCLIB_USER_AGENT } from './LrclibLyricsAdapter.mjs';
import { FileLyricsCache } from './FileLyricsCache.mjs';

const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

describe('LrclibLyricsAdapter', () => {
  it('sends only the song identity and prefers synced lyrics', async () => {
    const fetchImpl = vi.fn(async () => json(200, { syncedLyrics: '[00:01.00]a', plainLyrics: 'a' }));
    const out = await new LrclibLyricsAdapter({ fetchImpl }).find({ artist: 'Bob Marley', title: 'One Love', album: 'Legend', durationMs: 175546 });
    expect(out).toEqual({ format: 'lrc', text: '[00:01.00]a' });
    const [url, init] = fetchImpl.mock.calls[0];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://lrclib.net/api/get');
    expect(Object.fromEntries(u.searchParams)).toEqual({ artist_name: 'Bob Marley', track_name: 'One Love', album_name: 'Legend', duration: '176' });
    expect(init.headers['User-Agent']).toBe(LRCLIB_USER_AGENT);
  });

  it('falls back to plain lyrics; 404 and instrumental are none; other statuses throw', async () => {
    expect(await new LrclibLyricsAdapter({ fetchImpl: async () => json(200, { plainLyrics: 'x' }) }).find({ artist: 'a', title: 't' }))
      .toEqual({ format: 'txt', text: 'x' });
    expect(await new LrclibLyricsAdapter({ fetchImpl: async () => json(404, {}) }).find({ artist: 'a', title: 't' })).toBeNull();
    expect(await new LrclibLyricsAdapter({ fetchImpl: async () => json(200, { instrumental: true }) }).find({ artist: 'a', title: 't' })).toBeNull();
    await expect(new LrclibLyricsAdapter({ fetchImpl: async () => json(500, {}) }).find({ artist: 'a', title: 't' })).rejects.toThrow('500');
  });

  it('does not ask without an artist and a title', async () => {
    const fetchImpl = vi.fn();
    expect(await new LrclibLyricsAdapter({ fetchImpl }).find({ artist: '', title: 't' })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('FileLyricsCache', () => {
  let dir;
  afterEach(async () => { if (dir) await fs.rm(dir, { recursive: true, force: true }); });

  it('round-trips hits and misses per source and id, and keeps ids inside its directory', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lyrics-cache-'));
    const cache = new FileLyricsCache({ dir });
    expect(await cache.get('plex', '1')).toBeUndefined();
    await cache.set('plex', '1', { synced: false, lines: [] }, 5);
    await cache.set('plex', '2', null, 6);
    expect(await cache.get('plex', '1')).toEqual({ at: 5, value: { synced: false, lines: [] } });
    expect(await cache.get('plex', '2')).toEqual({ at: 6, value: null });
    await cache.set('files', '../../etc/x', null, 1);
    const files = await fs.readdir(path.join(dir, 'files'));
    expect(files).toEqual(['__.._etc_x.json']);
    await cache.set('..', '..', null, 1);
    expect(await cache.get('..', '..')).toEqual({ at: 1, value: null });
    expect((await fs.readdir(dir)).sort()).toEqual(['_', 'files', 'plex']);
  });
});
