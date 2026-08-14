import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createPressureMatRouter } from './pressureMat.mjs';

function appWith(adapter) {
  const app = express();
  app.use(express.json());
  app.use('/pressure-mats', createPressureMatRouter({ pressureMatAdapter: adapter, logger: { warn() {} } }));
  return app;
}

describe('pressureMat router', () => {
  it('lists snapshots and returns a device by id', async () => {
    const adapter = { listStatus: () => [{ id: 'mat1' }], getStatus: (id) => id === 'mat1' ? { id } : null };
    expect((await request(appWith(adapter)).get('/pressure-mats')).body).toEqual({ pressureMats: [{ id: 'mat1' }] });
    expect((await request(appWith(adapter)).get('/pressure-mats/missing')).status).toBe(404);
  });

  it('validates and forwards threshold commands', async () => {
    const adapter = { setThreshold: vi.fn().mockResolvedValue({ ok: true }) };
    const response = await request(appWith(adapter)).post('/pressure-mats/mat1/threshold').send({ delta: .12, gradient: .08 });
    expect(response.status).toBe(200);
    expect(adapter.setThreshold).toHaveBeenCalledWith('mat1', {
      delta: .12, gradient: .08, stompDelta: undefined, stompGradient: undefined,
    });
  });

  it('maps adapter failures to HTTP responses', async () => {
    const adapter = { recalibrate: vi.fn().mockRejectedValue(Object.assign(new Error('offline'), { status: 502, code: 'DEVICE_UNAVAILABLE' })) };
    const response = await request(appWith(adapter)).post('/pressure-mats/mat1/recalibrate');
    expect(response.status).toBe(502);
    expect(response.body).toEqual({ error: 'offline', code: 'DEVICE_UNAVAILABLE' });
  });
});
