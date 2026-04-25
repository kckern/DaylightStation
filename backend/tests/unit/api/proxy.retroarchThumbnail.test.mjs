// backend/tests/unit/api/proxy.retroarchThumbnail.test.mjs
//
// Disk cache + retry for /proxy/retroarch/thumbnail/*.
// Eliminates repeated X-plore round-trips and surfaces real failures (503) so
// the client can retry, instead of returning a placeholder SVG that masks them.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import { createProxyRouter } from '../../../src/4_api/v1/routers/proxy.mjs';

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // minimal IHDR
]);

let savedFetch;
let tmpDirs = [];

function freshTmpDir() {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'retroarch-cache-test-'));
  tmpDirs.push(dir);
  return dir;
}

function makeApp({ mediaBasePath, retroarchProxy, fetchImpl }) {
  global.fetch = fetchImpl;
  const app = express();
  const router = createProxyRouter({
    registry: { get: () => null },
    mediaBasePath,
    retroarchProxy,
    logger: { info() {}, error() {}, warn() {}, debug() {} },
  });
  app.use('/', router);
  return app;
}

async function getReq(app, path) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      http.get(`http://127.0.0.1:${port}${path}`, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          server.close();
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      });
    });
  });
}

before(() => { savedFetch = global.fetch; });
after(() => {
  global.fetch = savedFetch;
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

describe('GET /proxy/retroarch/thumbnail/* — disk cache + retry', () => {
  it('serves from disk cache when cache file exists (X-Cache: HIT, immutable)', async () => {
    const mediaBasePath = freshTmpDir();
    const cacheFile = nodePath.join(mediaBasePath, 'img', 'retroarch', 'thumbs', 'snes', 'mario.png');
    fs.mkdirSync(nodePath.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, PNG_BYTES);

    const fetchSpy = (...args) => { throw new Error('fetch should not be called on a disk hit'); };
    const app = makeApp({
      mediaBasePath,
      retroarchProxy: { baseUrl: 'http://shield', thumbnailsPath: '/thumbs' },
      fetchImpl: fetchSpy,
    });

    const res = await getReq(app, '/retroarch/thumbnail/snes/mario.png');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, PNG_BYTES);
    assert.strictEqual(res.headers['x-cache'], 'HIT');
    assert.match(res.headers['cache-control'] || '', /immutable/);
  });

  it('on disk miss, fetches X-plore, writes to disk, serves with X-Cache: MISS', async () => {
    const mediaBasePath = freshTmpDir();
    let fetchCalls = 0;
    const fetchImpl = async (url) => {
      fetchCalls += 1;
      assert.match(url, /shield\/thumbs\/snes\/zelda\.png/);
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'image/png' },
        arrayBuffer: async () => PNG_BYTES.buffer.slice(PNG_BYTES.byteOffset, PNG_BYTES.byteOffset + PNG_BYTES.byteLength),
      };
    };
    const app = makeApp({
      mediaBasePath,
      retroarchProxy: { baseUrl: 'http://shield', thumbnailsPath: '/thumbs', retryDelayMs: 0 },
      fetchImpl,
    });

    const res = await getReq(app, '/retroarch/thumbnail/snes/zelda.png');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, PNG_BYTES);
    assert.strictEqual(res.headers['x-cache'], 'MISS');
    assert.match(res.headers['cache-control'] || '', /immutable/);
    assert.strictEqual(fetchCalls, 1);

    const cacheFile = nodePath.join(mediaBasePath, 'img', 'retroarch', 'thumbs', 'snes', 'zelda.png');
    assert.ok(fs.existsSync(cacheFile), 'cache file should be written to disk');
    assert.deepStrictEqual(fs.readFileSync(cacheFile), PNG_BYTES);
  });

  it('retries X-plore once when first fetch fails, succeeds on second', async () => {
    const mediaBasePath = freshTmpDir();
    let fetchCalls = 0;
    const fetchImpl = async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) throw new Error('connection reset');
      return {
        ok: true, status: 200,
        headers: { get: () => 'image/png' },
        arrayBuffer: async () => PNG_BYTES.buffer.slice(PNG_BYTES.byteOffset, PNG_BYTES.byteOffset + PNG_BYTES.byteLength),
      };
    };
    const app = makeApp({
      mediaBasePath,
      retroarchProxy: { baseUrl: 'http://shield', thumbnailsPath: '/thumbs', retryDelayMs: 0 },
      fetchImpl,
    });

    const res = await getReq(app, '/retroarch/thumbnail/nes/contra.png');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(fetchCalls, 2);
  });

  it('returns 503 with Cache-Control: no-store when both fetches fail', async () => {
    const mediaBasePath = freshTmpDir();
    let fetchCalls = 0;
    const fetchImpl = async () => {
      fetchCalls += 1;
      throw new Error('xplore down');
    };
    const app = makeApp({
      mediaBasePath,
      retroarchProxy: { baseUrl: 'http://shield', thumbnailsPath: '/thumbs', retryDelayMs: 0 },
      fetchImpl,
    });

    const res = await getReq(app, '/retroarch/thumbnail/gba/metroid.png');
    assert.strictEqual(res.status, 503);
    assert.strictEqual(fetchCalls, 2);
    assert.match(res.headers['cache-control'] || '', /no-store/);
  });

  it('returns 503 with Cache-Control: no-store when X-plore returns non-OK on both attempts', async () => {
    const mediaBasePath = freshTmpDir();
    let fetchCalls = 0;
    const fetchImpl = async () => {
      fetchCalls += 1;
      return { ok: false, status: 502, headers: { get: () => 'text/html' }, arrayBuffer: async () => new ArrayBuffer(0) };
    };
    const app = makeApp({
      mediaBasePath,
      retroarchProxy: { baseUrl: 'http://shield', thumbnailsPath: '/thumbs', retryDelayMs: 0 },
      fetchImpl,
    });

    const res = await getReq(app, '/retroarch/thumbnail/snes/foo.png');
    assert.strictEqual(res.status, 503);
    assert.strictEqual(fetchCalls, 2);
    assert.match(res.headers['cache-control'] || '', /no-store/);
  });

  it('rejects path traversal with 403 (existing behavior preserved)', async () => {
    const app = makeApp({
      mediaBasePath: freshTmpDir(),
      retroarchProxy: { baseUrl: 'http://shield', thumbnailsPath: '/thumbs' },
      fetchImpl: () => { throw new Error('should not fetch'); },
    });
    const res = await getReq(app, '/retroarch/thumbnail/..%2Fetc%2Fpasswd');
    assert.strictEqual(res.status, 403);
  });

  it('returns 503 when retroarchProxy is not configured (existing behavior preserved)', async () => {
    const app = makeApp({
      mediaBasePath: freshTmpDir(),
      retroarchProxy: undefined,
      fetchImpl: () => { throw new Error('should not fetch'); },
    });
    const res = await getReq(app, '/retroarch/thumbnail/snes/foo.png');
    assert.strictEqual(res.status, 503);
  });
});
