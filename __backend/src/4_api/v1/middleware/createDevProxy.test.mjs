import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi } from 'vitest';
import { createDevProxy } from './createDevProxy.mjs';

function build(forwarder) {
  const proxy = createDevProxy({ forwarder, logger: { info: vi.fn() } });
  const app = express();
  app.use(express.json());
  app.use('/dev', proxy.router);
  app.use('/api/v1/example', proxy.middleware, (_req, res) => res.json({ local: true }));
  return { app, proxy };
}

describe('createDevProxy HTTP contract', () => {
  it('preserves status response and toggle envelopes', async () => {
    const { app } = build({ getTargetHost: () => 'dev.local:3112', forward: vi.fn() });

    await request(app).get('/dev/proxy_status').expect(200, {
      proxyEnabled: false,
      targetHost: 'dev.local:3112',
      configured: true,
    });
    await request(app).post('/dev/proxy_toggle').expect(200, {
      proxyEnabled: true,
      targetHost: 'dev.local:3112',
      message: 'Dev proxy ENABLED - forwarding to http://dev.local:3112',
    });
  });

  it('preserves forwarded JSON status, content type, and request projection', async () => {
    const forward = vi.fn().mockResolvedValue({
      status: 202,
      contentType: 'application/json; charset=utf-8',
      body: { accepted: true },
      json: true,
    });
    const { app } = build({ getTargetHost: () => 'dev.local:3112', forward });
    await request(app).post('/dev/proxy_toggle').expect(200);
    const response = await request(app)
      .post('/api/v1/example?x=1')
      .set('x-telegram-bot-api-secret-token', 'secret')
      .send({ value: 1 })
      .expect(202, { accepted: true });

    expect(response.headers['content-type']).toContain('application/json');
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      originalUrl: '/api/v1/example?x=1',
      secretToken: 'secret',
      body: { value: 1 },
    }));
  });

  it('preserves missing-host and transport-error envelopes', async () => {
    const missing = build({ getTargetHost: () => null, forward: vi.fn() });
    await request(missing.app).post('/dev/proxy_toggle').expect(200);
    await request(missing.app).get('/api/v1/example').expect(500, {
      error: 'LOCAL_DEV_HOST not configured',
    });

    const error = Object.assign(new Error('connection refused'), {
      code: 'DEV_PROXY_FAILED',
      targetUrl: 'http://dev.local:3112/api/v1/example',
    });
    const failed = build({
      getTargetHost: () => 'dev.local:3112',
      forward: vi.fn().mockRejectedValue(error),
    });
    await request(failed.app).post('/dev/proxy_toggle').expect(200);
    await request(failed.app).get('/api/v1/example').expect(502, {
      error: 'Dev proxy error',
      message: 'connection refused',
      targetUrl: 'http://dev.local:3112/api/v1/example',
    });
  });
});
