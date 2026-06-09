// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createFitnessRouter } from './fitness.mjs';

const silentLogger = { info(){}, warn(){}, error(){}, debug(){} };

function appWith(danceLightingController) {
  const app = express();
  app.use(express.json());
  app.use('/', createFitnessRouter({ danceLightingController, logger: silentLogger }));
  return app;
}

describe('fitness router — dance endpoints', () => {
  it('POST /dance/start delegates to the controller', async () => {
    const ctrl = { start: vi.fn().mockResolvedValue({ ok: true, started: true }), accent: vi.fn(), stop: vi.fn() };
    const res = await request(appWith(ctrl)).post('/dance/start').send({});
    expect(res.status).toBe(200);
    expect(ctrl.start).toHaveBeenCalled();
    expect(res.body).toMatchObject({ ok: true });
  });

  it('POST /dance/accent and /dance/stop delegate', async () => {
    const ctrl = { start: vi.fn(), accent: vi.fn().mockResolvedValue({ ok: true }), stop: vi.fn().mockResolvedValue({ ok: true }) };
    await request(appWith(ctrl)).post('/dance/accent').send({});
    await request(appWith(ctrl)).post('/dance/stop').send({});
    expect(ctrl.accent).toHaveBeenCalled();
    expect(ctrl.stop).toHaveBeenCalled();
  });

  it('returns a graceful skip when no controller is wired', async () => {
    const res = await request(appWith(undefined)).post('/dance/start').send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, skipped: true });
  });
});
