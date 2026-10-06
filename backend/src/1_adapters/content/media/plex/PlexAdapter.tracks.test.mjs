import { describe, expect, it, vi } from 'vitest';
import { PlexAdapter } from './PlexAdapter.mjs';

/**
 * Subtitles and audio language (RQ-STEER-14). Plex ignores stream ids on the
 * transcode decision/start URLs; it plays the part's SELECTED streams, and
 * that selection is per Plex ACCOUNT — shared by every screen and every Plex
 * app. Verified against the live server (2026-10-03): the decision binds the
 * selection to its session, so a mint selects the streams, asks for the
 * decision, and puts the account's previous selection straight back before
 * anything else can start. A chosen subtitle is burned into the picture. A
 * mint that asks for nothing is unchanged.
 */

const STREAMS = [
  { id: 1278355, streamType: 1, codec: 'h264' },
  { id: 1278356, streamType: 2, languageCode: 'eng', selected: true },
  { id: 1278358, streamType: 3, languageCode: 'eng' },
  { id: 1278377, streamType: 3, languageCode: 'ell' },
];

function item({ container = 'mkv', audioCodec = 'eac3' } = {}) {
  return {
    id: 'plex:665638', localId: '665638', mediaType: 'dash_video',
    metadata: {
      type: 'episode',
      Media: [{ videoCodec: 'h264', audioCodec, container, Part: [{ id: 729273, key: '/library/parts/729273/1/file.mkv', Stream: STREAMS }] }],
    },
  };
}

function setup() {
  const httpClient = {
    get: vi.fn(async () => ({ status: 200, data: { MediaContainer: { generalDecisionCode: 1001, transcodeDecisionCode: 1001 } } })),
    put: vi.fn(async () => ({ status: 200, data: '' })),
    post: vi.fn(),
  };
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const plex = new PlexAdapter({ host: 'http://plex.test:32400', token: 't', protocol: 'dash', logger }, { httpClient, logger });
  return { plex, httpClient, logger };
}

