// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createPianoRouter } from './piano.mjs';
import { withPianoRouterServices } from '../../../../../tests/_lib/pianoRouterDeps.mjs';

function appWith(lessonSittingLog) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/piano', createPianoRouter(withPianoRouterServices({
    pianoContainer: { available: () => false, studioDatastore: { isKnownUser: (id) => id === 'kid_a' } },
    lessonSittingLog,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  })));
  return app;
}

describe('GET /users/:userId/lesson-sittings', () => {
  it('returns rows newest first within the window', async () => {
    const list = vi.fn(() => [{ sittingId: 'b', updatedAt: '2026-11-12T10:00:00Z' }, { sittingId: 'a', updatedAt: '2026-11-11T10:00:00Z' }]);
    const res = await request(appWith({ list })).get('/api/v1/piano/users/kid_a/lesson-sittings?days=14');
    expect(res.status).toBe(200);
    expect(res.body.sittings.map((r) => r.sittingId)).toEqual(['b', 'a']);
    expect(list.mock.calls[0][0]).toBe('kid_a');
    expect(typeof list.mock.calls[0][1].sinceIso).toBe('string');
  });

  it('unknown user → 404', async () => {
    const res = await request(appWith({ list: vi.fn(() => []) })).get('/api/v1/piano/users/nobody/lesson-sittings');
    expect(res.status).toBe(404);
  });
});
