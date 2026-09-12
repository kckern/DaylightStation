// @vitest-environment node
//
// This drives a real Express listener, so it needs Node's fetch rather than the
// browser-like default environment, whose fetch enforces CORS against localhost.
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import { createPlaySessionsRouter } from './playSessions.mjs';

const quiet = { error() {}, warn() {}, info() {} };

/** Minimal request driver — avoids pulling a supertest dependency. */
async function call(router, method, path, body) {
  const app = express();
  app.use(express.json());
  app.use('/p', router);
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/p${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally { server.close(); }
}

let recorded;
const recordObservation = {
  execute: async (input) => {
    recorded.push(input);
    return { session: { id: 'ps_1', playedMs: 42_000 }, started: true, ended: null, switched: false };
  },
};
const sessions = {
  findOpenForDevice: async (d) => (d === 'tv'
    ? { toSnapshot: () => ({ id: 'ps_1', deviceId: 'tv', playedMs: 42_000 }) }
    : null),
};

beforeEach(() => { recorded = []; });

describe('POST /observations — push ingress for self-reporting surfaces', () => {
  it('feeds the same use case the polled source uses', async () => {
    const r = await call(createPlaySessionsRouter({ recordObservation, logger: quiet }), 'POST', '/observations', {
      deviceId: 'fitness-console', surface: 'browser-emulator', userId: 'test-learner',
      observation: { state: 'playing', observedAt: '2026-09-11T20:00:00.000Z', content: { contentId: 'g:1' } },
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ sessionId: 'ps_1', started: true, playedMs: 42_000 });
    expect(recorded[0].surface).toBe('browser-emulator');
  });

  it('defaults a self-reported observation to exact confidence', async () => {
    await call(createPlaySessionsRouter({ recordObservation, logger: quiet }), 'POST', '/observations', {
      deviceId: 'd', surface: 'browser-emulator', observation: { state: 'playing' } },
    );
    expect(recorded[0].observation.confidenceMs).toBe(0);
  });

  it('rejects an observation missing its essentials', async () => {
    const r = await call(createPlaySessionsRouter({ recordObservation, logger: quiet }), 'POST', '/observations', { deviceId: 'd' });
    expect(r.status).toBe(400);
  });

  it('says so plainly when metering is not configured', async () => {
    const r = await call(createPlaySessionsRouter({ logger: quiet }), 'POST', '/observations', {
      deviceId: 'd', surface: 's', observation: { state: 'playing' },
    });
    expect(r.status).toBe(503);
  });
});

describe('GET /devices/:deviceId', () => {
  it('returns the open session', async () => {
    const r = await call(createPlaySessionsRouter({ sessions, logger: quiet }), 'GET', '/devices/tv');
    expect(r.body.session).toMatchObject({ id: 'ps_1', playedMs: 42_000 });
  });

  it('returns null rather than 404 for an idle device', async () => {
    const r = await call(createPlaySessionsRouter({ sessions, logger: quiet }), 'GET', '/devices/art-panel');
    expect(r.status).toBe(200);
    expect(r.body.session).toBeNull();
  });
});

describe('GET /health', () => {
  it('exposes per-device observation health', async () => {
    const trackers = [{ getHealth: () => [{ deviceId: 'tv', lastTickAt: 'x', consecutiveErrors: 0 }] }];
    const r = await call(createPlaySessionsRouter({ trackers, logger: quiet }), 'GET', '/health');
    expect(r.body.devices).toHaveLength(1);
    expect(r.body.devices[0].deviceId).toBe('tv');
  });
});
