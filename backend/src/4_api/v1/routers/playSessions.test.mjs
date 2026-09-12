// @vitest-environment node
//
// This drives a real Express listener, so it needs Node's fetch rather than the
// browser-like default environment, whose fetch enforces CORS against localhost.
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import { createPlaySessionsRouter } from './playSessions.mjs';
import { SummarisePlayUsage } from '#apps/gaming/usecases/SummarisePlayUsage.mjs';

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

describe('GET /devices/:deviceId/history — played time became money', () => {
  const withHistory = {
    listForDeviceSince: async (d, since) => (d === 'tv' ? [
      { toSnapshot: () => ({ id: 'ps_1', deviceId: 'tv', playedMs: 60_000, since }) },
    ] : []),
  };

  it('returns sessions with what was played and how precisely', async () => {
    const r = await call(createPlaySessionsRouter({ sessions: withHistory, logger: quiet }),
      'GET', '/devices/tv/history?since=2026-09-01T00:00:00.000Z');
    expect(r.status).toBe(200);
    expect(r.body.sessions[0]).toMatchObject({ id: 'ps_1', playedMs: 60_000 });
  });

  it('rejects a since that is not an instant', async () => {
    const r = await call(createPlaySessionsRouter({ sessions: withHistory, logger: quiet }),
      'GET', '/devices/tv/history?since=last-tuesday');
    expect(r.status).toBe(400);
  });

  it('returns an empty list rather than an error for a device with no history', async () => {
    const r = await call(createPlaySessionsRouter({ sessions: withHistory, logger: quiet }), 'GET', '/devices/other/history');
    expect(r.body.sessions).toEqual([]);
  });
});

describe('GET /health', () => {
  it('exposes per-device observation health', async () => {
    const trackers = [{ getHealth: () => [{ deviceId: 'tv', lastTickAt: 'x', consecutiveErrors: 0 }] }];
    const r = await call(createPlaySessionsRouter({ trackers, logger: quiet }), 'GET', '/health');
    expect(r.body.devices).toHaveLength(1);
    expect(r.body.devices[0].deviceId).toBe('tv');
  });

  it('reports devices the meter has lost sight of', async () => {
    const watchdog = { blockedDevices: () => ['tv'] };
    const r = await call(createPlaySessionsRouter({ watchdog, logger: quiet }), 'GET', '/health');
    expect(r.body.blocked).toEqual(['tv']);
  });
});

describe('parent controls — grant, extend, revoke', () => {
  let rows;
  const grantLedger = {
    forUserOn: async (u, on) => ({ grantedMs: rows.reduce((t, r) => t + r.deltaMs, 0), entries: rows, on }),
  };
  const grantPlayTime = {
    execute: async ({ userId, minutes }) => {
      rows.push({ deltaMs: minutes * 60_000 });
      return { userId, day: '2026-09-11', grantedMs: rows.reduce((t, r) => t + r.deltaMs, 0), changedMs: minutes * 60_000 };
    },
  };
  const router = () => createPlaySessionsRouter({ grantLedger, grantPlayTime, logger: quiet });
  beforeEach(() => { rows = []; });

  it('grants time', async () => {
    const r = await call(router(), 'POST', '/grants', { userId: 'child', minutes: 20, by: 'parent' });
    expect(r.status).toBe(200);
    expect(r.body.grantedMs).toBe(1_200_000);
  });

  it('takes time back with a negative amount', async () => {
    const r = router();
    await call(r, 'POST', '/grants', { userId: 'child', minutes: 30 });
    // fresh listener per call, but rows persist — the ledger is the shared state
    const after = await call(r, 'POST', '/grants', { userId: 'child', minutes: -10 });
    expect(after.body.grantedMs).toBe(1_200_000);
  });

  it('rejects a request with no amount', async () => {
    const r = await call(router(), 'POST', '/grants', { userId: 'child' });
    expect(r.status).toBe(400);
  });

  it('reports the balance and how it was arrived at', async () => {
    rows.push({ deltaMs: 600_000, by: 'parent', reason: 'reading' });
    const r = await call(router(), 'GET', '/grants/child');
    expect(r.body.grantedMs).toBe(600_000);
    expect(r.body.entries[0].reason).toBe('reading');
  });

  it('says so plainly when grants are not configured', async () => {
    const r = await call(createPlaySessionsRouter({ logger: quiet }), 'POST', '/grants', { userId: 'c', minutes: 5 });
    expect(r.status).toBe(503);
  });
});

describe('GET /usage — the monitoring surface', () => {
  const MIN = 60_000;
  const snap = (over = {}) => ({
    id: 's1', startedAt: '2026-09-12T10:00:00.000Z', deviceId: 'livingroom-tv',
    userId: 'child-a', content: { contentId: 'g:1', title: 'Game One' },
    playedMs: 10 * MIN, confidenceMs: 10_000, ...over,
  });
  const withLedger = (rows) => createPlaySessionsRouter({
    summarisePlayUsage: new SummarisePlayUsage({ sessions: { listSince: async () => rows }, logger: quiet }),
    logger: quiet,
  });

  it('rolls usage up by player, title, device and day', async () => {
    const r = await call(withLedger([
      snap(), snap({ id: 's2', userId: 'child-b', playedMs: 5 * MIN }),
    ]), 'GET', '/usage?since=2026-09-01T00:00:00.000Z');
    expect(r.status).toBe(200);
    expect(r.body.totalPlayed).toBe('15m 0s');
    expect(r.body.byUser[0]).toMatchObject({ key: 'child-a', playedMs: 600000 });
    expect(r.body.byTitle[0].key).toBe('Game One');
  });

  it('accepts entities as well as snapshots', async () => {
    const entity = { toSnapshot: () => snap() };
    const r = await call(withLedger([entity]), 'GET', '/usage');
    expect(r.body.sessionCount).toBe(1);
  });

  it('returns an empty ledger rather than an error', async () => {
    const r = await call(withLedger([]), 'GET', '/usage');
    expect(r.body).toMatchObject({ totalPlayedMs: 0, sessionCount: 0 });
  });

  it('rejects a since that is not an instant', async () => {
    const r = await call(withLedger([]), 'GET', '/usage?since=yesterday');
    expect(r.status).toBe(400);
  });

  it('says so plainly when recording is not configured', async () => {
    const r = await call(createPlaySessionsRouter({ logger: quiet }), 'GET', '/usage');
    expect(r.status).toBe(503);
  });
});
