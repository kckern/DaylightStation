// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createPianoRouter } from './piano.mjs';

function appWith({ roles = ['kiosk'], knownUser = true, service = null, eventBus = null } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.roles = roles; next(); });
  app.use('/api/v1/piano', createPianoRouter({
    pianoContainer: { studioDatastore: { isKnownUser: () => knownUser }, composerSongStore: {} },
    schoolPianoChallengeCompletionService: service,
    eventBus,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }));
  return app;
}

describe('School PianoChallenge completion route', () => {
  it('forwards only a completed passed assessment for an authorized learner', async () => {
    const service = { recordPassed: vi.fn(() => ({ descriptorId: 'c-major', duplicate: false })) };
    const response = await request(appWith({ service }))
      .post('/api/v1/piano/users/kid/school-piano-challenges/c-major/completion')
      .send({ assessmentId: 'assessment-1', score: 0.9, status: 'completed', passed: true });
    expect(response.status).toBe(200);
    expect(service.recordPassed).toHaveBeenCalledWith({ learnerId: 'kid', descriptorId: 'c-major', assessmentId: 'assessment-1', score: 0.9 });
  });

  it('signals the School ceremony bridge after a successful completion', async () => {
    const publish = vi.fn();
    const service = { recordPassed: vi.fn(() => ({ descriptorId: 'c-major', duplicate: false, completedAt: '2026-08-28T20:00:00.000Z' })) };
    await request(appWith({ service, eventBus: { publish } }))
      .post('/api/v1/piano/users/kid/school-piano-challenges/c-major/completion')
      .send({ assessmentId: 'assessment-1', score: 1, status: 'completed', passed: true });
    expect(publish).toHaveBeenCalledWith('piano.school-challenge.completed', {
      userId: 'kid', descriptorId: 'c-major', completedAt: '2026-08-28T20:00:00.000Z',
    });
  });

  it.each([
    { assessmentId: 'a', score: 1, status: 'timeout', passed: true },
    { assessmentId: 'a', score: 1, status: 'completed', passed: false },
    { assessmentId: '', score: 1, status: 'completed', passed: true },
  ])('rejects an ineligible assessment', async (body) => {
    const service = { recordPassed: vi.fn() };
    const response = await request(appWith({ service }))
      .post('/api/v1/piano/users/kid/school-piano-challenges/c-major/completion').send(body);
    expect(response.status).toBe(400);
    expect(service.recordPassed).not.toHaveBeenCalled();
  });

  it('rejects unknown learners and unwired compositions before the service', async () => {
    const service = { recordPassed: vi.fn() };
    expect((await request(appWith({ service, knownUser: false }))
      .post('/api/v1/piano/users/nope/school-piano-challenges/c-major/completion')
      .send({ assessmentId: 'a', score: 1, status: 'completed', passed: true })).status).toBe(400);
    expect(service.recordPassed).not.toHaveBeenCalled();
    expect((await request(appWith())
      .post('/api/v1/piano/users/kid/school-piano-challenges/c-major/completion')
      .send({ assessmentId: 'a', score: 1, status: 'completed', passed: true })).status).toBe(501);
  });
});
