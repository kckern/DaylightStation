// tests/integration/api/proxy.test.mjs
import express from 'express';
import request from 'supertest';
import { createProxyRouter } from '#backend/src/4_api/v1/routers/proxy.mjs';
import { FilesystemProxyMediaRepository } from '#adapters/proxy/FilesystemProxyMediaRepository.mjs';
import { RegistryPlaybackStreamGateway } from '#adapters/proxy/RegistryPlaybackStreamGateway.mjs';
import { ProxyMediaService } from "../../../../__capabilities/content-catalog/server/application/proxy/ProxyMediaService.mjs";
import { MintPlaybackStream } from "../../../../__capabilities/content-catalog/server/application/proxy/MintPlaybackStream.mjs";
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

// .mxl scores are ZIPs; the kiosk fetches them as text and hashes what it gets,
// so the stream route must hand back the root file's XML, not the archive.
describe('Proxy Router — compressed MusicXML', () => {
  let app;
  let mediaDir;
  const xml = '<?xml version="1.0" encoding="UTF-8"?><score-partwise><work><work-title>Für Élise</work-title></work></score-partwise>';

  beforeAll(async () => {
    const { default: AdmZip } = await import('adm-zip');
    mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-mxl-'));
    fs.mkdirSync(path.join(mediaDir, 'docs/sheet-music'), { recursive: true });
    const zip = new AdmZip();
    zip.addFile('META-INF/container.xml', Buffer.from(
      '<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>', 'utf8'));
    zip.addFile('score.xml', Buffer.from(xml, 'utf8'));
    fs.writeFileSync(path.join(mediaDir, 'docs/sheet-music/tiny.mxl'), zip.toBuffer());
    fs.writeFileSync(path.join(mediaDir, 'docs/sheet-music/broken.mxl'), 'not a zip');

    const files = {
      async getItem(relativePath) {
        const filePath = path.join(mediaDir, relativePath);
        return fs.existsSync(filePath) ? { metadata: { filePath, mimeType: 'application/vnd.recordare.musicxml' } } : null;
      },
    };
    const registry = { get: (name) => (name === 'files' ? files : null) };
    const repository = new FilesystemProxyMediaRepository({ registry, mediaBasePath: mediaDir, logger: { warn() {} } });
    app = express();
    app.use('/proxy', createProxyRouter({
      proxyMediaService: new ProxyMediaService({ repository }),
      mintPlaybackStream: new MintPlaybackStream({ gateway: new RegistryPlaybackStreamGateway({ registry }) }),
    }));
  });

  afterAll(() => fs.rmSync(mediaDir, { recursive: true, force: true }));

  test('streams an .mxl as its inner MusicXML text', async () => {
    const res = await request(app).get('/proxy/media/stream/docs/sheet-music/tiny.mxl').expect(200);
    expect(res.headers['content-type']).toMatch(/musicxml\+xml; charset=utf-8/);
    expect(res.text).toBe(xml);
  });

  test('answers an archive that will not open with 422', async () => {
    await request(app).get('/proxy/media/stream/docs/sheet-music/broken.mxl').expect(422);
  });
});

// A generated sheet music poster is an SVG on the media stream route. Opened
// directly it is a document, so it must arrive sandboxed; rasters need no CSP.
describe('Proxy Router — SVG posters are sandboxed', () => {
  let app;
  let mediaDir;
  const CSP = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:";

  beforeAll(async () => {
    const { FileAdapter } = await import('#adapters/content/media/files/FileAdapter.mjs');
    mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-svg-poster-'));
    fs.mkdirSync(path.join(mediaDir, 'docs/sheet-music'), { recursive: true });
    fs.writeFileSync(path.join(mediaDir, 'docs/sheet-music/piece.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    fs.writeFileSync(path.join(mediaDir, 'docs/sheet-music/scan.jpg'), 'jpeg bytes');
    const files = new FileAdapter({ mediaBasePath: mediaDir });
    const registry = { get: (name) => (name === 'files' ? files : null) };
    const repository = new FilesystemProxyMediaRepository({ registry, mediaBasePath: mediaDir, logger: { warn() {} } });
    app = express();
    app.use('/proxy', createProxyRouter({
      proxyMediaService: new ProxyMediaService({ repository }),
      mintPlaybackStream: new MintPlaybackStream({ gateway: new RegistryPlaybackStreamGateway({ registry }) }),
    }));
  });

  afterAll(() => fs.rmSync(mediaDir, { recursive: true, force: true }));

  test('an svg streams with the sandbox CSP and nosniff', async () => {
    const res = await request(app).get('/proxy/media/stream/docs/sheet-music/piece.svg').expect(200);
    expect(res.headers['content-type']).toMatch(/^image\/svg\+xml/);
    expect(res.headers['content-security-policy']).toBe(CSP);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  test('a ranged svg request is sandboxed too', async () => {
    const res = await request(app).get('/proxy/media/stream/docs/sheet-music/piece.svg').set('Range', 'bytes=0-3').expect(206);
    expect(res.headers['content-security-policy']).toBe(CSP);
  });

  test('a jpeg carries no CSP', async () => {
    const res = await request(app).get('/proxy/media/stream/docs/sheet-music/scan.jpg').expect(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['content-security-policy']).toBeUndefined();
  });
});
