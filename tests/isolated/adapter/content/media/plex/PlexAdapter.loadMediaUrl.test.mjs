import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlexAdapter } from '#adapters/content/media/plex/PlexAdapter.mjs';
import { PlayableItem } from '#domains/content/capabilities/Playable.mjs';

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeAdapter() {
  const adapter = new PlexAdapter(
    { host: 'plex.local', token: 't', logger: makeLogger() },
    { httpClient: { request: vi.fn() } },
  );
  adapter.client = { getMetadata: vi.fn() };
  return adapter;
}

function makeAudioPlayable({ ratingKey = '42', mediaKey = '/library/parts/1/file.mp3' } = {}) {
  return new PlayableItem({
    id: `plex:${ratingKey}`,
    source: 'plex',
    localId: ratingKey,
    title: 'Test Track',
    mediaType: 'audio',
    mediaUrl: `/api/v1/proxy/plex/stream/${ratingKey}`,
    duration: 200,
    resumable: false,
    metadata: {
      type: 'track',
      Media: mediaKey === null ? [{ Part: [{}] }] : [{ Part: [{ key: mediaKey }] }],
    },
  });
}

function makeVideoPlayable({ ratingKey = '1', type = 'movie' } = {}) {
  return new PlayableItem({
    id: `plex:${ratingKey}`,
    source: 'plex',
    localId: ratingKey,
    title: 'Test Movie',
    mediaType: 'dash_video',
    mediaUrl: `/api/v1/proxy/plex/stream/${ratingKey}`,
    duration: 5400,
    resumable: true,
    metadata: { type, Media: [{ Part: [{ key: '/parts/1.mkv' }] }] },
  });
}

function makeContainerListable({ ratingKey = '487146', type = 'show' } = {}) {
  return new PlayableItem({
    id: `plex:${ratingKey}`,
    source: 'plex',
    localId: ratingKey,
    title: 'Test Show',
    mediaType: 'dash_video',
    mediaUrl: '',
    duration: null,
    resumable: false,
    metadata: { type },
  });
}

describe('PlexAdapter.loadMediaUrl — entity contract', () => {
  let adapter;

  beforeEach(() => {
    adapter = makeAdapter();
  });

  it('returns reason="metadata-missing" when given null/undefined entity', async () => {
    const result = await adapter.loadMediaUrl(null);
    expect(result).toEqual({ url: null, reason: 'metadata-missing' });
  });

  it('returns reason="non-playable-type" for shows/seasons/albums', async () => {
    const result = await adapter.loadMediaUrl(makeContainerListable({ type: 'show' }));
    expect(result).toEqual({ url: null, reason: 'non-playable-type' });
  });

  it('returns reason="audio-key-missing" when audio entity lacks Media.Part.key', async () => {
    const result = await adapter.loadMediaUrl(makeAudioPlayable({ mediaKey: null }));
    expect(result).toEqual({ url: null, reason: 'audio-key-missing' });
  });

  it('returns a stream URL for a valid audio entity (no Plex API roundtrip)', async () => {
    const result = await adapter.loadMediaUrl(makeAudioPlayable());
    expect(adapter.client.getMetadata).not.toHaveBeenCalled();
    expect(result.url).toContain('/library/parts/1/file.mp3');
    expect(result.reason).toBeUndefined();
  });

  it('returns reason="transient" when transcode decision throws', async () => {
    vi.spyOn(adapter, 'requestTranscodeDecision').mockRejectedValue(new Error('ECONNRESET'));
    const result = await adapter.loadMediaUrl(makeVideoPlayable());
    expect(result).toEqual({ url: null, reason: 'transient' });
  });

  it('returns { url } for a valid video entity', async () => {
    vi.spyOn(adapter, 'requestTranscodeDecision').mockResolvedValue({
      success: false,
      sessionIdentifier: 's',
      clientIdentifier: 'c',
    });
    vi.spyOn(adapter, '_buildTranscodeUrl').mockReturnValue('https://plex/transcode');

    const result = await adapter.loadMediaUrl(makeVideoPlayable());
    expect(result.url).toBe('https://plex/transcode');
    expect(result.reason).toBeUndefined();
  });
});

