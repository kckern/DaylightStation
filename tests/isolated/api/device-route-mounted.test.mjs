// tests/isolated/api/device-route-mounted.test.mjs
import { describe, test, expect } from '@jest/globals';
import { createApiRouter } from '../../../backend/src/4_api/v1/routers/api.mjs';
import express from 'express';
import request from 'supertest';

describe('API Router - /device mount', () => {
  test('/device route is mounted when device router is provided', async () => {
    const deviceRouter = express.Router();
    deviceRouter.get('/config', (req, res) => res.json({ ok: true }));

    const apiRouter = createApiRouter({
      safeConfig: {},
      routers: { device: deviceRouter },
      logger: { info: () => {} }
    });

    const app = express();
    app.use('/api/v1', apiRouter);

    const res = await request(app).get('/api/v1/device/config');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('/device appears in /status routes list', async () => {
    const deviceRouter = express.Router();

    const apiRouter = createApiRouter({
      safeConfig: {},
      routers: { device: deviceRouter },
      logger: { info: () => {} }
    });

    const app = express();
    app.use('/api/v1', apiRouter);

    const res = await request(app).get('/api/v1/status');
    expect(res.body.routes).toContain('/device');
  });
});
