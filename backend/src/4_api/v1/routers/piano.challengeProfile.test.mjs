// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createPianoRouter } from './piano.mjs';

function appWith({ roles = ['kiosk'], user = null, knownUser = true, service = null } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.roles = roles; req.user = user; next(); });
  app.use('/api/v1/piano', createPianoRouter({
    pianoContainer: { studioDatastore: { isKnownUser: () => knownUser }, composerSongStore: {} },
    pianoChallengeProfileService: service,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }));
  return app;
}

describe('PianoChallenge profile routes', () => {
  it('reads and writes the placement level through the service for an authorized kiosk', async () => {
    const service = {
      get: vi.fn(() => ({ startLevel: 'L1' })),
      setStartLevel: vi.fn(() => ({ startLevel: 'L2' })),
    };
    const app = appWith({ service });
    const read = await request(app).get('/api/v1/piano/users/kid/piano-challenge-profile');
    expect(read.status).toBe(200);
    expect(read.headers['cache-control']).toBe('no-store');
    expect(read.body).toEqual({ startLevel: 'L1' });
    expect(service.get).toHaveBeenCalledWith({ learnerId: 'kid' });

    const write = await request(app).put('/api/v1/piano/users/kid/piano-challenge-profile').send({ startLevel: 'L2' });
    expect(write.status).toBe(200);
    expect(write.body).toEqual({ startLevel: 'L2' });
    expect(service.setStartLevel).toHaveBeenCalledWith({ learnerId: 'kid', startLevel: 'L2' });
  });

  it('requires a learner identity or a trusted writer before exposing or changing a profile', async () => {
    const service = { get: vi.fn(), setStartLevel: vi.fn() };
    expect((await request(appWith({ service, roles: [] })).get('/api/v1/piano/users/kid/piano-challenge-profile')).status).toBe(401);
    expect((await request(appWith({ service, roles: ['member'], user: { sub: 'sibling', roles: ['member'] } }))
      .put('/api/v1/piano/users/kid/piano-challenge-profile').send({ startLevel: 'L1' })).status).toBe(403);
    expect(service.get).not.toHaveBeenCalled();
    expect(service.setStartLevel).not.toHaveBeenCalled();
  });

  it('rejects an unknown user before calling the profile service', async () => {
    const service = { get: vi.fn(), setStartLevel: vi.fn() };
    const response = await request(appWith({ service, knownUser: false }))
      .put('/api/v1/piano/users/not-a-user/piano-challenge-profile').send({ startLevel: 'L1' });
    expect(response.status).toBe(400);
    expect(service.setStartLevel).not.toHaveBeenCalled();
  });

  it('answers honestly when the composition did not wire PianoChallenge profiles', async () => {
    const app = appWith();
    expect((await request(app).get('/api/v1/piano/users/kid/piano-challenge-profile')).status).toBe(501);
    expect((await request(app).put('/api/v1/piano/users/kid/piano-challenge-profile').send({ startLevel: 'L1' })).status).toBe(501);
  });
});