function makeH264OpusPlayable({ ratingKey = '675677' } = {}) {
  // h264 video + opus audio: copy-capable, but not original-file playable.
  // DASH must re-encode for a correct MPD timeline; non-DASH may still copy.
  return new PlayableItem({
    id: `plex:${ratingKey}`,
    source: 'plex',
    localId: ratingKey,
    title: 'Mario Kart Arcade GP',
    mediaType: 'dash_video',
    mediaUrl: `/api/v1/proxy/plex/stream/${ratingKey}`,
    duration: 5478,
    resumable: true,
    metadata: {
      type: 'episode',
      Media: [{
        videoCodec: 'h264', audioCodec: 'opus', container: 'mp4',
        Part: [{ key: '/parts/1.mp4', container: 'mp4' }],
      }],
    },
  });
}

describe('PlexAdapter — non-DASH direct-stream caps gating', () => {
  let adapter;
  beforeEach(() => { adapter = makeAdapter(); adapter.protocol = 'hls'; });

  it('passes allowDirectStream=true (not directPlay) for an h264+opus source', async () => {
    const spy = vi.spyOn(adapter, 'requestTranscodeDecision').mockResolvedValue({
      success: true, sessionIdentifier: 's', clientIdentifier: 'c',
      decision: { canDirectPlay: false, directStreamPath: null },
    });
    vi.spyOn(adapter, '_buildTranscodeUrl').mockReturnValue('https://plex/copy');

    await adapter.loadMediaUrl(makeH264OpusPlayable());

    const opts = spy.mock.calls[0][1];
    expect(opts.allowDirectPlay).toBe(false); // opus audio fails directPlay
    expect(opts.allowDirectStream).toBe(true); // h264 video is copyable
  });

  it('_buildTranscodeUrl OMITS the frame-rate limitation and bitrate/res caps when allowDirectStream', () => {
    const url = adapter._buildTranscodeUrl('675677', 'c', 's', null, null, 0, true);
    expect(url).not.toContain('video.frameRate');
    expect(url).not.toContain('maxVideoBitrate');
    expect(url).not.toContain('maxVideoResolution');
  });

  it('_buildTranscodeUrl KEEPS the caps when not direct-streamable (re-encode path)', () => {
    const url = adapter._buildTranscodeUrl('1', 'c', 's', null, null, 0, false);
    expect(url).toContain('video.frameRate');
    expect(url).toContain('maxVideoBitrate');
    expect(url).toContain('maxVideoResolution');
  });
});

