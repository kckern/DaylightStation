import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import http from 'http';
import express from 'express';
import { ProxyService } from './ProxyService.mjs';

/**
 * A 404 from an image proxy is not always the end of the road: some upstreams
 * advertise an asset at one path and actually serve it at another (a Plex
 * playlist whose thumb field is set but whose image file is gone still has its
 * auto-composite). An adapter that can name the alternate path gets one retry.
 */

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
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString(),
        contentType: res.headers['content-type'],
      }));
    }).on('error', reject);
  });
}

/** Minimal adapter over a live upstream; `fallback` opts into the retry. */
function testAdapter(upstreamPort, { fallback = null } = {}) {
  return {
    getServiceName: () => 'upstream',
    getBaseUrl: () => `http://127.0.0.1:${upstreamPort}`,
    isConfigured: () => true,
    getRetryConfig: () => ({ maxRetries: 0, delayMs: 0 }),
    shouldRetry: () => false,
    ...(fallback ? { getFallbackPath: fallback } : {}),
  };
}

describe('ProxyService upstream fallback path', () => {
  let upstream;
  let proxyApp;
  let requested;

  beforeEach(async () => {
    requested = [];
    upstream = await listen(http.createServer((req, res) => {
      requested.push(req.url.split('?')[0]);
      if (req.url.startsWith('/present')) {
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end('the-real-poster');
        return;
      }
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<html>Not Found</html>');
    }));
  });

  afterEach(async () => {
    await close(proxyApp);
    await close(upstream);
    proxyApp = null;
  });

  async function mount(adapter) {
    const service = new ProxyService({ logger: { debug() {}, warn() {}, error() {} } });
    service.register(adapter);
    const app = express();
    app.use('/proxy', service.createMiddleware('upstream'));
    proxyApp = await listen(http.createServer(app));
    return proxyApp.address().port;
  }

  it('serves the fallback asset when the requested one is missing', async () => {
    const port = await mount(testAdapter(upstream.address().port, {
      fallback: (path, status) => (status === 404 && path.startsWith('/missing') ? '/present' : null),
    }));

    const res = await get(port, '/proxy/missing');

    expect(res.status).toBe(200);
    expect(res.body).toBe('the-real-poster');
    expect(requested).toEqual(['/missing', '/present']);
  });

  it('forwards the 404 when the adapter names no fallback', async () => {
    const port = await mount(testAdapter(upstream.address().port));

    const res = await get(port, '/proxy/missing');

    expect(res.status).toBe(404);
    expect(requested).toEqual(['/missing']);
  });

  it('forwards the 404 when the fallback is also missing — it does not loop', async () => {
    const port = await mount(testAdapter(upstream.address().port, {
      fallback: (path, status) => (status === 404 ? '/still-missing' : null),
    }));

    const res = await get(port, '/proxy/missing');

    expect(res.status).toBe(404);
    expect(requested).toEqual(['/missing', '/still-missing']);
  });

  it('never asks for a fallback on a success', async () => {
    const port = await mount(testAdapter(upstream.address().port, {
      fallback: () => '/present',
    }));

    const res = await get(port, '/proxy/present');

    expect(res.status).toBe(200);
    expect(requested).toEqual(['/present']);
  });
});
