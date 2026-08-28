// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createPianoRouter } from './piano.mjs';

function appWith(service) {
  const app = express();
  app.use(express.json());
  // Mirror piano.courses.test.mjs's minimal construction — pianoContainer double
  // with only what createPianoRouter dereferences at build time.
  app.use('/api/v1/piano', createPianoRouter({
    pianoContainer: { available: () => false },
    pianoGameBudgetService: service,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }));
  return app;
}

describe('piano game-budget routes', () => {
  it('POST session opens and returns the seed', async () => {
    const service = { open: vi.fn(async () => ({ enabled: true, sessionId: 's1', cumulativeSeconds: 30, secondsLeft: 100 })) };
    const res = await request(appWith(service))
      .post('/api/v1/piano/users/kid_a/game-budget/session').send({ deviceId: 'kiosk' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sessionId: 's1', cumulativeSeconds: 30 });
    expect(service.open).toHaveBeenCalledWith({ learnerId: 'kid_a', deviceId: 'kiosk' });
  });

  it('POST settle forwards the cumulative and returns depletion', async () => {
    const service = { settle: vi.fn(async () => ({ secondsLeft: 0, depleted: true, deviceDepleted: false })) };
    const res = await request(appWith(service))
      .post('/api/v1/piano/users/kid_a/game-budget/session/s1/settle').send({ cumulativeSeconds: 2700 });
    expect(res.status).toBe(200);
    expect(res.body.depleted).toBe(true);
    expect(service.settle).toHaveBeenCalledWith({ sessionId: 's1', learnerId: 'kid_a', cumulativeSeconds: 2700 });
  });

  it('GET balance answers enabled:false when the feature is off', async () => {
    const service = { balance: vi.fn(async () => ({ enabled: false })) };
    const res = await request(appWith(service)).get('/api/v1/piano/users/kid_a/game-budget');
    expect(res.body).toEqual({ enabled: false });
  });

  it('GET balance sets Cache-Control: no-store', async () => {
    const service = { balance: vi.fn(async () => ({ enabled: true, secondsLeft: 42 })) };
    const res = await request(appWith(service)).get('/api/v1/piano/users/kid_a/game-budget');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('POST close forwards params and returns the service result', async () => {
    const service = { close: vi.fn(async () => ({ ok: true })) };
    const res = await request(appWith(service))
      .post('/api/v1/piano/users/kid_a/game-budget/session/s1/close').send({ cumulativeSeconds: 120 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(service.close).toHaveBeenCalledWith({ sessionId: 's1', learnerId: 'kid_a', cumulativeSeconds: 120 });
  });

  it('a 409 learner-mismatch from settle survives to the client, not collapsed to 500', async () => {
    const service = {
      settle: vi.fn(async () => {
        throw Object.assign(new Error('session belongs to a different learner'), { status: 409 });
      }),
    };
    const app = appWith(service);
    // The app under test has no error handler mounted (mirrors the router
    // test idiom), so assert on the rejection the router forwards to next()
    // by mounting a minimal error handler that just echoes err.status.
    app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
    const res = await request(app)
      .post('/api/v1/piano/users/kid_a/game-budget/session/s1/settle').send({ cumulativeSeconds: 10 });
    expect(res.status).toBe(409);
  });

  it('an unwired service 404s the POSTs and disables the GET', async () => {
    const app = appWith(null);
    expect((await request(app).post('/api/v1/piano/users/k/game-budget/session').send({})).status).toBe(404);
    expect((await request(app).get('/api/v1/piano/users/k/game-budget')).body).toEqual({ enabled: false });
  });

  it('an unwired service 404s settle and close too', async () => {
    const app = appWith(null);
    expect((await request(app).post('/api/v1/piano/users/k/game-budget/session/s1/settle').send({})).status).toBe(404);
    expect((await request(app).post('/api/v1/piano/users/k/game-budget/session/s1/close').send({})).status).toBe(404);
  });
});