describe('PlexAdapter.loadMediaUrl — stream selection', () => {
  it('without a selection mints exactly as before: no part write, no subtitle burn', async () => {
    const { plex, httpClient } = setup();
    const result = await plex.loadMediaUrl(item(), { session: 's1' });
    expect(httpClient.put).not.toHaveBeenCalled();
    expect(result.url).not.toMatch(/subtitles=/);
    expect(httpClient.get.mock.calls[0][0]).not.toMatch(/subtitles=/);
  });

  it('selects the chosen subtitle on the part, then burns it into the transcode', async () => {
    const { plex, httpClient } = setup();
    const result = await plex.loadMediaUrl(item(), { session: 's1', tracks: { subtitleStreamId: '1278358' } });
    expect(httpClient.put).toHaveBeenCalledTimes(2);
    const putUrl = new URL(httpClient.put.mock.calls[0][0]);
    expect(putUrl.pathname).toBe('/library/parts/729273');
    expect(putUrl.searchParams.get('subtitleStreamID')).toBe('1278358');
    expect(putUrl.searchParams.get('allParts')).toBe('1');
    // The selection is written before Plex decides.
    expect(httpClient.put.mock.invocationCallOrder[0]).toBeLessThan(httpClient.get.mock.invocationCallOrder[0]);
    expect(new URL(httpClient.get.mock.calls[0][0]).searchParams.get('subtitles')).toBe('burn');
    expect(result.url).toMatch(/[?&]subtitles=burn(&|$)/);
    expect(result.url).toMatch(/directStream=0/);
  });

  it('puts the account\'s previous selection back right after the decision — never leaves it changed', async () => {
    const { plex, httpClient, logger } = setup();
    await plex.loadMediaUrl(item(), { session: 's1', tracks: { subtitleStreamId: '1278358' } });
    const [select, restore] = httpClient.put.mock.calls.map(([url]) => new URL(url));
    expect(select.searchParams.get('subtitleStreamID')).toBe('1278358');
    // Nothing was selected before: the restore turns subtitles back off.
    expect(restore.pathname).toBe('/library/parts/729273');
    expect(restore.searchParams.get('subtitleStreamID')).toBe('0');
    expect(restore.searchParams.has('audioStreamID')).toBe(false);
    const decisionOrder = httpClient.get.mock.invocationCallOrder[0];
    expect(httpClient.put.mock.invocationCallOrder[0]).toBeLessThan(decisionOrder);
    expect(httpClient.put.mock.invocationCallOrder[1]).toBeGreaterThan(decisionOrder);
    expect(logger.info).toHaveBeenCalledWith('plex.loadMediaUrl.tracks-restored', expect.objectContaining({ ratingKey: '665638' }));
  });

  it('restores the previous audio stream after an audio choice, even when the decision fails', async () => {
    const { plex, httpClient } = setup();
    httpClient.get.mockRejectedValueOnce(new Error('decision down'));
    const film = item();
    film.metadata.Media[0].Part[0].Stream = [...STREAMS, { id: 9, streamType: 2, languageCode: 'fra' }];
    await plex.loadMediaUrl(film, { tracks: { audioStreamId: '9' } });
    const [, restore] = httpClient.put.mock.calls.map(([url]) => new URL(url));
    expect(restore.searchParams.get('audioStreamID')).toBe('1278356');
    expect(restore.searchParams.has('subtitleStreamID')).toBe(false);
  });

  it('turns subtitles off without burning anything', async () => {
    const { plex, httpClient } = setup();
    const selected = item();
    selected.metadata.Media[0].Part[0].Stream = STREAMS.map((s) => (s.id === 1278358 ? { ...s, selected: true } : s));
    const result = await plex.loadMediaUrl(selected, { tracks: { subtitleStreamId: '0' } });
    expect(new URL(httpClient.put.mock.calls[0][0]).searchParams.get('subtitleStreamID')).toBe('0');
    // …and the household's English subtitle selection is put back.
    expect(new URL(httpClient.put.mock.calls[1][0]).searchParams.get('subtitleStreamID')).toBe('1278358');
    expect(result.url).not.toMatch(/subtitles=/);
  });

  it('selects an audio track and never direct-plays the file it could not choose within', async () => {
    const { plex, httpClient } = setup();
    // An h264/aac mp4 would normally be eligible to direct-play.
    const mp4 = item({ container: 'mp4', audioCodec: 'aac' });
    mp4.metadata.Media[0].Part[0].Stream = [...STREAMS, { id: 9, streamType: 2, languageCode: 'fra' }];
    await plex.loadMediaUrl(mp4, { tracks: { audioStreamId: '9' } });
    expect(new URL(httpClient.put.mock.calls[0][0]).searchParams.get('audioStreamID')).toBe('9');
    expect(new URL(httpClient.get.mock.calls[0][0]).searchParams.get('directPlay')).toBe('0');
  });

  it('refuses stream ids the item does not have — only its own tracks are selectable', async () => {
    const { plex, httpClient, logger } = setup();
    const result = await plex.loadMediaUrl(item(), { tracks: { subtitleStreamId: '999', audioStreamId: '1278358' } });
    expect(httpClient.put).not.toHaveBeenCalled();
    expect(result.url).not.toMatch(/subtitles=/);
    expect(logger.warn).toHaveBeenCalledWith('plex.loadMediaUrl.tracks-rejected', expect.objectContaining({ ratingKey: '665638' }));
  });

  it('still plays when Plex refuses the selection, without burning a stale subtitle', async () => {
    const { plex, httpClient, logger } = setup();
    httpClient.put.mockRejectedValueOnce(Object.assign(new Error('boom'), { response: { status: 500 } }));
    const result = await plex.loadMediaUrl(item(), { tracks: { subtitleStreamId: '1278358' } });
    expect(result.url).toBeTruthy();
    expect(result.url).not.toMatch(/subtitles=/);
    expect(logger.warn).toHaveBeenCalledWith('plex.loadMediaUrl.tracks-select-failed', expect.objectContaining({ ratingKey: '665638' }));
  });
  it('serialises two mints on one part: the second restores the household choice, never the first mint\'s borrowed track', async () => {
    const { plex, httpClient } = setup();
    const streams = (selectedAudio) => [
      { id: 1278355, streamType: 1 },
      { id: 1278356, streamType: 2, languageCode: 'eng', ...(selectedAudio === 1278356 ? { selected: true } : {}) },
      { id: 9, streamType: 2, languageCode: 'fra', ...(selectedAudio === 9 ? { selected: true } : {}) },
      { id: 8, streamType: 2, languageCode: 'deu', ...(selectedAudio === 8 ? { selected: true } : {}) },
    ];
    let account = 1278356; // the Plex account's selected audio stream
    const writes = [];
    httpClient.put.mockImplementation(async (url) => {
      const id = new URL(url).searchParams.get('audioStreamID');
      if (id) { account = Number(id); writes.push(account); }
      return { status: 200, data: '' };
    });
    httpClient.get.mockImplementation(async (url) => {
      if (String(url).includes('/library/metadata/')) {
        return { status: 200, data: { MediaContainer: { Metadata: [{ Media: [{ Part: [{ id: 729273, Stream: streams(account) }] }] }] } } };
      }
      await new Promise((r) => setTimeout(r, 15));
      return { status: 200, data: { MediaContainer: { generalDecisionCode: 1001, transcodeDecisionCode: 1001 } } };
    });
    const mk = () => { const f = item(); f.metadata.Media[0].Part[0].Stream = streams(1278356); return f; };
    const a = plex.loadMediaUrl(mk(), { session: 'a', tracks: { audioStreamId: '9' } });
    const b = plex.loadMediaUrl(mk(), { session: 'b', tracks: { audioStreamId: '8' } });
    await Promise.all([a, b]);
    // select 9, restore 1278356, select 8, restore 1278356 — never interleaved.
    expect(writes).toEqual([9, 1278356, 8, 1278356]);
    expect(account).toBe(1278356);
  });

  it('restores to the default audio stream when none is flagged selected, and says so', async () => {
    const { plex, httpClient, logger } = setup();
    const film = item();
    film.metadata.Media[0].Part[0].Stream = [
      { id: 1278355, streamType: 1 },
      { id: 5, streamType: 2, languageCode: 'eng' },
      { id: 6, streamType: 2, languageCode: 'fra', default: true },
      { id: 9, streamType: 2, languageCode: 'deu' },
    ];
    await plex.loadMediaUrl(film, { tracks: { audioStreamId: '9' } });
    expect(new URL(httpClient.put.mock.calls[1][0]).searchParams.get('audioStreamID')).toBe('6');
    expect(logger.info).toHaveBeenCalledWith('plex.loadMediaUrl.tracks-restored', expect.objectContaining({ audioStreamId: '6' }));
  });

  it('warns tracks-restore-skipped when there is nothing to restore an audio choice to', async () => {
    const { plex, httpClient, logger } = setup();
    const film = item();
    film.metadata.Media[0].Part[0].Stream = [{ id: 1278355, streamType: 1 }, { id: 9, streamType: 2, languageCode: 'deu' }];
    await plex.loadMediaUrl(film, { tracks: { audioStreamId: '9' } });
    expect(httpClient.put).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('plex.loadMediaUrl.tracks-restore-skipped', expect.objectContaining({ ratingKey: '665638', partId: 729273 }));
  });
});
