import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import { createMediaSourceRouter } from './mediaSource.mjs';

async function post(healer, body) {
  const app = express();
  app.use(express.json());
  app.use('/', createMediaSourceRouter({ mediaSourceHealer: healer, logger: {} }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  try {
    return await new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const req = http.request({
        host: '127.0.0.1', port: server.address().port, path: '/check', method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
      }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve(JSON.parse(data)));
      });
      req.on('error', reject);
      req.end(payload);
    });
  } finally { server.close(); }
}

describe('POST /media-source/check', () => {
  it('forwards a proxy-observed refusal as origin: proxy, and nothing else', async () => {
    const healer = { check: vi.fn(async () => ({ state: 'readable', steps: [] })) };
    await post(healer, { contentId: 'plex:1', deviceId: 'tv', origin: 'proxy' });
    expect(healer.check).toHaveBeenLastCalledWith('plex:1', { deviceId: 'tv', origin: 'proxy' });
    await post(healer, { contentId: 'plex:1', origin: 'anything-else' });
    expect(healer.check).toHaveBeenLastCalledWith('plex:1', { deviceId: null, origin: null });
  });

  it('caps proxy-origin claims globally (10/min); past the cap the check runs without the claim', async () => {
    const healer = { check: vi.fn(async () => ({ state: 'readable', steps: [] })) };
    const app = express();
    app.use(express.json());
    let now = 0;
    app.use('/', createMediaSourceRouter({ mediaSourceHealer: healer, logger: {}, clock: () => now }));
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const send = (body) => new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/check', method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } },
      (res) => { res.resume(); res.on('end', resolve); });
      req.on('error', reject); req.end(payload);
    });
    try {
      for (let i = 0; i < 12; i += 1) await send({ contentId: `plex:${i}`, origin: 'proxy' });
      const origins = healer.check.mock.calls.map(([, ctx]) => ctx.origin);
      expect(origins.filter((o) => o === 'proxy')).toHaveLength(10);
      expect(origins.slice(10)).toEqual([null, null]);
      now = 61_000;
      await send({ contentId: 'plex:99', origin: 'proxy' });
      expect(healer.check).toHaveBeenLastCalledWith('plex:99', { deviceId: null, origin: 'proxy' });
    } finally { server.close(); }
  });

  it('a stuck client re-claiming one item holds a single slot and cannot starve other items', async () => {
    const healer = { check: vi.fn(async () => ({ state: 'readable', steps: [] })) };
    const app = express();
    app.use(express.json());
    app.use('/', createMediaSourceRouter({ mediaSourceHealer: healer, logger: {}, clock: () => 0 }));
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const send = (body) => new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/check', method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } },
      (res) => { res.resume(); res.on('end', resolve); });
      req.on('error', reject); req.end(payload);
    });
    try {
      for (let i = 0; i < 30; i += 1) await send({ contentId: 'plex:stuck', origin: 'proxy' });
      await send({ contentId: 'plex:other', origin: 'proxy' });
      expect(healer.check).toHaveBeenLastCalledWith('plex:other', { deviceId: null, origin: 'proxy' });
    } finally { server.close(); }
  });

  it('returns the healer answer including a not-a-leaf reason', async () => {
    const healer = { check: vi.fn(async () => ({ state: 'unknown', reason: 'not-a-leaf', steps: [] })) };
    expect(await post(healer, { contentId: 'plex:59493' })).toMatchObject({ reason: 'not-a-leaf' });
  });
});
