import { describe, expect, it, vi } from 'vitest';
import { PlexAdapter } from '#adapters/content/media/plex/PlexAdapter.mjs';
import { resolveFormat } from '#domains/content/utils/resolveFormat.mjs';
import { buildClientProfileExtra } from '#adapters/content/media/plex/transcodeProfile.mjs';
import { PlayResponseService } from '#apps/content/services/PlayResponseService.mjs';

function setup({ protocol, audio = 'opus', container = 'mp4', bitDepth = 8, channels = 2, partKey = '/library/parts/1/file.mp4', failDecision = false } = {}) {
  const item = { ratingKey: '675677', type: 'movie', title: 'Verified movie', duration: 500000,
    Media: [{ videoCodec: 'h264', audioCodec: audio, container,
      Part: [{ key: partKey, container, Stream: [
        { streamType: 1, codec: 'h264', bitDepth },
        { streamType: 2, codec: audio, channels },
      ] }] }] };
  const http = { get: vi.fn(async url => {
    if (url.includes('/decision?')) {
      if (failDecision) throw new Error('decision unavailable');
      return { status: 200, data: { MediaContainer: { generalDecisionCode: '1001' } } };
    }
    return { status: 200, data: { MediaContainer: { Metadata: [item] } } };
  }) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { adapter: new PlexAdapter({ host: 'http://plex.test', protocol, logger }, { httpClient: http }), http, item };
}

describe('Plex playable transport alignment', () => {
  it('defaults copy-compatible video to an HLS descriptor and matching decision/start profile', async () => {
    const { adapter, http } = setup();
    const item = await adapter.getItem('plex:675677');
    expect(item.mediaType).toBe('hls_video');
    expect(resolveFormat(item, adapter)).toBe('hls_video');
    expect(item.mediaUrl).toBe('/api/v1/proxy/plex/stream/675677');
    const result = await adapter.loadMediaUrl(item, { session: 'own-session', startOffset: 91 });
    const start = new URL(result.url, 'http://app.test');
    expect(start.pathname).toMatch(/start\.m3u8$/);
    const decision = new URL(http.get.mock.calls.find(([url]) => url.includes('/decision?'))[0]);
    for (const url of [decision, start]) {
      expect(url.searchParams.get('protocol')).toBe('hls');
      expect(url.searchParams.get('directPlay')).toBe('0');
      expect(url.searchParams.get('directStream')).toBe('1');
      expect(url.searchParams.get('offset')).toBeNull(); // HLS must establish the real segment-zero PTS anchor.
      expect(url.searchParams.get('maxVideoBitrate')).toBeNull();
      expect(url.searchParams.get('X-Plex-Client-Profile-Extra')).toContain('protocol=hls');
      expect(url.searchParams.get('X-Plex-Client-Profile-Extra')).not.toContain('video.frameRate');
    }
    expect(start.searchParams.get('X-Plex-Session-Identifier')).toBe(decision.searchParams.get('X-Plex-Session-Identifier'));
    const response = new PlayResponseService({ mediaProgressMemory: null }).toPlayResponse(item,
      { contentId: item.id, playhead: 91, duration: 500 }, { descriptor: { format: resolveFormat(item, adapter) } });
    expect(response.resume_position).toBe(91); // User resume is retained; only server-side offset optimization is suppressed.
  });

  it('keeps HLS and session alignment on decision failure', async () => {
    const { adapter } = setup({ failDecision: true });
    const item = await adapter.getItem('675677');
    const { url } = await adapter.loadMediaUrl(item, { session: 'own-session', startOffset: 91 });
    expect(url).toContain('start.m3u8?');
    expect(new URL(url, 'http://app.test').searchParams.get('directStream')).toBe('1');
  });

  it('never redirects an HLS descriptor to raw MP4 even if the decision claims direct play', async () => {
    const { adapter, http } = setup();
    const item = await adapter.getItem('675677');
    http.get.mockResolvedValueOnce({ status: 200, data: { MediaContainer: {
      generalDecisionCode: '2000', Video: { Media: { container: 'mp4', Part: { key: '/library/parts/1/file.mp4' } } },
    } } });
    const { url } = await adapter.loadMediaUrl(item, { startOffset: 91 });
    expect(url).toContain('start.m3u8?');
  });

  it('describes qualified original MP4 as native video with its original proxy URL', async () => {
    const { adapter, http } = setup({ audio: 'aac' });
    const item = await adapter.getItem('675677');
    expect(item.mediaType).toBe('video');
    expect(resolveFormat(item, adapter)).toBe('video');
    expect(item.mediaUrl).toBe('/api/v1/proxy/plex/library/parts/1/file.mp4');
    expect(http.get).toHaveBeenCalledTimes(1); // No unnecessary stream mint.
    expect(item.resumable).toBe(true);
    const response = new PlayResponseService({ mediaProgressMemory: null }).toPlayResponse(item,
      { contentId: item.id, playhead: 91, duration: 500 }, { descriptor: { format: resolveFormat(item, adapter) } });
    expect(response).toMatchObject({ mediaType: 'video', format: 'video', resume_position: 91 });
    expect(response.mediaUrl).toBe(item.mediaUrl); // Resume is native seeking, never a transcode offset on an original file.
  });

  it.each([{ bitDepth: 10 }, { channels: 6 }, { partKey: null }])('does not bypass HLS for an unsafe/incomplete direct MP4 descriptor: %j', async overrides => {
    const { adapter, http } = setup({ audio: 'aac', ...overrides });
    const item = await adapter.getItem('675677');
    expect(item.mediaType).toBe('hls_video');
    const { url } = await adapter.loadMediaUrl(item);
    expect(url).toContain('start.m3u8?');
    const decision = new URL(http.get.mock.calls.find(([url]) => url.includes('/decision?'))[0]);
    expect(decision.searchParams.get('directPlay')).toBe('0');
    if (overrides.channels === 6) expect(decision.searchParams.get('X-Plex-Client-Profile-Extra')).toContain('audio.channels&value=2');
    if (overrides.bitDepth === 10) expect(decision.searchParams.get('maxVideoBitrate')).toBe('8000');
  });

  it('preserves explicit DASH descriptor, extension and seek-correct transcode caps', async () => {
    const { adapter } = setup({ protocol: 'dash' });
    const item = await adapter.getItem('675677');
    expect(item.mediaType).toBe('dash_video');
    const { url } = await adapter.loadMediaUrl(item, { startOffset: 91 });
    expect(url).toContain('start.mpd?');
    expect(new URL(url, 'http://app.test').searchParams.get('directStream')).toBe('0');
    expect(new URL(url, 'http://app.test').searchParams.get('offset')).toBe('91');
  });

  it('keeps the profile helper backward compatible and opts into HLS explicitly', () => {
    expect(buildClientProfileExtra()).toContain('protocol=dash');
    expect(buildClientProfileExtra({ protocol: 'hls', downmixAudio: true })).toContain('protocol=hls');
  });
});
