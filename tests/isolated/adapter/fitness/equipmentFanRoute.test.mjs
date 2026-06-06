// tests/isolated/adapter/fitness/equipmentFanRoute.test.mjs
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createFitnessRouter } from '../../../../backend/src/4_api/v1/routers/fitness.mjs';

function mountApp(equipmentFanController) {
  const configService = {
    getDefaultHouseholdId: () => 'default',
    getDataDir: () => '/tmp',
  };
  const router = createFitnessRouter({
    sessionService: { getStoragePaths: vi.fn() },
    zoneLedController: null,
    equipmentFanController,
    userService: { hydrateFitnessConfig: (d) => d },
    configService,
    contentRegistry: null,
    transcriptionService: null,
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  });
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use((req, res, next) => { req.householdId = 'default'; next(); });
  app.use('/api/v1/fitness', router);
  return app;
}

describe('POST /api/v1/fitness/equipment_fan', () => {
  it('returns 503 when equipmentFanController is null', async () => {
    const app = mountApp(null);
    const res = await request(app)
      .post('/api/v1/fitness/equipment_fan')
      .send({ rpm: { current: 90 }, zones: ['z2'], sessionEnded: false, householdId: 'default' });

    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/not configured/i);
  });

  it('returns 200 with the controller result and forwards body args to evaluate', async () => {
    const controllerResult = { ok: true, fired: true, action: 'turn_on' };
    const evaluate = vi.fn().mockResolvedValue(controllerResult);
    const app = mountApp({ evaluate });

    const body = {
      rpm: { current: 95, average: 88 },
      zones: ['z3'],
      sessionEnded: true,
      householdId: 'household-x',
    };

    const res = await request(app)
      .post('/api/v1/fitness/equipment_fan')
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(controllerResult);

    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(evaluate).toHaveBeenCalledWith({
      rpm: body.rpm,
      zones: body.zones,
      sessionEnded: body.sessionEnded,
      householdId: body.householdId,
    });
  });
});