describe('PlexAdapter — seek-correct DASH policy', () => {
  it.each(['transcode', 'decision-failed'])('forces re-encoding at decision and start for %s', async (outcome) => {
    const adapter = makeAdapter();
    adapter.client.request = outcome === 'decision-failed'
      ? vi.fn().mockRejectedValue(new Error('decision unavailable'))
      : vi.fn().mockResolvedValue({ MediaContainer: { generalDecisionCode: '1001', transcodeDecisionCode: '1001' } });
    const { url } = await adapter.loadMediaUrl(makeH264OpusPlayable());
    const decision = new URL(adapter.client.request.mock.calls[0][0], 'http://plex.test').searchParams;
    const start = new URL(url, 'http://app.test').searchParams;
    for (const params of [decision, start]) {
      expect(params.get('directPlay')).toBe('0');
      expect(params.get('directStream')).toBe('0');
      expect(params.get('maxVideoBitrate')).toBe('8000');
      expect(params.get('maxVideoResolution')).toBe('1080');
      expect(params.get('X-Plex-Client-Profile-Extra')).toContain('video.frameRate&value=30');
    }
    expect(start.get('X-Plex-Client-Identifier')).toBe(decision.get('X-Plex-Client-Identifier'));
    expect(start.get('X-Plex-Session-Identifier')).toBe(decision.get('X-Plex-Session-Identifier'));
  });

  it.each([true, false])('preserves eligible MP4 direct play, but not a copied DASH fallback (direct=%s)', async (direct) => {
    const adapter = makeAdapter();
    const item = makeH264OpusPlayable();
    item.metadata.Media[0].audioCodec = 'aac';
    adapter.client.request = vi.fn().mockResolvedValue({ MediaContainer: {
      generalDecisionCode: direct ? '2000' : '1001',
      Video: { Media: { container: 'mp4', Part: { key: '/library/parts/1/file.mp4' } } },
    } });
    const { url } = await adapter.loadMediaUrl(item);
    const decision = new URL(adapter.client.request.mock.calls[0][0], 'http://plex.test').searchParams;
    expect(decision.get('directPlay')).toBe('1');
    expect(decision.get('directStream')).toBe('0');
    expect(decision.get('maxVideoBitrate')).toBeNull();
    expect(decision.get('X-Plex-Client-Profile-Extra')).not.toContain('video.frameRate');
    if (direct) {
      expect(url).toContain('/library/parts/1/file.mp4?');
      expect(url).not.toContain('start.mpd');
    } else {
      const start = new URL(url, 'http://app.test').searchParams;
      expect(start.get('directPlay')).toBe('0');
      expect(start.get('directStream')).toBe('0');
    }
  });
});

describe('PlexAdapter.getMediaUrl — id-only convenience', () => {
  let adapter;

  beforeEach(() => {
    adapter = makeAdapter();
  });

  it('returns reason="metadata-missing" when Plex has no metadata for the rating key', async () => {
    adapter.client.getMetadata.mockResolvedValue({ MediaContainer: { Metadata: [] } });
    const result = await adapter.getMediaUrl('999999');
    expect(result).toEqual({ url: null, reason: 'metadata-missing' });
  });

  it('returns reason="non-playable-type" for shows/seasons/albums fetched by id', async () => {
    adapter.client.getMetadata.mockResolvedValue({
      MediaContainer: { Metadata: [{ ratingKey: '487146', type: 'show' }] },
    });
    const result = await adapter.getMediaUrl('487146');
    expect(result).toEqual({ url: null, reason: 'non-playable-type' });
  });

  it('returns reason="transient" when getMetadata throws', async () => {
    adapter.client.getMetadata.mockRejectedValue(new Error('ECONNRESET'));
    const result = await adapter.getMediaUrl('1');
    expect(result).toEqual({ url: null, reason: 'transient' });
  });

  it('returns reason="audio-key-missing" when audio Media.Part.key is absent', async () => {
    adapter.client.getMetadata.mockResolvedValue({
      MediaContainer: { Metadata: [{
        ratingKey: '42', type: 'track',
        Media: [{ Part: [{}] }],
      }] },
    });
    const result = await adapter.getMediaUrl('42');
    expect(result).toEqual({ url: null, reason: 'audio-key-missing' });
  });

  it('returns { url } on success', async () => {
    adapter.client.getMetadata.mockResolvedValue({
      MediaContainer: { Metadata: [{
        ratingKey: '1', type: 'movie',
        Media: [{ Part: [{ key: '/parts/1.mkv' }] }],
      }] },
    });
    vi.spyOn(adapter, 'requestTranscodeDecision').mockResolvedValue({
      success: false,
      sessionIdentifier: 's',
      clientIdentifier: 'c',
    });
    vi.spyOn(adapter, '_buildTranscodeUrl').mockReturnValue('https://plex/transcode');

    const result = await adapter.getMediaUrl('1');
    expect(result.url).toBe('https://plex/transcode');
    expect(result.reason).toBeUndefined();
  });

  it('strips a leading "plex:" prefix', async () => {
    adapter.client.getMetadata.mockResolvedValue({ MediaContainer: { Metadata: [] } });
    await adapter.getMediaUrl('plex:42');
    expect(adapter.client.getMetadata).toHaveBeenCalledWith('42');
  });
});
