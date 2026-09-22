import express from 'express';
import http from 'node:http';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createProxyRouter } from '#backend/src/4_api/v1/routers/proxy.mjs';

function appFor(result) {
  const open = vi.fn(async () => result);
  const app = express();
  app.use('/proxy', createProxyRouter({ libbyStreamService: { open }, logger: { warn: vi.fn(), debug: vi.fn() } }));
  return { app, open };
}

describe('Libby proxy cover route', () => {
  function coverApp(open) {
    const app = express();
    app.use('/proxy', createProxyRouter({ libbyCoverService: open ? { open } : null, logger: { warn: vi.fn() } }));
    return app;
  }

  it('streams image bytes with private no-store and nosniff headers', async () => {
    const cleanup = vi.fn();
    const open = vi.fn(async () => ({ kind: 'opened', contentType: 'image/jpeg', contentLength: '5', body: new Response('image').body, cleanup }));
    const result = await request(coverApp(open)).get('/proxy/libby/cover/card/title');
    expect(result.status).toBe(200);
    expect(result.body).toEqual(Buffer.from('image'));
    expect(result.headers).toMatchObject({ 'content-type': 'image/jpeg', 'content-length': '5', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' });
    expect(open).toHaveBeenCalledWith({ cardId: 'card', titleId: 'title', signal: expect.any(AbortSignal) });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it.each([['gone', 410], ['credential_unavailable', 401], ['upstream_error', 502]])('maps %s to %s', async (kind, status) => {
    const result = await request(coverApp(async () => ({ kind, reason: 'private detail' }))).get('/proxy/libby/cover/card/title');
    expect(result.status).toBe(status);
    expect(JSON.stringify(result.body)).not.toContain('private detail');
  });

  it('returns 503 when cover service is unwired', async () => {
    expect((await request(coverApp()).get('/proxy/libby/cover/card/title')).status).toBe(503);
  });

  it.each(['backpressure', 'pending read', 'pending open'])('aborts and cancels on disconnect during %s', async (phase) => {
    const cleanup = vi.fn();
    const cancel = vi.fn();
    let signal;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const body = new ReadableStream({
      start(controller) { if (phase !== 'pending open') controller.enqueue(new Uint8Array(phase === 'backpressure' ? 1024 * 1024 : 1)); },
      pull(controller) { if (phase === 'backpressure') controller.enqueue(new Uint8Array(1024 * 1024)); },
      cancel,
    });
    const app = coverApp(async (input) => {
      signal = input.signal;
      if (phase === 'pending open') await gate;
      return { kind: 'opened', contentType: 'image/jpeg', body, cleanup };
    });
    const server = app.listen(0);
    try {
      await new Promise((resolve, reject) => {
        const req = http.get({ port: server.address().port, path: '/proxy/libby/cover/card/title' }, (response) => {
          response.once('data', () => response.destroy());
          response.once('close', resolve);
        });
        req.on('error', resolve);
        if (phase === 'pending open') {
          void vi.waitFor(() => expect(signal).toBeDefined()).then(() => req.destroy()).catch(reject);
        }
      });
      if (phase === 'pending open') {
        await vi.waitFor(() => expect(signal.aborted).toBe(true));
        release();
      }
      await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1));
      expect(signal.aborted).toBe(true);
      expect(cancel).toHaveBeenCalledTimes(1);
    } finally {
      release();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('Libby proxy stream route', () => {
  it('relays an opaque lease with private no-store range headers', async () => {
    const cleanup = vi.fn();
    const { app, open } = appFor({
      kind: 'opened', status: 206, contentType: 'audio/mpeg', contentLength: '1',
      contentRange: 'bytes 0-0/12', acceptRanges: 'bytes', cleanup,
      body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([65])); controller.close(); } }),
    });
    const response = await request(app).get('/proxy/libby/stream/opaque-handle').set('Range', 'bytes=0-0');
    expect(response.status).toBe(206);
    expect(response.headers).toMatchObject({
      'content-type': 'audio/mpeg', 'content-length': '1', 'content-range': 'bytes 0-0/12',
      'accept-ranges': 'bytes', 'cache-control': 'private, no-store',
    });
    expect(response.body).toEqual(Buffer.from('A'));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ handle: 'opaque-handle', method: 'GET', range: 'bytes=0-0' }));
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('maps lease, range, auth, and upstream failures without leaking details', async () => {
    for (const [result, status] of [
      [{ kind: 'gone', reason: 'expired' }, 410],
      [{ kind: 'invalid_range' }, 416],
      [{ kind: 'range_not_satisfiable', contentRange: 'bytes */12' }, 416],
      [{ kind: 'credential_unavailable' }, 401],
      [{ kind: 'upstream_error', reason: 'forbidden_origin' }, 502],
    ]) {
      const { app } = appFor(result);
      const response = await request(app).get('/proxy/libby/stream/not-a-secret');
      expect(response.status).toBe(status);
      expect(JSON.stringify(response.body)).not.toContain('not-a-secret');
    }
  });

  it('returns 503 when Libby is not configured', async () => {
    const app = express();
    app.use('/proxy', createProxyRouter({ logger: { warn: vi.fn(), debug: vi.fn() } }));
    expect((await request(app).get('/proxy/libby/stream/anything')).status).toBe(503);
  });

  it('cancels upstream and cleans up when a backpressured client disconnects', async () => {
    const cleanup = vi.fn();
    let cancelled = false;
    const body = new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
      cancel() { cancelled = true; },
    });
    const { app } = appFor({ kind: 'opened', status: 200, contentType: 'audio/mpeg', body, cleanup });
    const server = app.listen(0);
    try {
      await new Promise((resolve) => {
        const req = http.get({ port: server.address().port, path: '/proxy/libby/stream/opaque' }, (response) => {
          response.once('data', () => { response.pause(); response.destroy(); });
          response.once('close', resolve);
        });
        req.on('error', resolve);
      });
      await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1));
      expect(cancelled).toBe(true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
