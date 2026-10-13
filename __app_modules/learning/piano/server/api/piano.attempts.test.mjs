import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createPianoRouter } from './piano.mjs';
import { withPianoRouterServices } from '../../../../../tests/_lib/pianoRouterDeps.mjs';

function subject({ knownUser = true, withStore = true, roles = ['kiosk'], user = null } = {}) {
  const store = { save: vi.fn((_user, value) => value), list: vi.fn(() => []) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => { req.roles = roles; req.user = user; next(); });
  server.use('/api/v1/piano', createPianoRouter(withPianoRouterServices({
    pianoContainer: { studioDatastore: { isKnownUser: () => knownUser }, composerSongStore: {} },
    pianoAttemptStore: withStore ? store : null,
    logger,
  })));
  return { server, store, logger };
}

describe('piano attempt identity', () => {
  it('accepts an activity-only Learn practice write', async () => {
    const { server, store, logger } = subject();
    const response = await request(server).post('/api/v1/piano/users/learner4/attempts').send({
      attempt_id: 'attempt-learn-1', activity_id: 'sheet:bach:measure-1:rh', purpose: 'practice', status: 'completed', score: 1,
      provider_version: 'sheet-learn-runtime-v2',
      criteria: { completeness: 1, cleanliness: 1 },
      rubric: { id: 'sheet-learn-practice-v2', version: '2', weights: { completeness: 1, cleanliness: 1 }, part_weights: { rh: 1 } },
      verdict: { score: 1, passed: true, failed_criteria: [], failed_gates: [] },
      context: { surface: 'sheet-music-learn', matcher: 'cursor', mode: 'free' },
    });
    expect(response.status).toBe(201);
    expect(store.save).toHaveBeenCalledWith('learner4', expect.objectContaining({ activity_id: 'sheet:bach:measure-1:rh' }));
    expect(logger.info).toHaveBeenCalledWith('piano.attempt.saved', expect.objectContaining({
      surface: 'sheet-music-learn', matcher: 'cursor', mode: 'free', terminalStatus: 'completed', persistence: 'saved',
      attemptId: 'attempt-learn-1', purpose: 'practice', rubricId: 'sheet-learn-practice-v2', rubricVersion: '2',
      providerVersion: 'sheet-learn-runtime-v2',
      score: 1, passed: true, expectedNotes: null, persistenceDurationMs: expect.any(Number),
    }));
  });

  it('still rejects records without either stable identity', async () => {
    const { server, logger } = subject();
    const response = await request(server).post('/api/v1/piano/users/learner4/attempts').send({ status: 'completed', score: 1 });
    expect(response.status).toBe(400);
    expect(response.body.details.join(' ')).toMatch(/challenge_id or activity_id/);
    expect(logger.warn).toHaveBeenCalledWith('piano.attempt.rejected', expect.objectContaining({ persistence: 'rejected' }));
  });

  it('rejects blank stable identities', async () => {
    const { server } = subject();
    const response = await request(server).post('/api/v1/piano/users/learner4/attempts').send({
      activity_id: '   ', status: 'completed', score: 1,
    });
    expect(response.status).toBe(400);
    expect(response.body.details.join(' ')).toMatch(/challenge_id or activity_id/);
  });

  it('logs storage failures with correlation and no musical event stream', async () => {
    const { server, store, logger } = subject();
    store.save.mockImplementationOnce(() => { throw new Error('disk unavailable'); });
    const response = await request(server).post('/api/v1/piano/users/learner4/attempts').send({
      attempt_id: 'attempt-failed-1', activity_id: 'sheet:bach:all:rh', purpose: 'practice',
      status: 'completed', score: 1, diagnostics: { expected_notes: 3, matched_notes: 3, wrong_notes: 0 },
      prompt: { expected_events: [{ notes: [{ midi: 60 }] }] },
    });
    expect(response.status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith('piano.attempt.failed', expect.objectContaining({
      attemptId: 'attempt-failed-1', activityId: 'sheet:bach:all:rh', persistence: 'failed',
      expectedNotes: 3, matchedNotes: 3, wrongNotes: 0, persistenceDurationMs: expect.any(Number),
      persistenceError: 'disk unavailable',
    }));
    const logged = logger.error.mock.calls[0][1];
    expect(logged.prompt).toBeUndefined();
    expect(logged.expected_events).toBeUndefined();
  });

  it('logs an invalid user as a rejected attempt without copying the prompt', async () => {
    const { server, logger } = subject({ knownUser: false });
    const response = await request(server).post('/api/v1/piano/users/intruder/attempts').send({
      attempt_id: 'attempt-invalid-user', activity_id: 'sheet:bach:all:rh',
      prompt: { expected_events: [{ notes: [{ midi: 60 }] }] },
    });
    expect(response.status).toBe(400);
    expect(logger.warn).toHaveBeenCalledWith('piano.attempt.rejected', expect.objectContaining({
      attemptId: 'attempt-invalid-user', activityId: 'sheet:bach:all:rh', userId: 'intruder',
      persistence: 'rejected', validationErrors: ['invalid-user'],
    }));
    expect(logger.warn.mock.calls[0][1]).not.toHaveProperty('prompt');
  });

  it('logs an unavailable store as a failed persistence boundary', async () => {
    const { server, logger } = subject({ withStore: false });
    const response = await request(server).post('/api/v1/piano/users/learner4/attempts').send({
      attempt_id: 'attempt-no-store', activity_id: 'sheet:bach:all:rh',
    });
    expect(response.status).toBe(501);
    expect(logger.error).toHaveBeenCalledWith('piano.attempt.failed', expect.objectContaining({
      attemptId: 'attempt-no-store', activityId: 'sheet:bach:all:rh', userId: 'learner4',
      persistence: 'failed', persistenceDurationMs: 0, persistenceError: 'attempt-store-unavailable',
    }));
  });

  it('requires an authorized kiosk, household writer, or matching participant identity', async () => {
    const payload = {
      attempt_id: 'attempt-auth', activity_id: 'exercise:scale:free', purpose: 'practice',
      status: 'completed', score: 1, context: { surface: 'exercises' },
    };
    const anonymous = await request(subject({ roles: [] }).server)
      .post('/api/v1/piano/users/learner4/attempts').send(payload);
    expect(anonymous.status).toBe(401);

    const other = await request(subject({ roles: ['member'], user: { sub: 'agnes', roles: ['member'] } }).server)
      .post('/api/v1/piano/users/learner4/attempts').send(payload);
    expect(other.status).toBe(403);

    const selfSubject = subject({ roles: ['member'], user: { sub: 'learner4', roles: ['member'] } });
    const self = await request(selfSubject.server)
      .post('/api/v1/piano/users/learner4/attempts').send(payload);
    expect(self.status).toBe(201);
  });

  it('applies the same learner boundary when reading attempt history', async () => {
    const anonymous = await request(subject({ roles: [] }).server)
      .get('/api/v1/piano/users/learner4/attempts');
    expect(anonymous.status).toBe(401);
    const selfSubject = subject({ roles: ['member'], user: { sub: 'learner4', roles: ['member'] } });
    const self = await request(selfSubject.server).get('/api/v1/piano/users/learner4/attempts');
    expect(self.status).toBe(200);
    expect(self.body).toEqual({ attempts: [] });
  });

  it('allows guest persistence only for an authorized musical game challenge', async () => {
    const { server } = subject();
    const base = { attempt_id: 'guest-1', challenge_id: 'battle-1', purpose: 'challenge', status: 'completed', score: 1 };
    const practice = await request(server).post('/api/v1/piano/users/guest/attempts').send({
      ...base, purpose: 'practice', activity_id: 'guest-practice', context: { surface: 'exercises' },
    });
    expect(practice.status).toBe(400);
    expect(practice.body.details).toEqual(expect.arrayContaining(['guest-challenge-only', 'guest-surface-not-authorized']));

    const challenge = await request(server).post('/api/v1/piano/users/guest/attempts').send({
      ...base, context: { surface: 'piano-challenge' },
    });
    expect(challenge.status).toBe(201);
  });

  it('surfaces conflicting retries as an idempotency conflict', async () => {
    const { server, store, logger } = subject();
    store.save.mockImplementationOnce(() => {
      throw Object.assign(new Error('piano attempt idempotency conflict: attempt-conflict'), {
        code: 'idempotency_conflict', status: 409,
      });
    });
    const response = await request(server).post('/api/v1/piano/users/learner4/attempts').send({
      attempt_id: 'attempt-conflict', activity_id: 'sheet:bach:all:rh', purpose: 'practice',
      status: 'completed', score: 1, context: { surface: 'sheet-music-learn' },
    });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'idempotency_conflict' });
    expect(logger.warn).toHaveBeenCalledWith('piano.attempt.rejected', expect.objectContaining({
      persistence: 'rejected', validationErrors: ['idempotency_conflict'],
    }));
    expect(logger.error).not.toHaveBeenCalled();
  });
});
