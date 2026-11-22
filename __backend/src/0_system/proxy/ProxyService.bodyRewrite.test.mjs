import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import zlib from 'node:zlib';
import http, { request as memoryRequest } from '../../../../tests/_lib/memory-http/proxy-memory-transport.mjs';
import express from 'express';
import { ProxyService } from './ProxyService.mjs';

/**
 * An adapter can rewrite a body before it leaves (getBodyRewriter) and refuse
 * paths its credential should not reach (allowsPath). Plex live TV needs both:
 * its playlists carry the account token in clear text, and the same token
 * opens the whole account API on plex.tv.
 */

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}
function close(server) {
  return new Promise((resolve) => (server ? server.close(resolve) : resolve()));
}
function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}

const PLAYLIST = '#EXTM3U\nhttps://up/v.m3u8?token=SECRET\n';

describe('ProxyService body rewrite and path refusal', () => {
  let upstream;
  let proxyApp;
  let seen;

  beforeEach(async () => {
    seen = [];
    upstream = await listen(http.createServer((req, res) => {
      seen.push({ url: req.url, acceptEncoding: req.headers['accept-encoding'] ?? null });
      if (req.url.startsWith('/play.m3u8')) {
        // An upstream that compresses whenever it is allowed to.
        if (String(req.headers['accept-encoding'] || '').includes('gzip')) {
          const gz = zlib.gzipSync(PLAYLIST);
          res.writeHead(200, { 'content-type': 'application/x-mpegurl', 'content-encoding': 'gzip', 'content-length': gz.length, etag: '"e"' });
          res.end(gz);
          return;
        }
        res.writeHead(200, { 'content-type': 'application/x-mpegurl', 'content-length': Buffer.byteLength(PLAYLIST), etag: '"e"' });
        res.end(PLAYLIST);
        return;
      }
      res.writeHead(200, { 'content-type': 'video/mp2t' });
      res.end('raw-bytes');
    }));
  });

  afterEach(async () => {
    await close(proxyApp);
    await close(upstream);
    proxyApp = null;
  });

  async function mount(overrides = {}) {
    const port = upstream.address().port;
    const service = new ProxyService({ request: memoryRequest, logger: { debug() {}, info() {}, warn() {}, error() {} } });
    service.register({
      getServiceName: () => 'up',
      getBaseUrl: () => `http://127.0.0.1:${port}`,
      isConfigured: () => true,
      getRetryConfig: () => ({ maxRetries: 0, delayMs: 0 }),
      shouldRetry: () => false,
      getBodyRewriter: (path) => (path.startsWith('/play.m3u8') ? (text) => text.replace(/\?token=SECRET/g, '') : null),
      getResponseHeaders: (path) => (path.startsWith('/play.m3u8') ? { 'cache-control': 'no-store' } : null),
      allowsPath: (path) => !path.startsWith('/account'),
      ...overrides,
    });
    const app = express();
    app.use('/proxy', service.createMiddleware('up'));
    proxyApp = await listen(http.createServer(app));
    return proxyApp.address().port;
  }

  it('rewrites the body, asks for it uncompressed and recomputes the length', async () => {
    const port = await mount();
    const res = await get(port, '/proxy/play.m3u8', { 'accept-encoding': 'gzip, deflate' });
    expect(res.status).toBe(200);
    expect(res.body).toBe('#EXTM3U\nhttps://up/v.m3u8\n');
    expect(res.headers['content-length']).toBe(String(Buffer.byteLength(res.body)));
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.headers.etag).toBeUndefined();
    expect(res.headers['cache-control']).toBe('no-store');
    expect(seen[0].acceptEncoding).toBeNull();
  });

  it('streams paths without a rewriter unchanged, compression request intact', async () => {
    const port = await mount();
    const res = await get(port, '/proxy/seg.ts', { 'accept-encoding': 'gzip' });
    expect(res.body).toBe('raw-bytes');
    expect(seen[0].acceptEncoding).toBe('gzip');
  });

  it('answers 502 rather than the original bytes when the rewriter throws', async () => {
    const port = await mount({ getBodyRewriter: () => () => { throw new Error('boom'); } });
    const res = await get(port, '/proxy/play.m3u8');
    expect(res.status).toBe(502);
    expect(res.body).not.toContain('SECRET');
  });

  it('refuses a path the adapter does not allow without reaching the upstream', async () => {
    const port = await mount();
    const res = await get(port, '/proxy/account/users');
    expect(res.status).toBe(404);
    expect(seen).toHaveLength(0);
  });
});
