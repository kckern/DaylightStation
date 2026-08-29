import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Readable } from 'node:stream';
import { createProxyRouter } from '#backend/src/4_api/v1/routers/proxy.mjs';
import { RemoteThumbnailService } from '#apps/proxy/RemoteThumbnailService.mjs';

const logger = { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn(), sampled: vi.fn() };

function resource(body, mimeType = 'image/jpeg') {
  const buffer = Buffer.from(body);
  return { size: buffer.length, mimeType, open: () => Readable.from(buffer) };
}

function harness(overrides = {}) {
  const proxyMediaService = {
    getContentMedia: vi.fn(async () => ({ kind: 'not_found' })),
    getLocalContentMedia: vi.fn(async () => ({ kind: 'not_found' })),
    getMediaTreeResource: vi.fn(async () => ({ kind: 'not_found' })),
  };
  const deps = {
    proxyMediaService,
    mintPlaybackStream: { execute: vi.fn(async () => ({ kind: 'unconfigured' })) },
    compositeHeroService: { get: vi.fn(async () => ({ kind: 'placeholder' })) },
    dynamicStreamService: { open: vi.fn(async () => ({ kind: 'fetch_failed' })) },
    logger,
    ...overrides,
  };
  const app = express();
  app.use('/proxy', createProxyRouter(deps));
  return { app, deps, proxyMediaService };
}

