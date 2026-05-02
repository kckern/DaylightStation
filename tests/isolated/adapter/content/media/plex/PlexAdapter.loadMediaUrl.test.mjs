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
