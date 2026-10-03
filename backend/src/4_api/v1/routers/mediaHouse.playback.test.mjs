/**
 * /api/v1/media/started-by, /screens/:id/started-by, /screens/:id/played-earlier
 * (docs/reference/media/media-app-technical.md §2.7–2.8).
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createMediaHouseRouter } from './mediaHouse.mjs';
import { errorHandlerMiddleware } from '#system/http/middleware/index.mjs';
import { ScreenPlaybackService } from '#apps/media/ScreenPlaybackService.mjs';
import { selectPlays } from '#domains/media/playLedger.mjs';

const NOW = Date.parse('2026-10-03T15:00:00.000Z');
const at = (min) => new Date(NOW - min * 60_000).toISOString();

function makeApp() {
  const rows = [
    { deviceId: 'fleet:livingroom-tv', contentId: 'plex:2', title: 'Two', startedAt: at(5) },
    { deviceId: 'fleet:livingroom-tv', contentId: 'plex:1', title: 'One', startedAt: at(20), origin: { kind: 'routine', id: 'automation:b1', name: 'Button 1' } },
  ];
  const screenPlayback = new ScreenPlaybackService({
    playLedger: { plays: async (q) => selectPlays(rows, q) },
    memory: {
      nowPlaying: async () => ({ known: true, list: [{ deviceId: 'fleet:livingroom-tv', contentId: 'plex:2' }] }),
      describeMany: async (ids) => new Map(ids.map((id) => [id, { title: `T${id}`, thumbnail: `/t/${id}` }])),
    },
    clock: { now: () => NOW },
  });
  const app = express();
  app.use('/api/v1/media', createMediaHouseRouter({ screenPlayback }));
  app.use(errorHandlerMiddleware({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
  return app;
}

describe('screen playback API', () => {
  it('started-by for one screen (bare devices.yml key accepted) and for all playing screens', async () => {
    const app = makeApp();
    const one = await request(app).get('/api/v1/media/screens/livingroom-tv/started-by');
    expect(one.status).toBe(200);
    expect(one.body).toEqual({
      deviceId: 'fleet:livingroom-tv', playing: { contentId: 'plex:2', title: 'Two' },
      startedBy: { kind: 'routine', id: 'automation:b1', name: 'Button 1' }, at: at(20), source: 'ledger', runStartedAt: at(20),
    });
    const all = await request(app).get('/api/v1/media/started-by');
    expect(all.body.items.map((i) => i.deviceId)).toEqual(['fleet:livingroom-tv']);
  });

  it('played-earlier lists the screen\'s plays newest first, without the one playing now; 400 on a bad before', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/v1/media/screens/fleet:livingroom-tv/played-earlier');
    expect(res.body.items.map((i) => [i.contentId, i.title, i.thumbnail])).toEqual([['plex:1', 'Tplex:1', '/t/plex:1']]);
    expect((await request(app).get('/api/v1/media/screens/x/played-earlier?before=nope')).status).toBe(400);
  });

  it('501 when not wired', async () => {
    const app = express();
    app.use('/api/v1/media', createMediaHouseRouter({}));
    expect((await request(app).get('/api/v1/media/started-by')).status).toBe(501);
  });
});
