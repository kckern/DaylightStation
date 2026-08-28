// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createPianoRouter } from './piano.mjs';

const KNOWN_USERS = new Set(['kid_a', 'kid_b']);

function appWith(service) {
  const app = express();
  app.use(express.json());
  // Mirror piano.courses.test.mjs's minimal construction — pianoContainer double
  // with only what createPianoRouter dereferences at build time. isKnownUser
  // is real here (not just available:false) because the game-budget routes
  // now gate on it, same as their `challenges/prepare` neighbour.
  app.use('/api/v1/piano', createPianoRouter({
    pianoContainer: {
      available: () => false,
      studioDatastore: { isKnownUser: (id) => KNOWN_USERS.has(id) },
    },
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

  it('POST session allows the guest sentinel through, like its challenges/prepare neighbour', async () => {
    const service = { open: vi.fn(async () => ({ enabled: true, sessionId: 's1', cumulativeSeconds: 0, secondsLeft: 100 })) };
    const res = await request(appWith(service))
      .post('/api/v1/piano/users/guest/game-budget/session').send({ deviceId: 'kiosk' });
    expect(res.status).toBe(200);
    expect(service.open).toHaveBeenCalledWith({ learnerId: 'guest', deviceId: 'kiosk' });
  });

  it('POST session rejects an unknown user without touching the service', async () => {
    const service = { open: vi.fn(async () => ({ enabled: true })) };
    const res = await request(appWith(service))
      .post('/api/v1/piano/users/not_a_real_kid/game-budget/session').send({ deviceId: 'kiosk' });
    expect(res.status).toBe(400);
    expect(service.open).not.toHaveBeenCalled();
  });

  it('GET balance rejects an unknown user (400), not a silent balance read', async () => {
    const service = { balance: vi.fn(async () => ({ enabled: true, secondsLeft: 1 })) };
    const res = await request(appWith(service)).get('/api/v1/piano/users/not_a_real_kid/game-budget');
    expect(res.status).toBe(400);
    expect(service.balance).not.toHaveBeenCalled();
  });

  it('POST settle forwards the cumulative and returns depletion', async () => {
    const service = { settle: vi.fn(async () => ({ secondsLeft: 0, depleted: true, deviceDepleted: false })) };
    const res = await request(appWith(service))
      .post('/api/v1/piano/users/kid_a/game-budget/session/s1/settle').send({ cumulativeSeconds: 2700 });
    expect(res.status).toBe(200);
    expect(res.body.depleted).toBe(true);
    expect(service.settle).toHaveBeenCalledWith({ sessionId: 's1', learnerId: 'kid_a', cumulativeSeconds: 2700 });
  });

  it('POST settle rejects an unknown user before touching cumulativeSeconds or the service', async () => {
    const service = { settle: vi.fn(async () => ({ secondsLeft: 0, depleted: false, deviceDepleted: false })) };
    const res = await request(appWith(service))
      .post('/api/v1/piano/users/not_a_real_kid/game-budget/session/s1/settle').send({ cumulativeSeconds: 30 });
    expect(res.status).toBe(400);
    expect(service.settle).not.toHaveBeenCalled();
  });

  // Regression coverage for the `Number(x) || 0` bug: garbage collapsed
  // silently to a zero-charge settle (D16 — a swallowed debit is free game
  // time), and an out-of-range/non-finite value (Infinity, or a huge finite
  // like 1e308) rode straight through into both the learner AND the single
  // global device total, zeroing every OTHER learner's remaining device time
  // for the rest of the day too (gameBudget.mjs applySettle + balanceFor).
  it.each([
    ['undefined field', {}],
    ['a string', { cumulativeSeconds: 'abc' }],
    // `Number(null) === 0`, so a loose `Number.isFinite` guard alone would
    // have silently ACCEPTED this as a legitimate zero-charge settle rather
    // than rejecting it — the typeof check is what catches it.
    ['null', { cumulativeSeconds: null }],
    ['negative', { cumulativeSeconds: -5 }],
  ])('POST settle 400s on invalid cumulativeSeconds: %s', async (_label, body) => {
    const service = { settle: vi.fn(async () => ({ secondsLeft: 0, depleted: false, deviceDepleted: false })) };
    const res = await request(appWith(service))
      .post('/api/v1/piano/users/kid_a/game-budget/session/s1/settle').send(body);
    expect(res.status).toBe(400);
    expect(service.settle).not.toHaveBeenCalled();
  });

  // The actual reported attack: `JSON.parse('{"cumulativeSeconds":1e400}')`
  // yields `Infinity` (the JSON grammar has no exponent-magnitude limit, so
  // the parser overflows to Infinity on read). Sent as a JS object through
  // supertest's `.send()`, `1e400`/`Infinity` would round-trip through
  // `JSON.stringify` first and get mangled to `null` before it ever leaves
  // the client, masking the bug — so this sends the raw wire text directly
  // to reproduce what express.json()'s JSON.parse actually sees.
  it('POST settle 400s Infinity smuggled via an oversized JSON exponent, not just object-typed Infinity', async () => {
    const service = { settle: vi.fn(async () => ({ secondsLeft: 0, depleted: false, deviceDepleted: false })) };
    const res = await request(appWith(service))
      .post('/api/v1/piano/users/kid_a/game-budget/session/s1/settle')
      .set('Content-Type', 'application/json')
      .send('{"cumulativeSeconds":1e400}');
    expect(res.status).toBe(400);
    expect(service.settle).not.toHaveBeenCalled();
  });

  it('POST settle clamps a huge-but-finite cumulativeSeconds to one day of seconds instead of forwarding it raw', async () => {
    const service = { settle: vi.fn(async () => ({ secondsLeft: 0, depleted: true, deviceDepleted: true })) };
    const res = await request(appWith(service))
      .post('/api/v1/piano/users/kid_a/game-budget/session/s1/settle').send({ cumulativeSeconds: 1e308 });
    expect(res.status).toBe(200);
    expect(service.settle).toHaveBeenCalledWith({ sessionId: 's1', learnerId: 'kid_a', cumulativeSeconds: 86400 });
  });

  // Route-level defense-in-depth for the prototype-pollution vector fixed at
  // the domain layer (gameBudget.mjs's Object.hasOwn guard): a clean 400
  // here, before the service is ever called, rather than relying solely on
  // the domain throw. safeSegment (this file's other path-segment guard)
  // does NOT catch these — it only blocks `/`, `\`, `..` — so this is a
  // dedicated check, not a reuse of that one.
  it.each(['__proto__', 'constructor', 'prototype'])(
    'POST settle 400s a %j sessionId without touching the service',
    async (pollutedId) => {
      const service = { settle: vi.fn(async () => ({ secondsLeft: 0, depleted: false, deviceDepleted: false })) };
      const res = await request(appWith(service))
        .post(`/api/v1/piano/users/kid_a/game-budget/session/${pollutedId}/settle`)
        .send({ cumulativeSeconds: 30 });
      expect(res.status).toBe(400);
      expect(service.settle).not.toHaveBeenCalled();
    },
  );

  it.each(['__proto__', 'constructor', 'prototype'])(
    'POST close 400s a %j sessionId without touching the service',
    async (pollutedId) => {
      const service = { close: vi.fn(async () => ({ ok: true })) };
      const res = await request(appWith(service))
        .post(`/api/v1/piano/users/kid_a/game-budget/session/${pollutedId}/close`)
        .send({ cumulativeSeconds: 30 });
      expect(res.status).toBe(400);
      expect(service.close).not.toHaveBeenCalled();
    },
  );

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

  it('POST close 400s on invalid cumulativeSeconds, same as settle', async () => {
    const service = { close: vi.fn(async () => ({ ok: true })) };
    const res = await request(appWith(service))
      .post('/api/v1/piano/users/kid_a/game-budget/session/s1/close').send({ cumulativeSeconds: 'nope' });
    expect(res.status).toBe(400);
    expect(service.close).not.toHaveBeenCalled();
  });

  it('POST close rejects an unknown user without touching the service', async () => {
    const service = { close: vi.fn(async () => ({ ok: true })) };
    const res = await request(appWith(service))
      .post('/api/v1/piano/users/not_a_real_kid/game-budget/session/s1/close').send({ cumulativeSeconds: 30 });
    expect(res.status).toBe(400);
    expect(service.close).not.toHaveBeenCalled();
  });

  // NOTE: this only proves asyncHandler forwards a stamped err.status to
  // next(err) unmolested — the router's own responsibility. It is NOT
  // end-to-end evidence about which error-handler middleware is mounted in
  // production (piano.mjs's own errorHandlerMiddleware vs. the app-level
  // one) or that either honors err.status — that was verified separately by
  // reading errorHandler.mjs and confirming both getHttpStatus and
  // getHttpStatusByName check err.status/err.statusCode first.
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
