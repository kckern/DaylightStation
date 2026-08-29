import { Readable } from 'node:stream';
import express from 'express';
import request from 'supertest';
import { vi } from 'vitest';
import { createLocalRouter } from '#api/v1/routers/local.mjs';
import { createStreamRouter } from '#api/v1/routers/stream.mjs';

function opaqueResource(content = '0123456789', mimeType = 'audio/mpeg') {
  const bytes = Buffer.from(content);
  const open = vi.fn((range) => {
    const start = range?.start ?? 0;
    const end = range?.end ?? bytes.length - 1;
    return Readable.from(bytes.subarray(start, end + 1));
  });
  return { size: bytes.length, mimeType, open };
}

function parseBinary(response, callback) {
  const chunks = [];
  response.on('data', (chunk) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
}

function localHarness({ mediaResult, thumbnailResult } = {}) {
  const getLocalMediaResource = {
    execute: vi.fn().mockResolvedValue(mediaResult || {
      kind: 'found',
      resource: opaqueResource(),
    }),
  };
  const getLocalMediaThumbnail = {
    execute: vi.fn().mockResolvedValue(thumbnailResult || {
      kind: 'found',
      resource: opaqueResource('image', 'image/jpeg'),
    }),
  };
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const app = express();
  app.use('/local', createLocalRouter({
    localMediaAdapter: null,
    getLocalMediaResource,
    getLocalMediaThumbnail,
    logger,
  }));
  return { app, getLocalMediaResource, getLocalMediaThumbnail, logger };
}

describe('local media router characterization', () => {
  test('streams a complete opaque resource with the legacy response headers', async () => {
    const resource = opaqueResource();
    const harness = localHarness({ mediaResult: { kind: 'found', resource } });

    const response = await request(harness.app)
      .get('/local/stream/audio/song.mp3')
      .buffer(true)
      .parse(parseBinary);

    expect(response.status).toBe(200);
    expect(response.headers).toMatchObject({
      'accept-ranges': 'bytes',
      'cache-control': 'public, max-age=31536000',
      'content-length': '10',
      'content-type': 'audio/mpeg',
      'x-content-type-options': 'nosniff',
      'access-control-allow-origin': '*',
    });
    expect(response.body.toString()).toBe('0123456789');
    expect(resource.open).toHaveBeenCalledWith();
    expect(harness.getLocalMediaResource.execute).toHaveBeenCalledWith('audio/song.mp3');
  });

  test('preserves byte-range status, headers, and inclusive open range', async () => {
    const resource = opaqueResource();
    const harness = localHarness({ mediaResult: { kind: 'found', resource } });

    const response = await request(harness.app)
      .get('/local/stream/audio/song.mp3')
      .set('Range', 'bytes=2-5')
      .buffer(true)
      .parse(parseBinary);

    expect(response.status).toBe(206);
    expect(response.headers['content-range']).toBe('bytes 2-5/10');
    expect(response.headers['content-length']).toBe('4');
    expect(response.body.toString()).toBe('2345');
    expect(resource.open).toHaveBeenCalledWith({ start: 2, end: 5 });
  });

  test.each([
    ['forbidden', 403, 'Path traversal not allowed'],
    ['not_found', 404, 'File not found'],
    ['not_file', 400, 'Path is not a file'],
  ])('maps %s lookup results to the existing envelope', async (kind, status, error) => {
    const harness = localHarness({ mediaResult: { kind } });
    const response = await request(harness.app).get('/local/stream/missing.mp3');
    expect(response.status).toBe(status);
    expect(response.body).toEqual({ error });
  });

  test('preserves the missing-path envelope', async () => {
    const harness = localHarness();
    const response = await request(harness.app).get('/local/stream/');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'No path specified' });
    expect(harness.getLocalMediaResource.execute).not.toHaveBeenCalled();
  });

  test('serves thumbnail resources without exposing a storage path', async () => {
    const resource = opaqueResource('jpeg', 'image/jpeg');
    const harness = localHarness({ thumbnailResult: { kind: 'found', resource } });
    const response = await request(harness.app)
      .get('/local/thumbnail/video/movie.mp4')
      .buffer(true)
      .parse(parseBinary);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('image/jpeg');
    expect(response.headers['cache-control']).toBe('public, max-age=31536000');
    expect(response.body.toString()).toBe('jpeg');
    expect(resource.open).toHaveBeenCalledWith();
  });

  test.each([
    ['generation_failed', 404, 'Thumbnail generation failed'],
    ['unsupported', 400, 'Unsupported media type for thumbnail'],
    ['not_found', 404, 'File not found'],
    ['forbidden', 403, 'Path traversal not allowed'],
  ])('maps thumbnail %s to the existing envelope', async (kind, status, error) => {
    const harness = localHarness({ thumbnailResult: { kind } });
    const response = await request(harness.app).get('/local/thumbnail/item.bin');
    expect(response.status).toBe(status);
    expect(response.body).toEqual({ error });
  });
});

