import { afterEach, describe, expect, it } from 'vitest';
import http, { request as memoryRequest } from '../../../../tests/_lib/memory-http/proxy-memory-transport.mjs';
import express from 'express';
import { ProxyService } from './ProxyService.mjs';
import { PlexProxyAdapter } from '#adapters/proxy/PlexProxyAdapter.mjs';

// 2026-10-28: nothing recorded how fast the proxy delivered a direct-play part,
// so "the tablet's link" could only be concluded by elimination.

const PART = '/library/parts/762015/1788293067/file.mp4';
const BIG = Buffer.alloc(5 * 1024 * 1024, 1);

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
const close = (server) => new Promise((resolve) => (server ? server.close(resolve) : resolve()));
const get = (port, path, headers = {}) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
    let n = 0;
    res.on('data', (c) => { n += c.length; });
    res.on('end', () => resolve({ status: res.statusCode, bytes: n }));
  }).on('error', reject);
});

describe('ProxyService — stream delivery telemetry', () => {
  let upstream; let proxyApp;
  afterEach(async () => { await close(proxyApp); await close(upstream); proxyApp = null; upstream = null; });

  async function start() {
    const rows = [];
    upstream = await listen(http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': req.url.includes('/library/parts/') ? 'video/mp4' : 'application/json' });
      res.end(req.url.includes('/library/parts/') ? BIG : '{}');
    }));
    const logger = { debug() {}, warn() {}, error() {}, info: (e, d) => rows.push([e, d]) };
    const service = new ProxyService({ request: memoryRequest, logger });
    service.register(new PlexProxyAdapter({ host: `http://127.0.0.1:${upstream.address().port}`, token: 't' }));
    const app = express();
    app.use('/api/v1/proxy/plex', service.createMiddleware('plex'));
    proxyApp = await listen(http.createServer(app));
    return { port: proxyApp.address().port, rows };
  }

  it('logs proxy.stream.transfer for a large direct-play part, with the client and rate', async () => {
    const { port, rows } = await start();
    const res = await get(port, `/api/v1/proxy/plex${PART}`, { 'x-real-ip': '192.0.2.7', range: 'bytes=0-' });
    expect(res.bytes).toBe(BIG.length);
    await new Promise((r) => setTimeout(r, 20));
    const row = rows.find(([e]) => e === 'proxy.stream.transfer')?.[1];
    expect(row).toEqual(expect.objectContaining({
      service: 'plex', part: '762015/1788293067/file.mp4', client: '192.0.2.7', range: 'bytes=0-',
      bytes: BIG.length, completed: true,
    }));
    expect(row.kbps).toEqual(expect.any(Number));
    expect(row.backpressurePct).toEqual(expect.any(Number));
  });

  it('does not meter non-media paths', async () => {
    const { port, rows } = await start();
    await get(port, '/api/v1/proxy/plex/library/metadata/1');
    await new Promise((r) => setTimeout(r, 20));
    expect(rows.filter(([e]) => e.startsWith('proxy.stream.'))).toEqual([]);
  });
});
