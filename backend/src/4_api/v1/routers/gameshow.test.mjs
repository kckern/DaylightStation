// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createGameshowRouter } from './gameshow.mjs';

const NOOP = { info() {}, warn() {}, error() {}, debug() {} };

// temp media dir with one real file for the /media route
import fs from 'fs';
import os from 'os';
import path from 'path';
const mediaAppsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gameshow-media-'));
fs.mkdirSync(path.join(mediaAppsDir, 'gameshow/classic'), { recursive: true });
fs.writeFileSync(path.join(mediaAppsDir, 'gameshow/classic/correct.mp3'), 'fake-mp3');

function makeApp() {
  const service = {
    getConfig: vi.fn(() => ({ buzzers: [], team_presets: [], defaults: { timer_seconds: 12, mute: false }, sounds: { pack: 'classic' } })),
    listSets: vi.fn(() => [{ id: 's1', title: 'Set One', description: '', roundCount: 2, valid: true, error: null }]),
    getSet: vi.fn((game, id) => {
      if (id !== 's1') throw new Error(`set not found: ${id}`);
      return { id: 's1', title: 'Set One', rounds: [], final: null };
    }),
  };
  const sessions = new Map();
  const store = {
    create: vi.fn(({ game, setId, teams }) => {
      const s = { id: 'gs_1', game, setId, teams, state: null, status: 'active', created: 'x', updated: 'x' };
      sessions.set(s.id, s);
      return s;
    }),
    getActive: vi.fn(() => [...sessions.values()].find((s) => s.status === 'active') || null),
    checkpoint: vi.fn((id, state) => {
      const s = sessions.get(id);
      if (!s) return null;
      s.state = state;
      return s;
    }),
    finish: vi.fn((id) => {
      const s = sessions.get(id);
      if (!s) return null;
      s.status = 'complete';
      return s;
    }),
  };
  const broadcastEvent = vi.fn();
  const app = express();
  app.use(express.json());
  app.use('/gameshow', createGameshowRouter({ gameShowService: service, sessionStore: store, broadcastEvent, mediaAppsDir, logger: NOOP }));
  return { app, service, store, broadcastEvent };
}

describe('gameshow router', () => {
  let ctx;
  beforeEach(() => { ctx = makeApp(); });

  it('GET /config returns service config', async () => {
    const res = await request(ctx.app).get('/gameshow/config');
    expect(res.status).toBe(200);
    expect(res.body.defaults.timer_seconds).toBe(12);
  });

  it('GET /games lists registered games', async () => {
    const res = await request(ctx.app).get('/gameshow/games');
    expect(res.status).toBe(200);
    expect(res.body.games).toEqual([{ id: 'jeopardy', title: 'Jeopardy' }]);
  });

  it('GET /games/:game/sets and /sets/:setId', async () => {
    const list = await request(ctx.app).get('/gameshow/games/jeopardy/sets');
    expect(list.body.sets[0].id).toBe('s1');
    const one = await request(ctx.app).get('/gameshow/games/jeopardy/sets/s1');
    expect(one.body.title).toBe('Set One');
    const missing = await request(ctx.app).get('/gameshow/games/jeopardy/sets/nope');
    expect(missing.status).toBe(404);
  });

  it('session lifecycle: create → active → checkpoint → finish', async () => {
    const created = await request(ctx.app).post('/gameshow/sessions')
      .send({ game: 'jeopardy', setId: 's1', teams: [{ id: 'team_1' }] });
    expect(created.status).toBe(201);
    const active = await request(ctx.app).get('/gameshow/sessions/active');
    expect(active.body.session.id).toBe('gs_1');
    const ck = await request(ctx.app).post('/gameshow/sessions/gs_1/checkpoint').send({ state: { phase: 'playing' } });
    expect(ck.body.state.phase).toBe('playing');
    const fin = await request(ctx.app).post('/gameshow/sessions/gs_1/finish');
    expect(fin.body.status).toBe('complete');
    const after = await request(ctx.app).get('/gameshow/sessions/active');
    expect(after.body.session).toBe(null);
  });

  it('POST /sessions requires game+setId', async () => {
    const res = await request(ctx.app).post('/gameshow/sessions').send({});
    expect(res.status).toBe(400);
  });

  it('checkpoint on unknown session → 404', async () => {
    const res = await request(ctx.app).post('/gameshow/sessions/gs_99/checkpoint').send({ state: {} });
    expect(res.status).toBe(404);
  });

  it('POST /buzz broadcasts a gameshow buzz event', async () => {
    const res = await request(ctx.app).post('/gameshow/buzz').send({ slot: 'slot_2' });
    expect(res.status).toBe(202);
    expect(ctx.broadcastEvent).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'gameshow', kind: 'buzz', slot: 'slot_2', buzzerId: 'debug', action: 'inject',
    }));
    const bad = await request(ctx.app).post('/gameshow/buzz').send({});
    expect(bad.status).toBe(400);
  });

  it('GET /media/* serves files from mediaAppsDir and blocks traversal', async () => {
    const ok = await request(ctx.app).get('/gameshow/media/gameshow/classic/correct.mp3');
    expect(ok.status).toBe(200);
    const missing = await request(ctx.app).get('/gameshow/media/gameshow/classic/nope.mp3');
    expect(missing.status).toBe(404);
    const traversal = await request(ctx.app).get('/gameshow/media/..%2F..%2Fetc%2Fpasswd');
    expect(traversal.status).toBe(404);
  });
});
