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
