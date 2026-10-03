import { describe, expect, it, vi } from 'vitest';
import { PlexAdapter } from './PlexAdapter.mjs';

/**
 * Subtitles and audio language (RQ-STEER-14). Plex ignores stream ids on the
 * transcode decision/start URLs; it plays the part's SELECTED streams. So a
 * mint that asks for tracks selects them on the part first (the call every
 * Plex client makes), then burns a chosen subtitle into the picture so every
 * engine and every screen shows it. A mint that asks for nothing is unchanged.
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
    expect(httpClient.put).toHaveBeenCalledTimes(1);
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

  it('turns subtitles off without burning anything', async () => {
    const { plex, httpClient } = setup();
    const result = await plex.loadMediaUrl(item(), { tracks: { subtitleStreamId: '0' } });
    expect(new URL(httpClient.put.mock.calls[0][0]).searchParams.get('subtitleStreamID')).toBe('0');
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
});
