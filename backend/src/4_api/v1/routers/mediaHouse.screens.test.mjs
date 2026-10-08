/**
 * /api/v1/media/screens* — the household screen registry HTTP contract
 * (docs/reference/media/media-app-technical.md §2.5).
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createMediaHouseRouter } from './mediaHouse.mjs';
import { errorHandlerMiddleware } from '#system/http/middleware/index.mjs';
import { ScreenRegistryService } from '#apps/media/ScreenRegistryService.mjs';

function makeApp({ routines = [] } = {}) {
  let state = { screens: {}, aliases: {} };
  const screenRegistry = new ScreenRegistryService({
    store: { load: async () => structuredClone(state), save: async (s) => { state = structuredClone(s); } },
    configuredScreens: { list: () => [{ id: 'fleet:livingroom-tv', screenId: 'livingroom-tv', name: 'Living Room TV', room: 'Living Room', type: 'shield-tv' }] },
    routines: { targeting: async (id) => routines.filter((r) => r.targets.includes(id)).map(({ id: rid, name }) => ({ id: rid, name })) },
    clock: { now: () => Date.parse('2026-10-03T12:00:00.000Z') },
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  });
  const app = express();
  app.use(express.json());
  app.use('/api/v1/media', createMediaHouseRouter({ screenRegistry, logger: { debug: vi.fn() } }));
  app.use(errorHandlerMiddleware({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
  return app;
}

describe('screens API', () => {
  it('announce registers a browser (id from the X-Daylight-Device header); GET lists it beside the configured screens', async () => {
    const app = makeApp();
    const announced = await request(app).post('/api/v1/media/screens/announce')
      .set('X-Daylight-Device', 'browser:aaaa1111-2222').send({ name: 'Kitchen tablet', room: 'Kitchen' });
    expect(announced.status).toBe(200);
    expect(announced.body.screen).toMatchObject({ id: 'browser:aaaa1111-2222', name: 'Kitchen tablet', room: 'Kitchen', kind: 'browser' });
    const list = await request(app).get('/api/v1/media/screens');
    expect(list.body.screens.map((s) => s.id)).toEqual(['browser:aaaa1111-2222', 'fleet:livingroom-tv']);
    expect(list.body).toHaveProperty('notSeenLately');
    expect(list.body).toHaveProperty('retired');
  });

  it('rename: 409 NAME_TAKEN with a suggestion; onCollision suffix takes it', async () => {
    const app = makeApp();
    await request(app).post('/api/v1/media/screens/announce').send({ id: 'browser:a', name: 'A' });
    const taken = await request(app).patch('/api/v1/media/screens/browser:a').send({ name: 'living room tv' });
    expect(taken.status).toBe(409);
    expect(taken.body).toMatchObject({ code: 'NAME_TAKEN', suggestion: 'living room tv (2)', heldBy: 'fleet:livingroom-tv' });
    const suffixed = await request(app).patch('/api/v1/media/screens/browser:a').send({ name: 'living room tv', onCollision: 'suffix' });
    expect(suffixed.body.screen.name).toBe('living room tv (2)');
  });

  it('rename of a routine target: 409 ROUTINES_TARGET listing them, then 200 with confirm', async () => {
    const app = makeApp({ routines: [{ id: 'automation:kitchen_button_1', name: 'Kitchen button 1', targets: ['fleet:livingroom-tv'] }] });
    const warn = await request(app).patch('/api/v1/media/screens/livingroom-tv').send({ name: 'Den TV' });
    expect(warn.status).toBe(409);
    expect(warn.body).toMatchObject({ code: 'ROUTINES_TARGET', action: 'rename', routines: [{ id: 'automation:kitchen_button_1', name: 'Kitchen button 1' }] });
    const ok = await request(app).patch('/api/v1/media/screens/livingroom-tv').send({ name: 'Den TV', confirm: true });
    expect(ok.status).toBe(200);
    expect(ok.body.screen).toMatchObject({ id: 'fleet:livingroom-tv', name: 'Den TV', wasName: 'Living Room TV' });
    const one = await request(app).get('/api/v1/media/screens/fleet:livingroom-tv');
    expect(one.body.routines).toEqual([{ id: 'automation:kitchen_button_1', name: 'Kitchen button 1' }]);
  });

  it('room only, add, merge, retire, restore', async () => {
    const app = makeApp();
    const room = await request(app).patch('/api/v1/media/screens/fleet:livingroom-tv').send({ room: 'Den' });
    expect(room.body.screen.room).toBe('Den');
    const added = await request(app).post('/api/v1/media/screens').send({ name: 'Garage tablet', room: 'Garage' });
    expect(added.status).toBe(201);
    expect(added.body.screen.id).toBe('screen:garage-tablet');
    await request(app).post('/api/v1/media/screens/announce').send({ id: 'browser:dup', name: 'Dup' });
    const unconfirmed = await request(app).post('/api/v1/media/screens/browser:dup/merge').send({ into: 'screen:garage-tablet' });
    expect(unconfirmed.status).toBe(409);
    expect(unconfirmed.body).toMatchObject({ code: 'CONFIRM_REQUIRED', action: 'merge', routines: [] });
    const merged = await request(app).post('/api/v1/media/screens/browser:dup/merge').send({ into: 'screen:garage-tablet', confirm: true });
    expect(merged.status).toBe(200);
    expect(merged.body.screen.aliases).toEqual(['browser:dup']);
    const unmerged = await request(app).post('/api/v1/media/screens/browser:dup/unmerge');
    expect(unmerged.status).toBe(200);
    expect(unmerged.body.screen).toMatchObject({ id: 'browser:dup', name: 'Dup' });
    expect((await request(app).post('/api/v1/media/screens/browser:dup/unmerge')).status).toBe(404);
    await request(app).post('/api/v1/media/screens/browser:dup/merge').send({ into: 'screen:garage-tablet', confirm: true });
    const retired = await request(app).post('/api/v1/media/screens/screen:garage-tablet/retire').send({});
    expect(retired.body.screen.retiredAt).toBeTruthy();
    const restored = await request(app).post('/api/v1/media/screens/screen:garage-tablet/restore');
    expect(restored.body.screen.retiredAt).toBeNull();
  });

  it('400 on missing fields, 404 on an unknown screen', async () => {
    const app = makeApp();
    expect((await request(app).post('/api/v1/media/screens').send({})).status).toBe(400);
    expect((await request(app).post('/api/v1/media/screens/announce').send({})).status).toBe(400);
    expect((await request(app).patch('/api/v1/media/screens/browser:a').send({})).status).toBe(400);
    expect((await request(app).post('/api/v1/media/screens/browser:a/merge').send({})).status).toBe(400);
    expect((await request(app).get('/api/v1/media/screens/screen:nope')).status).toBe(404);
    expect((await request(app).post('/api/v1/media/screens/screen:nope/retire').send({})).status).toBe(404);
  });

  it('an unknown household is 404, never 500', async () => {
    const screenRegistry = { list: vi.fn() };
    const app = express();
    app.use('/api/v1/media', createMediaHouseRouter({ screenRegistry, householdExists: (h) => h === 'jones' }));
    const res = await request(app).get('/api/v1/media/screens?household=nope');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('HOUSEHOLD_NOT_FOUND');
    expect(screenRegistry.list).not.toHaveBeenCalled();
    // A config lookup failing the same way deeper down maps to 404 too.
    const thrower = { list: vi.fn(async () => { const e = new Error('Household not found: x'); e.code = 'HOUSEHOLD_NOT_FOUND'; throw e; }) };
    const app2 = express();
    app2.use('/api/v1/media', createMediaHouseRouter({ screenRegistry: thrower }));
    app2.use(errorHandlerMiddleware({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
    expect((await request(app2).get('/api/v1/media/screens?household=x')).status).toBe(404);
  });

  it('room adjacency: set mutually, listed with GET /screens, cleared with an empty list, 400 without a room', async () => {
    const app = makeApp();
    expect((await request(app).get('/api/v1/media/screens/rooms/adjacency')).body).toEqual({ roomAdjacency: {} });
    const put = await request(app).put('/api/v1/media/screens/rooms/adjacency').send({ room: 'Kitchen', neighbours: ['Living Room'] });
    expect(put.status).toBe(200);
    expect(put.body.roomAdjacency).toEqual({ Kitchen: ['Living Room'], 'Living Room': ['Kitchen'] });
    expect((await request(app).get('/api/v1/media/screens')).body.roomAdjacency).toEqual(put.body.roomAdjacency);
    const cleared = await request(app).put('/api/v1/media/screens/rooms/adjacency').send({ room: 'kitchen', neighbours: [] });
    expect(cleared.body.roomAdjacency).toEqual({});
    const bad = await request(app).put('/api/v1/media/screens/rooms/adjacency').send({ neighbours: [] });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_ROOM');
    const notList = await request(app).put('/api/v1/media/screens/rooms/adjacency').send({ room: 'Den', neighbours: 'Hall' });
    expect(notList.status).toBe(400);
  });

  it('501 when the registry is not wired', async () => {
    const app = express();
    app.use('/api/v1/media', createMediaHouseRouter({}));
    expect((await request(app).get('/api/v1/media/screens')).status).toBe(501);
  });
});
