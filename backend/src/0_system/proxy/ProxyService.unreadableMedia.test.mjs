import { afterEach, describe, expect, it } from 'vitest';
import http from 'http';
import express from 'express';
import { ProxyService } from './ProxyService.mjs';
import { PlexProxyAdapter } from '#adapters/proxy/PlexProxyAdapter.mjs';

/**
 * 2026-09-28: the NAS zeroed modes on Fitness files in a transient burst, and
 * Plex answered each direct-play request with 404 ("Permission denied (13)").
 * The proxy now retries those briefly, and when the refusal persists it
 * answers 503 `source-unreadable` so the Player waits instead of giving up.
 */

const PART = '/library/parts/762015/1788293067/file.mp4';

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}
function close(server) {
  return new Promise((resolve) => (server ? server.close(resolve) : resolve()));
}
function get(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}

class FastPlexProxyAdapter extends PlexProxyAdapter {
  getRetryConfig() { return { maxRetries: 20, delayMs: 1 }; }
}

describe('ProxyService — Plex media file refusals', () => {
  let upstream;
  let proxyApp;

  afterEach(async () => {
    await close(proxyApp);
    await close(upstream);
    proxyApp = null;
    upstream = null;
  });

  async function start(refusals, listeners = []) {
    const hits = [];
    upstream = await listen(http.createServer((req, res) => {
      const path = req.url.split('?')[0];
      hits.push(path);
      const partHits = hits.filter((p) => p === path).length;
      if (path === PART && partHits > refusals) {
        res.writeHead(206, { 'content-type': 'video/mp4' });
        res.end('video-bytes');
        return;
      }
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<html><h1>404 Not Found</h1></html>');
    }));
    const service = new ProxyService({ logger: { debug() {}, warn() {}, error() {}, info() {} } });
    service.register(new FastPlexProxyAdapter({ host: `http://127.0.0.1:${upstream.address().port}`, token: 't' }));
    listeners.forEach((l) => service.onErrorReplaced(l));
    const app = express();
    app.use('/api/v1/proxy/plex', service.createMiddleware('plex'));
    proxyApp = await listen(http.createServer(app));
    return { port: proxyApp.address().port, hits };
  }

  it('rides out a brief refusal with retries', async () => {
    const { port, hits } = await start(2);
    const res = await get(port, `/api/v1/proxy/plex${PART}`);
    expect(res.status).toBe(206);
    expect(res.body).toBe('video-bytes');
    expect(hits.filter((p) => p === PART)).toHaveLength(3);
  });

  it('answers 503 source-unreadable when the refusal persists', async () => {
    const { port, hits } = await start(Infinity);
    const res = await get(port, `/api/v1/proxy/plex${PART}?offset=114`);
    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('5');
    expect(JSON.parse(res.body)).toEqual({ error: 'Media file temporarily unreadable', reason: 'source-unreadable' });
    expect(hits.filter((p) => p === PART)).toHaveLength(4); // first try + 3 retries
  });

  it('tells error-replaced listeners which part was refused (server-side heal trigger)', async () => {
    const events = [];
    const { port } = await start(Infinity, [
      (e) => events.push(e),
      () => { throw new Error('listener bug'); },
    ]);
    const res = await get(port, `/api/v1/proxy/plex${PART}?offset=114`);
    expect(res.status).toBe(503); // a throwing listener never touches the response
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ service: 'plex', statusCode: 404, reason: 'source-unreadable' });
    expect(events[0].path).toContain('/library/parts/762015/');
  });

  it('leaves every other 404 alone', async () => {
    const { port, hits } = await start(Infinity);
    const res = await get(port, '/api/v1/proxy/plex/library/metadata/1/children');
    expect(res.status).toBe(404);
    expect(hits).toHaveLength(1);
  });
});

describe('ProxyService — an abandoned stream is cancelled upstream', () => {
  let upstream;
  let proxyApp;

  afterEach(async () => {
    await close(proxyApp);
    await close(upstream);
  });

  it('closes the upstream connection when the client disconnects mid-body', async () => {
    let upstreamClosed = null;
    let timer;
    upstream = await listen(http.createServer((req, res) => {
      res.writeHead(206, { 'content-type': 'video/mp4' });
      // A long body that trickles: the client will leave long before it ends.
      timer = setInterval(() => res.write(Buffer.alloc(1024)), 5);
      req.socket.on('close', () => { upstreamClosed = Date.now(); clearInterval(timer); });
    }));
    const service = new ProxyService({ logger: { debug() {}, warn() {}, error() {}, info() {} } });
    service.register(new FastPlexProxyAdapter({ host: `http://127.0.0.1:${upstream.address().port}`, token: 't' }));
    const app = express();
    app.use('/api/v1/proxy/plex', service.createMiddleware('plex'));
    proxyApp = await listen(http.createServer(app));

    const leftAt = await new Promise((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port: proxyApp.address().port, path: `/api/v1/proxy/plex${PART}` }, (res) => {
        res.once('data', () => { req.destroy(); resolve(Date.now()); });
      });
      req.on('error', () => {});
      setTimeout(() => reject(new Error('no data')), 2000);
    });

    await new Promise((r) => setTimeout(r, 300));
    clearInterval(timer);
    expect(upstreamClosed).not.toBeNull();
    expect(upstreamClosed - leftAt).toBeLessThan(300);
  });
});
