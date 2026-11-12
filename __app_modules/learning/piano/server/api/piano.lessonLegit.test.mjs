// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createPianoRouter } from './piano.mjs';
import { withPianoRouterServices } from '../../../../../tests/_lib/pianoRouterDeps.mjs';

function appWith(judgeNoteBurst) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/v1/piano', createPianoRouter(withPianoRouterServices({
    pianoContainer: { available: () => false, studioDatastore: { isKnownUser: (id) => id === 'kid_a' } },
    judgeNoteBurst,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  })));
  return app;
}
const note = (i) => ({ pitch: 60 + (i % 5), onsetMs: i * 300, durMs: 200, velocity: 64 });
const body = (n = 10, extra = {}) => ({ sittingId: 's1', kind: 'check-in', index: 1, burst: { notes: Array.from({ length: n }, (_, i) => note(i)), stats: { notes: n, distinctPitches: 5, pitchSpan: 4, medianIoiMs: 300, velocitySpread: 0 } }, ...extra });

describe('POST /users/:userId/lesson-legit', () => {
  it('returns the judge result', async () => {
    const execute = vi.fn(async () => ({ legit: true, probability: 0.9, source: 'model' }));
    const res = await request(appWith({ execute })).post('/api/v1/piano/users/kid_a/lesson-legit').send(body());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ legit: true, probability: 0.9, source: 'model' });
    expect(execute.mock.calls[0][0]).toMatchObject({ userId: 'kid_a', sittingId: 's1', kind: 'check-in', index: 1, preschool: false });
  });
  it('rejects 201 notes', async () => {
    const execute = vi.fn();
    const res = await request(appWith({ execute })).post('/api/v1/piano/users/kid_a/lesson-legit').send(body(201));
    expect(res.status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
  it('rejects an extra field on a note or in the burst', async () => {
    const execute = vi.fn();
    const b = body();
    b.burst.notes[0].image = 'data:...';
    expect((await request(appWith({ execute })).post('/api/v1/piano/users/kid_a/lesson-legit').send(b)).status).toBe(400);
    const b2 = body();
    b2.burst.pianoRoll = 'x';
    expect((await request(appWith({ execute })).post('/api/v1/piano/users/kid_a/lesson-legit').send(b2)).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
  it('unknown user 404; no judge 501', async () => {
    expect((await request(appWith({ execute: vi.fn() })).post('/api/v1/piano/users/zzz/lesson-legit').send(body())).status).toBe(404);
    expect((await request(appWith(null)).post('/api/v1/piano/users/kid_a/lesson-legit').send(body())).status).toBe(501);
  });
});
