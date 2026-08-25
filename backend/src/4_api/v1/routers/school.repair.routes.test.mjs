/**
 * Route-level net for the wave-5 repair endpoints (the M4 lesson: every new
 * route gets a router-constructed test so an app.mjs deps-drop cannot ship
 * silently).
 */
import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSchoolRouter } from './school.mjs';
import { GuestForbiddenError } from '#domains/school/errors.mjs';

const silent = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() };

function appWith(over = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/school', createSchoolRouter({
    schoolErrors: { GuestForbiddenError },
    schoolService: { listBankSourceSummaries: () => [] },
    attestationLog: { list: vi.fn(() => [{ id: 'att_1', learnerId: 'felix', unitId: 'u1' }]) },
    recordAttestation: { execute: vi.fn(async (args) => ({ entry: { id: 'att_2', ...args } })) },
    teacherNotesStore: { list: vi.fn(() => [{ id: 'note_1', learnerId: 'felix', note: 'Hi', from: 'kckern', at: 't' }]) },
    recordTeacherNote: { execute: vi.fn(async (args) => ({ entry: { id: 'note_2', ...args } })) },
    reassignEvidence: { execute: vi.fn(async (args) => {
      if (args.pin !== '7410') throw new GuestForbiddenError('The teacher PIN is missing or wrong.');
      return { moved: 3, ...args };
    }) },
    attemptsStore: { readAttemptDay: vi.fn(() => [
      { sessionId: 'ses_1', itemId: 'q1', at: '2026-08-06T10:00:00Z', bankId: 'creature-quiz-1' },
      { sessionId: 'ses_1', itemId: 'q2', at: '2026-08-06T10:01:00Z', bankId: 'creature-quiz-1' },
      { provenance: { recordId: 'card_9' }, itemId: 'q1', at: '2026-08-06T11:00:00Z' },
    ]) },
    reviewQueue: { listForLearner: vi.fn(async () => [
      { itemId: 'q3', sessionId: 'ses_1', verdict: 'correct', note: 'Nice', gradedAt: '2026-08-06T09:00:00Z' },
    ]) },
    logger: silent,
    ...over,
  }));
  return app;
}

describe('wave-5 repair routes', () => {
  it('GET/POST /attestations round-trip', async () => {
    const app = appWith();
    expect((await request(app).get('/api/v1/school/attestations?learnerId=felix')).body.entries.length).toBe(1);
    const res = await request(app).post('/api/v1/school/attestations')
      .send({ learnerId: 'felix', unitId: 'u1', reason: 'r', attestedBy: 'kckern', pin: '7410' });
    expect(res.status).toBe(201);
    expect(res.body.entry.learnerId).toBe('felix');
  });

  it('GET/POST /teacher-notes round-trip', async () => {
    const app = appWith();
    expect((await request(app).get('/api/v1/school/teacher-notes?learnerId=felix')).body.entries.length).toBe(1);
    const res = await request(app).post('/api/v1/school/teacher-notes')
      .send({ learnerId: 'felix', note: 'Hello', from: 'kckern', pin: '7410' });
    expect(res.status).toBe(201);
  });

  it('GET /attempts-summary groups by assessment (sessionId ?? provenance.recordId)', async () => {
    const res = await request(appWith()).get('/api/v1/school/attempts-summary?learnerId=felix&day=2026-08-06');
    expect(res.status).toBe(200);
    expect(res.body.assessments).toEqual(expect.arrayContaining([
      expect.objectContaining({ assessmentId: 'ses_1', count: 2, bankId: 'creature-quiz-1' }),
      expect.objectContaining({ assessmentId: 'card_9', count: 1 }),
    ]));
  });

  it('POST /reassign forwards the pin and maps a refusal to 403', async () => {
    const app = appWith();
    const okRes = await request(app).post('/api/v1/school/reassign')
      .send({ fromLearnerId: 'felix', toLearnerId: 'milo', day: '2026-08-06', assessmentId: 'ses_1', reassignedBy: 'kckern', pin: '7410' });
    expect(okRes.status).toBe(200);
    expect(okRes.body.moved).toBe(3);
    const badRes = await request(app).post('/api/v1/school/reassign')
      .send({ fromLearnerId: 'felix', toLearnerId: 'milo', day: '2026-08-06', assessmentId: 'ses_1', reassignedBy: 'kckern', pin: '0' });
    expect(badRes.status).toBe(403);
  });

  it('GET /review/learner merges standalone notes as kind:note, newest first', async () => {
    const res = await request(appWith({
      teacherNotesStore: { list: vi.fn(() => [{ id: 'note_1', learnerId: 'felix', note: 'Great week!', from: 'kckern', at: '2026-08-06T12:00:00Z' }]) },
    })).get('/api/v1/school/review/learner/felix');
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ kind: 'note', note: 'Great week!' });
    expect(res.body[1]).toMatchObject({ itemId: 'q3', verdict: 'correct' });
  });

  it('unwired repair endpoints answer honest shapes', async () => {
    const app = appWith({ attestationLog: null, recordAttestation: null, teacherNotesStore: null, recordTeacherNote: null, reassignEvidence: null, attemptsStore: null });
    expect((await request(app).get('/api/v1/school/attestations?learnerId=x')).body).toEqual({ entries: [] });
    expect((await request(app).post('/api/v1/school/attestations').send({})).status).toBe(404);
    expect((await request(app).post('/api/v1/school/reassign').send({})).status).toBe(404);
    expect((await request(app).get('/api/v1/school/attempts-summary?learnerId=x&day=2026-08-06')).body).toEqual({ assessments: [] });
  });
});
