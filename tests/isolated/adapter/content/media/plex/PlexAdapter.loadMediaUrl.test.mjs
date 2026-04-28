import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlexAdapter } from '#adapters/content/media/plex/PlexAdapter.mjs';

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('PlexAdapter.loadMediaUrl — failure shape', () => {
  let adapter;
  let client;

  beforeEach(() => {
    client = { getMetadata: vi.fn() };
    adapter = new PlexAdapter(
      { host: 'plex.local', token: 't', logger: makeLogger() },
      { httpClient: { request: vi.fn() } },
    );
    // Inject the mocked client (PlexAdapter constructs its own; override the field)
    adapter.client = client;
  });

  it('returns reason="metadata-missing" when Plex has no metadata for the rating key', async () => {
    client.getMetadata.mockResolvedValue({ MediaContainer: { Metadata: [] } });
    const result = await adapter.loadMediaUrl('999999', 0, {});
    expect(result).toEqual({ url: null, reason: 'metadata-missing' });
  });

  it('returns reason="non-playable-type" for shows/seasons/albums', async () => {
    client.getMetadata.mockResolvedValue({
      MediaContainer: { Metadata: [{ ratingKey: '487146', type: 'show' }] },
    });
    const result = await adapter.loadMediaUrl('487146', 0, {});
    expect(result).toEqual({ url: null, reason: 'non-playable-type' });
  });

  it('returns reason="transient" when getMetadata throws', async () => {
    client.getMetadata.mockRejectedValue(new Error('ECONNRESET'));
    const result = await adapter.loadMediaUrl('1', 0, {});
    expect(result).toEqual({ url: null, reason: 'transient' });
  });

  it('returns { url } on success with no reason field', async () => {
    client.getMetadata.mockResolvedValue({
      MediaContainer: { Metadata: [{
        ratingKey: '1', type: 'movie',
        Media: [{ Part: [{ key: '/parts/1.mkv' }] }],
      }] },
    });
    // Stub the decision API path to a deterministic transcode URL
    vi.spyOn(adapter, 'requestTranscodeDecision').mockResolvedValue({
      success: false,
      sessionIdentifier: 's',
      clientIdentifier: 'c',
    });
    vi.spyOn(adapter, '_buildTranscodeUrl').mockReturnValue('https://plex/transcode');

    const result = await adapter.loadMediaUrl('1', 0, {});
    expect(result.url).toBe('https://plex/transcode');
    expect(result.reason).toBeUndefined();
  });
});
