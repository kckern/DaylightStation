/**
 * /api/v1/media/routines* — routine catalog, history and flags
 * (docs/reference/media/media-app-technical.md §2.6).
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createMediaHouseRouter } from './mediaHouse.mjs';
import { errorHandlerMiddleware } from '#system/http/middleware/index.mjs';
import { RoutineCatalogService } from '#apps/media/RoutineCatalogService.mjs';

function makeApp() {
  let snapshot = null;
  const routineCatalog = new RoutineCatalogService({
    snapshots: { load: async () => snapshot, save: async (s) => { snapshot = s; } },
    clock: { now: () => Date.parse('2026-10-03T00:00:00Z') },
    logger: { info: vi.fn(), warn: vi.fn() },
  });
  const routineHistory = {
    list: vi.fn(async (q) => ({ items: [{ at: 't', routine: { id: 'r', name: 'R' }, deviceId: q.deviceId ?? 'fleet:x', outcome: 'started' }] })),
    flags: vi.fn(async () => ({ items: [{ problem: 'off' }] })),
  };
  const app = express();
  app.use(express.json());
  app.use('/api/v1/media', createMediaHouseRouter({ routineCatalog, routineHistory }));
  app.use(errorHandlerMiddleware({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
  return { app, routineHistory };
}

describe('routines API', () => {
  it('imports a parsed HA routine config, then lists the routines and where they came from', async () => {
    const { app } = makeApp();
    const config = {
      restCommands: { morning: { url: 'http://h/api/v1/device/livingroom-tv/load?queue=morning-program' } },
      scripts: {}, automations: [{ id: 'b1', alias: 'Button 1', actions: [{ service: 'rest_command.morning' }] }],
    };
    const put = await request(app).put('/api/v1/media/routines/catalog').send({ config, source: 'cli' });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ count: 1, dropped: 0, importedAt: '2026-10-03T00:00:00.000Z' });
    const list = await request(app).get('/api/v1/media/routines');
    expect(list.body.routines).toEqual([expect.objectContaining({
      id: 'automation:b1', name: 'Button 1', kind: 'automation',
      targets: [{ deviceId: 'fleet:livingroom-tv', screenId: 'livingroom-tv', query: 'queue=morning-program' }],
    })]);
    expect(list.body.sources).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'snapshot', used: true, from: 'cli' })]));
  });

  it('400 on an empty import', async () => {
    const { app } = makeApp();
    const res = await request(app).put('/api/v1/media/routines/catalog').send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_ROUTINES');
  });

  it('history and flags pass their filters through', async () => {
    const { app, routineHistory } = makeApp();
    const hist = await request(app).get('/api/v1/media/routines/history?deviceId=fleet:livingroom-tv&limit=5&routineId=r');
    expect(hist.body.items[0].deviceId).toBe('fleet:livingroom-tv');
    expect(routineHistory.list).toHaveBeenCalledWith({ householdId: undefined, limit: '5', deviceId: 'fleet:livingroom-tv', routineId: 'r' });
    expect((await request(app).get('/api/v1/media/routines/flags')).body).toEqual({ items: [{ problem: 'off' }] });
  });

  it('501 when not wired', async () => {
    const app = express();
    app.use('/api/v1/media', createMediaHouseRouter({}));
    expect((await request(app).get('/api/v1/media/routines')).status).toBe(501);
    expect((await request(app).get('/api/v1/media/routines/history')).status).toBe(501);
  });
});
