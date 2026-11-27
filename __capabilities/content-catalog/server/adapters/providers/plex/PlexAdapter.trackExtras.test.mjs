import { describe, expect, it, vi } from 'vitest';
import { PlexAdapter } from "./PlexAdapter.mjs";

/**
 * Track extras: loudness levels and lyrics. Shapes are the live server's
 * (2026-11-26): `/library/streams/<audio id>/levels?subsample=N` answers
 * MediaContainer.Level[{v: dB}]; a lyrics stream (streamType 4, format lrc from
 * LyricFind or txt from local media) answers its text as text/html.
 */

const TRACK = {
  ratingKey: '352346', type: 'track', title: 'One Love', grandparentTitle: 'Artist', parentTitle: 'Album', duration: 234371,
  Media: [{ audioCodec: 'mp3', bitrate: 256, Part: [{ id: 1, key: '/library/parts/1/2/file.mp3', Stream: [
    { id: 1082866, streamType: 2, codec: 'mp3', bitrate: 256, samplingRate: 44100, loudness: '-17.65' },
    { id: 932342, streamType: 4, format: 'lrc', key: '/library/streams/932342' },
  ] }] }],
};

function setup(routes) {
  const httpClient = {
    get: vi.fn(async (url) => {
      const path = new URL(url).pathname + (new URL(url).searchParams.get('subsample') ? `?subsample=${new URL(url).searchParams.get('subsample')}` : '');
      const answer = routes[path];
      if (answer === undefined) { const e = new Error('nope'); e.response = { status: 404 }; throw e; }
      if (answer instanceof Error) throw answer;
      return { status: 200, data: answer };
    }),
  };
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const plex = new PlexAdapter({ host: 'http://plex.test:32400', token: 't', logger }, { httpClient, logger });
  return { plex, httpClient, logger };
}

const meta = (m) => ({ MediaContainer: { Metadata: [m] } });

describe('PlexAdapter.getTrackLevels', () => {
  it('reads the audio stream id from the metadata and asks for that many windows', async () => {
    const { plex, httpClient } = setup({
      '/library/metadata/352346': meta(TRACK),
      '/library/streams/1082866/levels?subsample=64': { MediaContainer: { Level: [{ v: -20 }, { v: -10.5 }] } },
    });
    const out = await plex.getTrackLevels('352346', 64);
    expect(out.decibels).toEqual([-20, -10.5]);
    expect(out.stream.id).toBe(1082866);
    expect(out.media.audioCodec).toBe('mp3');
    expect(httpClient.get.mock.calls[1][0]).toContain('/library/streams/1082866/levels?subsample=64');
  });

  it('does not ask for the levels of a track that was never analysed', async () => {
    const unanalysed = { ...TRACK, Media: [{ ...TRACK.Media[0], Part: [{ ...TRACK.Media[0].Part[0], Stream: [{ id: 5, streamType: 2, codec: 'flac' }] }] }] };
    const { plex, httpClient } = setup({ '/library/metadata/352346': meta(unanalysed) });
    const out = await plex.getTrackLevels('352346', 64);
    expect(out.decibels).toBeNull();
    expect(out.stream.codec).toBe('flac');
    expect(httpClient.get).toHaveBeenCalledTimes(1);
  });

  it('has null decibels when the levels call fails', async () => {
    const { plex } = setup({ '/library/metadata/352346': meta(TRACK) });
    expect((await plex.getTrackLevels('352346', 64)).decibels).toBeNull();
  });

  it('is null for an unknown key or a key that is not a number', async () => {
    const { plex, httpClient } = setup({});
    expect(await plex.getTrackLevels('999', 64)).toBeNull();
    expect(await plex.getTrackLevels('../x', 64)).toBeNull();
    expect(httpClient.get).toHaveBeenCalledTimes(1);
  });
});

describe('PlexAdapter.getTrackLyrics', () => {
  it('returns the lyric stream text with its format and the song identity', async () => {
    const { plex } = setup({
      '/library/metadata/352346': meta(TRACK),
      '/library/streams/932342': '[00:01.00]line',
    });
    expect(await plex.getTrackLyrics('352346')).toEqual({
      track: { artist: 'Artist', title: 'One Love', album: 'Album', durationMs: 234371 },
      lyrics: { format: 'lrc', text: '[00:01.00]line' },
    });
  });

  it('has no lyrics when the track carries no lyric stream, or fetching it fails', async () => {
    const plain = { ...TRACK, Media: [{ ...TRACK.Media[0], Part: [{ ...TRACK.Media[0].Part[0], Stream: [TRACK.Media[0].Part[0].Stream[0]] }] }] };
    let { plex } = setup({ '/library/metadata/352346': meta(plain) });
    expect((await plex.getTrackLyrics('352346')).lyrics).toBeNull();
    ({ plex } = setup({ '/library/metadata/352346': meta(TRACK), '/library/streams/932342': new Error('reset') }));
    expect((await plex.getTrackLyrics('352346')).lyrics).toBeNull();
  });
});

describe('PlexAdapter.getTrackChapters', () => {
  const BOOK = { ...TRACK, ratingKey: '731397', title: 'Consolations', parentTitle: 'Consolations', grandparentTitle: 'David Whyte',
    Media: [{ Part: [{ id: 9, duration: 13039125, file: '/data/media/audio/audiobooks/David Whyte/2014 Consolations/c.mp3' }] }] };

  it('answers the file, length and titles, and no chapters when Plex has none', async () => {
    const { plex, httpClient } = setup({ '/library/metadata/731397': meta(BOOK) });
    const out = await plex.getTrackChapters('731397');
    expect(out).toEqual({ track: { title: 'Consolations', album: 'Consolations', artist: 'David Whyte', durationMs: 13039125,
      file: '/data/media/audio/audiobooks/David Whyte/2014 Consolations/c.mp3' }, chapters: null });
    expect(httpClient.get.mock.calls[0][0]).toContain('includeChapters=1');
  });

  it('reads Plex chapter markers in ms', async () => {
    const { plex } = setup({ '/library/metadata/731397': meta({ ...BOOK, Chapter: [
      { tag: 'One', startTimeOffset: 0, endTimeOffset: 5000 }, { tag: 'Two', startTimeOffset: 5000, endTimeOffset: 9000 }] }) });
    expect((await plex.getTrackChapters('731397')).chapters).toEqual([
      { startMs: 0, endMs: 5000, title: 'One' }, { startMs: 5000, endMs: 9000, title: 'Two' }]);
  });

  it('null for an unknown or malformed key', async () => {
    const { plex } = setup({});
    expect(await plex.getTrackChapters('1')).toBeNull();
    expect(await plex.getTrackChapters('../x')).toBeNull();
  });
});
