// @vitest-environment node
import express from 'express';
import { describe, expect, it } from 'vitest';
import request from '../../../../tests/_lib/memory-http/request.mjs';
import { createPlayRouter } from './play.mjs';
import { createProxyRouter } from '../../../../__backend/src/4_api/v1/routers/proxy.mjs';
import { PlaybackReadService } from '../application/services/PlaybackReadService.mjs';
import { PlayResponseService } from '../application/services/PlayResponseService.mjs';
import { RegistryContentCatalogGateway } from '../../../content-catalog/server/adapters/RegistryContentCatalogGateway.mjs';
import { PlexAdapter } from '../../../content-catalog/server/adapters/providers/plex/PlexAdapter.mjs';
import { RegistryPlaybackStreamGateway } from '../../../../__backend/src/1_adapters/proxy/RegistryPlaybackStreamGateway.mjs';
import { MintPlaybackStream } from '../../../content-catalog/server/application/proxy/MintPlaybackStream.mjs';

const logger = { debug() {}, info() {}, warn() {}, error() {}, sampled() {} };
const metadata = {
  ratingKey: '42', type: 'movie', title: 'Quality fixture', duration: 5_895_000,
  Media: [{ width: 1920, height: 1080, bitrate: 6000, videoCodec: 'h264', audioCodec: 'aac', container: 'mp4',
    Part: [{ id: '7', key: '/library/parts/7/file.mp4', container: 'mp4', Stream: [
      { streamType: 1, codec: 'h264', width: 1920, height: 1080, bitDepth: 8 },
      { streamType: 2, codec: 'aac', channels: 2 },
    ] }],
  }],
};

function setup() {
  const decisions = [];
  const adapter = new PlexAdapter({ host: 'plex.test', token: 'test-secret', protocol: 'hls', logger }, { httpClient: { request() {} } });
  // Only the external Plex boundary is faked. Requests flow through the real
  // routes, DTO, stream gateway, adapter negotiation and URL construction.
  adapter.client = {
    getMetadata: async () => ({ MediaContainer: { Metadata: [metadata] } }),
    request: async path => {
      decisions.push(new URL(path, 'http://plex.test').searchParams);
      return { MediaContainer: { generalDecisionCode: '2000', transcodeDecisionCode: '1000', Video: [{ Media: [{ Part: [{ key: '/library/parts/7/file.mp4' }] }] }] } };
    },
  };
  const registry = new Map([['plex', adapter]]);
  const contentCatalog = new RegistryContentCatalogGateway({ registry });
  const playResponseService = new PlayResponseService({ mediaProgressMemory: { findProgress: () => null }, logger });
  const playbackReadService = new PlaybackReadService({ contentCatalog, playResponseService,
    contentIdResolver: { resolve: id => ({ source: 'plex', localId: String(id).split(':').pop() }) }, logger });
  const app = express();
  app.use('/api/v1/play', createPlayRouter({ playbackReadService, logger }));
  app.use('/api/v1/proxy', createProxyRouter({ mintPlaybackStream: new MintPlaybackStream({ gateway: new RegistryPlaybackStreamGateway({ registry, logger }) }), logger }));
  app.use((error, _req, res, _next) => res.status(error.status ?? 500).json({ code: error.code, error: error.message }));
  return { app, decisions };
}

describe('explicit quality reaches the actual Plex URL', () => {
  it.each(['/plex:42', '/plex/42'])('preserves caps and force through %s and stream mint', async path => {
    const { app, decisions } = setup();
    const response = await request(app).get(`/api/v1/play${path}?maxResolution=720&maxVideoBitrate=4000&transcode=force&adaptive=false&session=viewer-one`).expect(200);
    const media = new URL(response.body.mediaUrl, 'http://app.test');
    expect(Object.fromEntries(['maxResolution', 'maxVideoBitrate', 'transcode', 'adaptive'].map(k => [k, media.searchParams.get(k)])))
      .toEqual({ maxResolution: '720', maxVideoBitrate: '4000', transcode: 'force', adaptive: 'false' });
    const minted = await request(app).get(media.pathname + media.search).expect(302);
    const actual = new URL(minted.headers.location, 'http://app.test');
    for (const params of [actual.searchParams, decisions.at(-1)]) {
      expect(params.get('maxVideoResolution')).toBe('720');
      expect(params.get('videoResolution')).toBe('1280x720');
      expect(params.get('maxVideoBitrate')).toBe('4000');
      expect(params.get('directPlay')).toBe('0');
      expect(params.get('directStream')).toBe('0');
      expect(params.get('autoAdjustQuality')).toBe('0');
    }
    expect(actual.pathname).toContain('/start.m3u8');
    expect(actual.searchParams.get('secondsPerSegment')).toBe('3');
    expect(actual.searchParams.get('mediaBufferSize')).toBe('102400');
  });

  it('enforces a resolution ceiling on a copyable source without requiring force', async () => {
    const { app } = setup();
    const result = await request(app).get('/api/v1/proxy/plex/stream/42?maxResolution=480').expect(302);
    const params = new URL(result.headers.location, 'http://app.test').searchParams;
    expect(params.get('maxVideoResolution')).toBe('480');
    expect(params.get('directStream')).toBe('0');
  });

  it.each(['maxResolution=potato', 'maxVideoBitrate=4000oops', 'transcode=yes', 'adaptive=nope'])('rejects malformed quality before negotiation: %s', async query => {
    const { app, decisions } = setup();
    await request(app).get(`/api/v1/play/plex:42?${query}`).expect(400);
    await request(app).get(`/api/v1/proxy/plex/stream/42?${query}`).expect(400);
    expect(decisions).toHaveLength(0);
  });
});
