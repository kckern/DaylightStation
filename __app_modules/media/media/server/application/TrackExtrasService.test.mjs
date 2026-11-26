import { describe, it, expect, vi } from 'vitest';
import { TrackExtrasService, LYRICS_MISS_TTL_MS } from './TrackExtrasService.mjs';

const TRACK = { artist: 'A', title: 'T', album: 'Al', durationMs: 200000 };

function memoryCache() {
  const map = new Map();
  return {
    map,
    get: vi.fn(async (s, id) => map.get(`${s}:${id}`)),
    set: vi.fn(async (s, id, value, at) => { map.set(`${s}:${id}`, { at, value }); }),
  };
}

function setup({ plex = {}, lrclib = null, enabled = true, now = 1_000_000 } = {}) {
  const registry = new Map([['plex', plex]]);
  const cache = memoryCache();
  const logger = { warn: vi.fn(), debug: vi.fn() };
  const svc = new TrackExtrasService({ registry, lrclib, cache, lrclibEnabled: () => enabled, logger, now: () => now });
  return { svc, cache, logger };
}

describe('TrackExtrasService.levels', () => {
  it('maps decibels to bar heights and carries quality', async () => {
    const plex = { getTrackLevels: vi.fn(async () => ({ decibels: [-40, -20, 0], media: { audioCodec: 'flac', bitrate: 900 }, stream: { samplingRate: 48000, bitDepth: 24 } })) };
    const { svc } = setup({ plex });
    expect(await svc.levels('plex', '1', 3)).toEqual({ kind: 'ok', samples: [0, 0.5, 1], quality: { codec: 'flac', bitrate: 900, sampleRate: 48000, bitDepth: 24 } });
    expect(plex.getTrackLevels).toHaveBeenCalledWith('1', 3);
  });

  it('answers quality alone when the track has no loudness analysis', async () => {
    const plex = { getTrackLevels: async () => ({ decibels: null, media: { audioCodec: 'mp3' }, stream: null }) };
    expect(await setup({ plex }).svc.levels('plex', '1', 8)).toEqual({ kind: 'ok', samples: [], quality: { codec: 'mp3' } });
  });

  it('is none for a source without levels or a track with nothing, not_found for an unknown one', async () => {
    expect(await setup().svc.levels('files', '1', 8)).toEqual({ kind: 'none' });
    expect(await setup({ plex: { getTrackLevels: async () => ({ decibels: null, media: {}, stream: null }) } }).svc.levels('plex', '1', 8)).toEqual({ kind: 'none' });
    expect(await setup({ plex: { getTrackLevels: async () => null } }).svc.levels('plex', '1', 8)).toEqual({ kind: 'not_found' });
  });
});

describe('TrackExtrasService.lyrics', () => {
  it('prefers the source and caches what it found', async () => {
    const lrclib = { find: vi.fn() };
    const plex = { getTrackLyrics: vi.fn(async () => ({ track: TRACK, lyrics: { format: 'lrc', text: '[00:01.00]hi' } })) };
    const { svc, cache } = setup({ plex, lrclib });
    const out = await svc.lyrics('plex', '1');
    expect(out).toEqual({ kind: 'ok', synced: true, lines: [{ ms: 1000, text: 'hi' }], provider: 'plex' });
    expect(lrclib.find).not.toHaveBeenCalled();
    await svc.lyrics('plex', '1');
    expect(plex.getTrackLyrics).toHaveBeenCalledTimes(1);
    expect(cache.map.get('plex:1').value.provider).toBe('plex');
  });

  it('falls back to LRCLIB with the song identity only', async () => {
    const lrclib = { find: vi.fn(async () => ({ format: 'txt', text: 'one\ntwo' })) };
    const plex = { getTrackLyrics: async () => ({ track: TRACK, lyrics: null }) };
    const out = await setup({ plex, lrclib }).svc.lyrics('plex', '1');
    expect(out).toEqual({ kind: 'ok', synced: false, lines: [{ ms: null, text: 'one' }, { ms: null, text: 'two' }], provider: 'lrclib' });
    expect(lrclib.find).toHaveBeenCalledWith(TRACK);
  });

  it('does not ask LRCLIB when the household turned it off', async () => {
    const lrclib = { find: vi.fn() };
    const plex = { getTrackLyrics: async () => ({ track: TRACK, lyrics: null }) };
    expect(await setup({ plex, lrclib, enabled: false }).svc.lyrics('plex', '1')).toEqual({ kind: 'none' });
    expect(lrclib.find).not.toHaveBeenCalled();
  });

  it('remembers a miss for a week, then asks again', async () => {
    const lrclib = { find: vi.fn(async () => null) };
    const plex = { getTrackLyrics: vi.fn(async () => ({ track: TRACK, lyrics: null })) };
    const registry = new Map([['plex', plex]]);
    const cache = memoryCache();
    let now = 0;
    const svc = new TrackExtrasService({ registry, lrclib, cache, now: () => now, logger: { warn() {}, debug() {} } });
    expect(await svc.lyrics('plex', '1')).toEqual({ kind: 'none' });
    now = LYRICS_MISS_TTL_MS - 1;
    await svc.lyrics('plex', '1');
    expect(plex.getTrackLyrics).toHaveBeenCalledTimes(1);
    now = LYRICS_MISS_TTL_MS + 1;
    await svc.lyrics('plex', '1');
    expect(plex.getTrackLyrics).toHaveBeenCalledTimes(2);
  });

  it('answers none, warns and caches nothing when LRCLIB fails', async () => {
    const lrclib = { find: async () => { throw Object.assign(new Error('timeout'), { status: undefined }); } };
    const plex = { getTrackLyrics: async () => ({ track: TRACK, lyrics: null }) };
    const { svc, cache, logger } = setup({ plex, lrclib });
    expect(await svc.lyrics('plex', '1')).toEqual({ kind: 'none' });
    expect(logger.warn).toHaveBeenCalledWith('media.trackLyrics.lrclib-failed', expect.objectContaining({ localId: '1' }));
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('is none for a source without lyrics and not_found for an unknown track', async () => {
    expect(await setup().svc.lyrics('files', '1')).toEqual({ kind: 'none' });
    expect(await setup({ plex: { getTrackLyrics: async () => null } }).svc.lyrics('plex', '9')).toEqual({ kind: 'not_found' });
  });
});
