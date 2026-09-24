// tests/integration/api/proxy.test.mjs
import express from 'express';
import request from 'supertest';
import { createProxyRouter } from '#backend/src/4_api/v1/routers/proxy.mjs';
import { FilesystemProxyMediaRepository } from '#adapters/proxy/FilesystemProxyMediaRepository.mjs';
import { RegistryPlaybackStreamGateway } from '#adapters/proxy/RegistryPlaybackStreamGateway.mjs';
import { ProxyMediaService } from '#apps/proxy/ProxyMediaService.mjs';
import { MintPlaybackStream } from '#apps/proxy/MintPlaybackStream.mjs';
import path from 'path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.resolve(__dirname, '../../../_fixtures/media');

describe('Proxy Router', () => {
  let app;

  beforeAll(() => {
    const files = {
      async getItem(relativePath) {
        if (!fs.existsSync(path.join(fixturesPath, relativePath))) return null;
        const mimeType = relativePath.endsWith('.mp4') ? 'video/mp4' : 'audio/mpeg';
        return { metadata: { filePath: path.join(fixturesPath, relativePath), mimeType } };
      },
    };
    const registry = { get: (name) => (name === 'files' ? files : null) };
    const repository = new FilesystemProxyMediaRepository({ registry, mediaBasePath: fixturesPath });
    const gateway = new RegistryPlaybackStreamGateway({ registry });

    app = express();
    app.use('/proxy', createProxyRouter({
      proxyMediaService: new ProxyMediaService({ repository }),
      mintPlaybackStream: new MintPlaybackStream({ gateway }),
    }));
  });

  test('GET /proxy/media/stream/* streams file', async () => {
    const res = await request(app)
      .get('/proxy/media/stream/audio/test.mp3');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('audio/mpeg');
  });

  test('GET /proxy/media/stream/* handles range requests', async () => {
    const res = await request(app)
      .get('/proxy/media/stream/audio/test.mp3')
      .set('Range', 'bytes=0-10');

    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toMatch(/^bytes 0-10\//);
  });

  test('GET /proxy/media/stream/* returns 404 for missing file', async () => {
    const res = await request(app)
      .get('/proxy/media/stream/nonexistent.mp3');

    expect(res.status).toBe(404);
  });

  test('GET /proxy/media/stream/* streams video file', async () => {
    const res = await request(app)
      .get('/proxy/media/stream/video/test.mp4');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('video/mp4');
  });

  test('GET /proxy/plex/stream/:ratingKey returns 404 when plex not configured', async () => {
    const res = await request(app)
      .get('/proxy/plex/stream/12345');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Plex adapter not configured');
  });
});

// Media-tree assets (fitness/ux/fireball.mp3 and friends) are replaced in place
// under the same name. They must revalidate, or a browser keeps the old bytes.
describe('Proxy Router — media tree revalidation', () => {
  let app;
  let mediaDir;
  let soundPath;

  beforeAll(() => {
    mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-media-tree-'));
    fs.mkdirSync(path.join(mediaDir, 'fitness/ux'), { recursive: true });
    soundPath = path.join(mediaDir, 'fitness/ux/fireball.mp3');
    fs.writeFileSync(soundPath, 'old explosion');
    fs.utimesSync(soundPath, new Date('2026-09-16T21:09:00Z'), new Date('2026-09-16T21:09:00Z'));

    const registry = { get: () => null };
    const repository = new FilesystemProxyMediaRepository({ registry, mediaBasePath: mediaDir });
    app = express();
    app.use('/proxy', createProxyRouter({
      proxyMediaService: new ProxyMediaService({ repository }),
      mintPlaybackStream: new MintPlaybackStream({ gateway: new RegistryPlaybackStreamGateway({ registry }) }),
    }));
  });

  afterAll(() => fs.rmSync(mediaDir, { recursive: true, force: true }));

  test('serves a revalidating cache policy with validators', async () => {
    const res = await request(app).get('/proxy/media/fitness/ux/fireball.mp3').expect(200);
    expect(res.headers['cache-control']).toBe('public, no-cache');
    expect(res.headers.etag).toMatch(/^W\/"[0-9a-f]+-[0-9a-f]+"$/);
    expect(res.headers['last-modified']).toBe('Wed, 16 Sep 2026 21:09:00 GMT');
  });

  test('answers a matching If-None-Match with an empty 304', async () => {
    const first = await request(app).get('/proxy/media/fitness/ux/fireball.mp3').expect(200);
    const again = await request(app)
      .get('/proxy/media/fitness/ux/fireball.mp3')
      .set('If-None-Match', first.headers.etag)
      .expect(304);
    expect(again.headers.etag).toBe(first.headers.etag);
    expect(again.text || '').toBe('');
  });

  test('answers If-Modified-Since at or after the mtime with 304', async () => {
    await request(app)
      .get('/proxy/media/fitness/ux/fireball.mp3')
      .set('If-Modified-Since', 'Wed, 16 Sep 2026 21:09:00 GMT')
      .expect(304);
  });

  test('a file replaced under the same name is re-sent, not 304', async () => {
    const before = await request(app).get('/proxy/media/fitness/ux/fireball.mp3').expect(200);
    fs.writeFileSync(soundPath, 'new fireball whoosh');
    fs.utimesSync(soundPath, new Date('2026-09-17T02:59:33Z'), new Date('2026-09-17T02:59:33Z'));

    const after = await request(app)
      .get('/proxy/media/fitness/ux/fireball.mp3')
      .set('If-None-Match', before.headers.etag)
      .set('If-Modified-Since', before.headers['last-modified'])
      .responseType('blob')
      .expect(200);
    expect(after.headers.etag).not.toBe(before.headers.etag);
    expect(Buffer.from(after.body).toString()).toBe('new fireball whoosh');
  });
});
