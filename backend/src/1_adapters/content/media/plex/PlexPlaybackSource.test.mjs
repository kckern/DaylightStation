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
      kind: 'available', candidates: [expect.objectContaining({ conversion: 'video' })],
    });
    expect(client.request.mock.calls[0][0]).toContain('/video/:/transcode/universal/decision?');
  });

  it('describes through only metadata and universal-decision inspection, never a transcode start URL', async () => {
    const client = { getMetadata: vi.fn(async () => metadata), request: vi.fn(async () => transcodeDecision) };
    const source = new PlexPlaybackSource({ provider: { client }, proxyPath: '/api/v1/proxy/plex' });

    await expect(source.describe({ contentId: 'plex:42', client: {}, tracks })).resolves.toMatchObject({
      kind: 'available', candidates: expect.arrayContaining([expect.objectContaining({ conversion: 'video' })]),
    });
    expect(client.getMetadata).toHaveBeenCalledTimes(1);
    expect(client.request.mock.calls.map(([path]) => path)).toEqual([expect.stringContaining('/video/:/transcode/universal/decision?')]);
    expect(client.request.mock.calls.map(([path]) => path).join()).not.toContain('/start.mpd');
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
      .resolves.toMatchObject({ kind: 'opened', conversion: 'video', actualRendition: expect.objectContaining({ conversion: 'video' }) });
  });

  it('opens normally with one ordinary provider negotiation, not a describe pass', async () => {
    const fake = provider();
    const source = new PlexPlaybackSource({ provider: fake, proxyPath: '/api/v1/proxy/plex' });
    await source.openDefault({ contentId: 'plex:42', attemptId: 'a', generation: 0, positionMs: 0, tracks, client: {} });
    expect(fake.decide).toHaveBeenCalledTimes(1);
    expect(fake.decide).toHaveBeenCalledWith(expect.objectContaining({ start: true }));
  });

  it('normalizes the actual decision-selected tracks rather than requested original tracks', async () => {
    const decision = structuredClone(transcodeDecision);
    decision.MediaContainer.Video[0].Media[0].videoDecision = 'copy';
    decision.MediaContainer.Video[0].Media[0].audioDecision = 'transcode';
    decision.MediaContainer.Video[0].Media[0].Part[0].Stream = [
      { id: '11', streamType: 1, codec: 'h264', profile: 'high', bitDepth: 8, width: 1280, height: 720, frameRate: 24 },
      { id: '22', streamType: 2, codec: 'aac', channels: 2, audioChannelLayout: 'stereo', language: 'French', selected: true },
      { id: '33', streamType: 3, codec: 'webvtt', language: 'French', selected: true },
    ];
    const source = new PlexPlaybackSource({ provider: provider(decision), proxyPath: '/api/v1/proxy/plex' });
    const description = await source.describe({ contentId: 'plex:42', client: {}, tracks });
    const result = await source.open({ contentId: 'plex:42', renditionId: 'plex:42:original', sourceRevision: description.sourceRevision, attemptId: 'actual', generation: 0, positionMs: 0, tracks, client: {} });
    expect(result).toMatchObject({ conversion: 'audio', actualRendition: {
      video: expect.objectContaining({ codec: 'h264', width: 1280 }), audio: expect.objectContaining({ codec: 'aac', language: 'French' }),
      trackSelection: { audioId: '22', subtitleId: '33', subtitlesRequired: false },
    } });
  });

  it('serializes concurrent direct opens for one attempt', async () => {
    let release;
    const blocked = new Promise(resolve => { release = resolve; });
    const fake = { metadata: vi.fn(async () => { await blocked; return metadata; }), decide: vi.fn(async () => transcodeDecision) };
    const source = new PlexPlaybackSource({ provider: fake });
    const request = { contentId: 'plex:42', attemptId: 'same', generation: 0, positionMs: 0, tracks, client: {} };
    const first = source.openDefault(request);
    const second = source.openDefault(request);
    release();
    await first;
    await expect(second).resolves.toMatchObject({ kind: 'failed', reason: 'attempt-already-open' });
    expect(fake.metadata).toHaveBeenCalledTimes(1);
  });
});