describe('proxy HTTP contract preservation', () => {
  it('preserves MusicXML success and extraction-failure contracts', async () => {
    const success = harness();
    success.proxyMediaService.getContentMedia.mockResolvedValue({ kind: 'document', body: '<score />' });
    const document = await request(success.app).get('/proxy/media/stream/song.mxl');
    expect(document.status).toBe(200);
    expect(document.text).toBe('<score />');
    expect(document.headers['content-type']).toBe('application/vnd.recordare.musicxml+xml; charset=utf-8');
    expect(document.headers['cache-control']).toBe('public, max-age=31536000');

    success.proxyMediaService.getContentMedia.mockResolvedValue({ kind: 'archive_error' });
    const failed = await request(success.app).get('/proxy/media/stream/broken.mxl');
    expect(failed.status).toBe(422);
    expect(failed.body).toEqual({ error: 'Could not decompress .mxl score' });
  });

  it('preserves local-content validation and missing-disk bodies', async () => {
    const h = harness();
    h.proxyMediaService.getLocalContentMedia
      .mockResolvedValueOnce({ kind: 'invalid_type' })
      .mockResolvedValueOnce({ kind: 'not_found' })
      .mockResolvedValueOnce({ kind: 'disk_missing', path: '/media/audio/missing.mp3' });

    expect((await request(h.app).get('/proxy/local-content/stream/nope/song')).body)
      .toEqual({ error: 'Unknown content type: nope' });
    expect((await request(h.app).get('/proxy/local-content/stream/hymn/song')).body)
      .toEqual({ error: 'Media file not found', type: 'hymn', path: 'song' });
    expect((await request(h.app).get('/proxy/local-content/stream/hymn/song')).body)
      .toEqual({ error: 'Media file not found on disk', path: '/media/audio/missing.mp3' });
  });

  it('preserves composite hero HIT, MISS, placeholder, and configuration responses', async () => {
    const compositeHeroService = { get: vi.fn() };
    const h = harness({ compositeHeroService });

    compositeHeroService.get.mockResolvedValueOnce({ kind: 'hit', resource: resource('cached') });
    const hit = await request(h.app).get('/proxy/komga/composite/book-1/2');
    expect(hit.status).toBe(200);
    expect(hit.headers['x-cache']).toBe('HIT');
    expect(hit.body.toString()).toBe('cached');

    compositeHeroService.get.mockResolvedValueOnce({ kind: 'miss', artifact: Buffer.from('fresh') });
    const miss = await request(h.app).get('/proxy/komga/composite/book-1/2');
    expect(miss.headers['x-cache']).toBe('MISS');
    expect(miss.headers['content-length']).toBe('5');

    compositeHeroService.get.mockResolvedValueOnce({ kind: 'unconfigured' });
    const unconfigured = await request(h.app).get('/proxy/komga/composite/book-1/2');
    expect(unconfigured.status).toBe(503);
    expect(unconfigured.body).toEqual({ error: 'Komga proxy not configured' });

    compositeHeroService.get.mockResolvedValueOnce({ kind: 'placeholder' });
    const placeholder = await request(h.app).get('/proxy/komga/composite/book-1/2');
    expect(placeholder.status).toBe(200);
    expect(placeholder.headers['content-type']).toMatch(/image\/svg\+xml/);
  });

  it('preserves remote-thumbnail HIT, MISS, validation, and no-store failure', async () => {
    const remoteThumbnailService = { get: vi.fn() };
    const h = harness({ remoteThumbnailService });
    remoteThumbnailService.get.mockResolvedValueOnce({ kind: 'hit', resource: resource('cached', 'image/png') });
    const hit = await request(h.app).get('/proxy/retroarch/thumbnail/NES/Mario.png');
    expect(hit.headers['x-cache']).toBe('HIT');
    expect(hit.headers['cache-control']).toBe('public, max-age=31536000, immutable');

    remoteThumbnailService.get.mockResolvedValueOnce({
      kind: 'miss', contentType: 'image/jpeg', artifact: Buffer.from('fresh'),
    });
    const miss = await request(h.app).get('/proxy/retroarch/thumbnail/NES/Mario.jpg');
    expect(miss.headers['x-cache']).toBe('MISS');
    expect(miss.headers['content-type']).toBe('image/jpeg');

    remoteThumbnailService.get.mockResolvedValueOnce({ kind: 'unavailable' });
    const failed = await request(h.app).get('/proxy/retroarch/thumbnail/NES/Mario.png');
    expect(failed.status).toBe(503);
    expect(failed.headers['cache-control']).toBe('no-store');
    expect(failed.body).toEqual({ error: 'Thumbnail upstream unavailable' });
  });

  it('preserves dynamic playlist and byte-stream headers and bodies', async () => {
    const dynamicStreamService = { open: vi.fn() };
    const h = harness({ dynamicStreamService });
    dynamicStreamService.open.mockResolvedValueOnce({ kind: 'playlist', body: '#EXTM3U\nsegment' });
    const playlist = await request(h.app).get('/proxy/stream?src=https://cdn.test/live.m3u8');
    expect(playlist.status).toBe(200);
    expect(playlist.headers['cache-control']).toBe('no-cache');
    expect(playlist.text).toBe('#EXTM3U\nsegment');

    const body = new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); },
    });
    dynamicStreamService.open.mockResolvedValueOnce({
      kind: 'stream', host: 'cdn.test', status: 206, contentType: 'video/mp4',
      acceptRanges: 'bytes', contentRange: 'bytes 0-2/3', contentLength: '3', body,
    });
    const stream = await request(h.app)
      .get('/proxy/stream?src=https://cdn.test/video.mp4')
      .set('Range', 'bytes=0-2');
    expect(stream.status).toBe(206);
    expect(stream.headers['content-range']).toBe('bytes 0-2/3');
    expect(stream.headers['content-length']).toBe('3');
  });

  it('keeps passthrough resizing HTTP-only and preserves missing-service responses', async () => {
    let forwardedUrl;
    const passthroughHandlers = {
      plex: async (req, res) => { forwardedUrl = req.url; res.status(204).end(); },
    };
    const h = harness({ passthroughHandlers });
    const resized = await request(h.app).get('/proxy/plex/library/metadata/1/thumb?w=320&h=180');
    expect(resized.status).toBe(204);
    expect(forwardedUrl).toBe('/photo/:/transcode?width=320&height=180&upscale=1&url=%2Flibrary%2Fmetadata%2F1%2Fthumb');

    const missing = await request(h.app).get('/proxy/immich/api/assets/1');
    expect(missing.status).toBe(503);
    expect(missing.body).toEqual({ error: 'Immich proxy not configured (ProxyService required)' });
  });
});

describe('RemoteThumbnailService retry workflow', () => {
  it('retries once after the configured delay and caches the successful response', async () => {
    const source = { fetchThumbnail: vi.fn() };
    source.fetchThumbnail
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ contentType: 'image/png', artifact: Buffer.from('ok') });
    const cache = {
      findThumbnail: vi.fn(async () => null),
      storeThumbnail: vi.fn(async () => {}),
    };
    const delay = vi.fn(async () => {});
    const service = new RemoteThumbnailService({ cache, source, delay, retryDelayMs: 17, logger });

    const result = await service.get('NES/Mario.png');

    expect(result.kind).toBe('miss');
    expect(source.fetchThumbnail).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledWith(17);
    expect(cache.storeThumbnail).toHaveBeenCalledWith('NES/Mario.png', Buffer.from('ok'));
  });
});
