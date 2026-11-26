// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import { createClientLogRouter, MAX_EVENTS, MAX_BYTES } from './clientLog.mjs';
import { createApiRouter } from './api.mjs';
import { ingestFrontendLogs, __resetIngestRateLimiter } from '#adapters/logging/FrontendLogIngestion.mjs';
import { initializeLogging, resetLogging } from '#system/logging/dispatcher.mjs';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

async function serve(router, fn) {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use('/api/v1', createApiRouter({
    safeConfig: {}, routers: { clientLog: router }, plexProxyHandler: (_q, r) => r.status(501).end(), logger: quiet,
  }));
  const server = app.listen(0);
  try {
    const { port } = server.address();
    return await fn((body, headers = {}) => fetch(`http://127.0.0.1:${port}/api/v1/client-log`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }));
  } finally {
    server.close();
  }
}

const tap = (control = 'np.play') => ({ event: 'ui.tap', level: 'info', ts: '2026-11-26T08:00:00.000-07:00',
  data: { control, screen: 'now-playing' }, context: { app: 'phone', component: 'now-playing', deviceId: 'phone' } });

describe('POST /api/v1/client-log', () => {
  it('stamps the source and the device header, keeps the client context, and counts what it drops', async () => {
    const calls = [];
    const router = createClientLogRouter({ ingest: (payload, meta) => calls.push({ payload, meta }), logger: quiet });
    await serve(router, async (post) => {
      const res = await post({ source: 'android', events: [tap(), null, { event: 7 }, 'x', tap('np.next')] },
        { 'X-Daylight-Device': 'fleet:phone', 'User-Agent': 'daylight-test' });
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ accepted: 2, dropped: 3 });
    });
    expect(calls).toHaveLength(1);
    const [first] = calls[0].payload.events;
    expect(first.context).toMatchObject({ source: 'android', app: 'phone', component: 'now-playing', deviceId: 'phone', device: 'fleet:phone' });
    expect(first.data.control).toBe('np.play');
    expect(calls[0].meta.userAgent).toBe('daylight-test');
  });

  it('defaults the source to android and refuses a source that is not a slug', async () => {
    const calls = [];
    const router = createClientLogRouter({ ingest: (p) => calls.push(p), logger: quiet });
    await serve(router, async (post) => {
      await post({ events: [tap()] });
      await post({ source: 'Bad Source!', events: [{ ...tap(), context: { source: 'frontend' } }] });
    });
    expect(calls[0].events[0].context.source).toBe('android');
    expect(calls[1].events[0].context.source).toBe('android');
  });

  it('answers 400 for a body that is not {events:[...]} and 413 above the limits', async () => {
    const router = createClientLogRouter({ ingest: () => {}, logger: quiet });
    await serve(router, async (post) => {
      expect((await post({ event: 'ui.tap' })).status).toBe(400);
      expect((await post([tap()])).status).toBe(400);
      expect((await post({ events: Array.from({ length: MAX_EVENTS + 1 }, () => tap()) })).status).toBe(413);
      const big = { events: [{ ...tap(), data: { pad: 'x'.repeat(MAX_BYTES) } }] };
      expect((await post(big)).status).toBe(413);
      expect((await post({ events: [] })).status).toBe(202);
    });
  });

  it('requires an ingest function', () => {
    expect(() => createClientLogRouter({})).toThrow(/ingest/);
  });
});

describe('client-log through the real ingestion', () => {
  let sent;
  beforeEach(() => {
    sent = [];
    __resetIngestRateLimiter();
    initializeLogging({ defaultLevel: 'debug' }).addTransport({ name: 'capture', send: (e) => sent.push(e) });
  });
  afterEach(() => resetLogging());

  it('lands in the dispatcher as source android with the client fields intact', async () => {
    const router = createClientLogRouter({ ingest: ingestFrontendLogs, logger: quiet });
    await serve(router, async (post) => {
      const res = await post({ source: 'android', events: [tap('np.lyrics')] }, { 'X-Daylight-Device': 'fleet:phone' });
      expect(res.status).toBe(202);
    });
    const stored = sent.find((e) => e.event === 'ui.tap');
    expect(stored).toBeTruthy();
    expect(stored.context).toMatchObject({ source: 'android', app: 'phone', component: 'now-playing', device: 'fleet:phone' });
    expect(stored.data).toMatchObject({ control: 'np.lyrics', screen: 'now-playing' });
  });
});
