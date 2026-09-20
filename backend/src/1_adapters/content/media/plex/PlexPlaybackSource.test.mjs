import { describe, expect, it, vi } from 'vitest';
import { PlexPlaybackSource } from './PlexPlaybackSource.mjs';

// Captured Plex response shape, sanitized: MediaContainer metadata and the
// universal-decision envelope are the structures PlexAdapter already consumes.
const metadata = {
  MediaContainer: { Metadata: [{
    ratingKey: '42', updatedAt: 1234, type: 'movie',
    Media: [{ id: '7', container: 'mkv', videoCodec: 'hevc', videoProfile: 'main',
      width: 1920, height: 1080, videoFrameRate: 24, audioCodec: 'eac3', audioChannels: 6,
      Part: [{ key: '/library/parts/7/file.mkv', Stream: [
        { id: '1', streamType: 1, codec: 'hevc', bitDepth: 10, profile: 'main', width: 1920, height: 1080, frameRate: 24 },
        { id: '2', streamType: 2, codec: 'eac3', channels: 6, audioChannelLayout: '5.1', language: 'English' },
        { id: '3', streamType: 3, codec: 'srt', language: 'English' },
      ] }],
    }],
  }] },
};
const transcodeDecision = {
  MediaContainer: {
    generalDecisionCode: 2000, generalDecisionText: 'Direct play not available',
    transcodeDecisionCode: 1000, transcodeDecisionText: 'Transcode video',
    Video: [{ Media: [{ container: 'mp4', Part: [{ key: '/video/:/transcode/universal/start.mpd' }] }] }],
  },
};
const tracks = { audioId: '2', subtitleId: '3', subtitlesRequired: false };

function provider(decision = transcodeDecision) {
  return { metadata: vi.fn(async () => metadata), decide: vi.fn(async () => decision) };
}

describe('PlexPlaybackSource', () => {
  it('uses an injected existing Plex client with the captured raw decision envelope', async () => {
    const client = { getMetadata: vi.fn(async () => metadata), request: vi.fn(async () => transcodeDecision) };
    const source = new PlexPlaybackSource({ provider: { client, proxyPath: '/api/v1/proxy/plex', protocol: 'dash', platform: 'Chrome', token: 'secret' } });
    await expect(source.describe({ contentId: 'plex:42', client: {}, tracks })).resolves.toMatchObject({
      kind: 'available', candidates: [expect.objectContaining({ conversion: 'transcode' })],
    });
    expect(client.request.mock.calls[0][0]).toContain('/video/:/transcode/universal/decision?');
  });

  it('describes metadata without starting a conversion and records an expected video encode as transcode', async () => {
    const fake = provider();
    const source = new PlexPlaybackSource({ provider: fake, proxyPath: '/api/v1/proxy/plex' });

    await expect(source.describe({ contentId: 'plex:42', client: {}, tracks })).resolves.toMatchObject({
      kind: 'available', candidates: expect.arrayContaining([expect.objectContaining({ conversion: 'transcode' })]),
    });
    expect(fake.metadata).toHaveBeenCalledTimes(1);
    expect(fake.decide).toHaveBeenCalledTimes(1);
    expect(fake.start).toBeUndefined();
  });

  it('refuses opening when the described source revision is stale', async () => {
    const fake = provider();
    const source = new PlexPlaybackSource({ provider: fake, proxyPath: '/api/v1/proxy/plex' });

    await expect(source.open({ contentId: 'plex:42', renditionId: 'plex:42:original', sourceRevision: 'stale', attemptId: 'a', generation: 0, positionMs: 0, tracks, client: {} }))
      .resolves.toMatchObject({ kind: 'failed', reason: 'source-revision-mismatch' });
    expect(fake.decide).not.toHaveBeenCalled();
  });

  it('returns the provider actual decision rather than the requested original mode', async () => {
    const fake = provider();
    const source = new PlexPlaybackSource({ provider: fake, proxyPath: '/api/v1/proxy/plex' });
    const description = await source.describe({ contentId: 'plex:42', client: {}, tracks });

    await expect(source.open({ contentId: 'plex:42', renditionId: 'plex:42:original', sourceRevision: description.sourceRevision, attemptId: 'a', generation: 0, positionMs: 1_500, tracks, client: {} }))
      .resolves.toMatchObject({ kind: 'opened', conversion: 'transcode', actualRendition: expect.objectContaining({ conversion: 'transcode' }) });
  });

  it('opens normally with one ordinary provider negotiation, not a describe pass', async () => {
    const fake = provider();
    const source = new PlexPlaybackSource({ provider: fake, proxyPath: '/api/v1/proxy/plex' });
    await source.openDefault({ contentId: 'plex:42', attemptId: 'a', generation: 0, positionMs: 0, tracks, client: {} });
    expect(fake.decide).toHaveBeenCalledTimes(1);
    expect(fake.decide).toHaveBeenCalledWith(expect.objectContaining({ start: true }));
  });
});