function streamHarness(result = { kind: 'found', resource: opaqueResource() }) {
  const getContentMediaResource = { execute: vi.fn().mockResolvedValue(result) };
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const app = express();
  app.use('/stream', createStreamRouter({ getContentMediaResource, logger }));
  return { app, getContentMediaResource, logger };
}

describe('authored content stream router characterization', () => {
  test.each([
    ['/stream/singalong/hymn/2', { type: 'singalong', collection: 'hymn', id: '2' }],
    ['/stream/readalong/scripture/nt/nirv/26046', {
      type: 'readalong', collection: 'scripture', itemPath: 'nt/nirv/26046',
    }],
    ['/stream/ambient/rain', { type: 'ambient', id: 'rain' }],
  ])('streams %s through the application operation', async (url, expectedRequest) => {
    const harness = streamHarness();
    const response = await request(harness.app)
      .get(url)
      .buffer(true)
      .parse(parseBinary);

    expect(response.status).toBe(200);
    expect(response.body.toString()).toBe('0123456789');
    expect(harness.getContentMediaResource.execute).toHaveBeenCalledWith(expectedRequest);
  });

  test('preserves range behavior for authored content', async () => {
    const resource = opaqueResource();
    const harness = streamHarness({ kind: 'found', resource });
    const response = await request(harness.app)
      .get('/stream/singalong/primary/10')
      .set('Range', 'bytes=4-')
      .buffer(true)
      .parse(parseBinary);

    expect(response.status).toBe(206);
    expect(response.headers['content-range']).toBe('bytes 4-9/10');
    expect(response.body.toString()).toBe('456789');
    expect(resource.open).toHaveBeenCalledWith({ start: 4, end: 9 });
  });

  test.each([
    ['/stream/singalong/hymn/404', { error: 'Media file not found', collection: 'hymn', id: '404' }],
    ['/stream/readalong/scripture/bom/404', {
      error: 'Media file not found', collection: 'scripture', itemPath: 'bom/404',
    }],
    ['/stream/ambient/404', { error: 'Ambient track not found', id: '404' }],
  ])('preserves the not-found envelope for %s', async (url, envelope) => {
    const harness = streamHarness({ kind: 'not_found' });
    const response = await request(harness.app).get(url);
    expect(response.status).toBe(404);
    expect(response.body).toEqual(envelope);
  });

  test('preserves readalong missing-path and traversal envelopes', async () => {
    const missing = streamHarness({ kind: 'invalid_path' });
    const missingResponse = await request(missing.app).get('/stream/readalong/scripture/');
    expect(missingResponse.status).toBe(400);
    expect(missingResponse.body).toEqual({ error: 'No item path specified' });

    const forbidden = streamHarness({ kind: 'forbidden' });
    const forbiddenResponse = await request(forbidden.app).get('/stream/readalong/scripture/escape');
    expect(forbiddenResponse.status).toBe(403);
    expect(forbiddenResponse.body).toEqual({ error: 'Path traversal not allowed' });
  });
});
