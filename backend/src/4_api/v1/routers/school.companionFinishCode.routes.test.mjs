/**
 * The one route that serves the finish code, and the reasons it is the only one.
 *
 * It lives under `/teacher`, it is a POST (so the capability cookie rides the
 * `pin` argument the way every other teacher write does, and so the reveal is
 * recorded rather than cached), and it answers `no-store`. A refused gate is a
 * 403 with the gate's own sentence and NOTHING about the code.
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSchoolRouter } from './school.mjs';

// The router matches refusals against the class COMPOSITION injects, never one
// it imports (a 4_api module may not reach into 2_domains). A local stand-in is
// therefore the honest double: it exercises the same `instanceof` mapping.
class GuestForbiddenError extends Error {}

function app(overrides = {}) {
  const server = express();
  server.use(express.json());
  server.use('/api/v1/school', createSchoolRouter({
    schoolService: {}, learnerDirectory: { listLearners: async () => [] },
    schoolErrors: { GuestForbiddenError },
    logger: { error() {} }, ...overrides,
  }));
  return server;
}

const REVEALED = {
  schema: 'school.companion-finish-code/v1', sessionId: 'ses_1', lessonId: 'cfm-w35-d1',
  gated: true, available: true, reason: null, finishCode: 'ACE', earned: false,
  satisfiedAt: null, satisfiedVia: null, codeRef: 'cmc_abc', revealedAt: '2026-08-27T15:30:00.000Z',
};

describe('POST /teacher/sessions/:sessionId/companion-finish-code', () => {
  it('reads the code out to a grown-up and never lets a cache keep it', async () => {
    const getCompanionFinishCode = { execute: vi.fn(async () => REVEALED) };
    await request(app({ getCompanionFinishCode }))
      .post('/api/v1/school/teacher/sessions/ses_1/companion-finish-code')
      .send({ revealedBy: 'kckern', pin: '1234' })
      .expect(200).expect('Cache-Control', 'no-store').expect(REVEALED);
    expect(getCompanionFinishCode.execute).toHaveBeenCalledWith({
      sessionId: 'ses_1', revealedBy: 'kckern', pin: '1234',
    });
  });

  it('carries the capability cookie into the gate when no PIN is typed', async () => {
    const getCompanionFinishCode = { execute: vi.fn(async () => REVEALED) };
    await request(app({ getCompanionFinishCode }))
      .post('/api/v1/school/teacher/sessions/ses_1/companion-finish-code')
      .set('Cookie', 'daylight_teacher_session=session-1')
      .set('X-Teacher-Step-Up', 'grant-1')
      .send({ revealedBy: 'kckern' })
      .expect(200);
    expect(getCompanionFinishCode.execute).toHaveBeenCalledWith({
      sessionId: 'ses_1', revealedBy: 'kckern',
      pin: { capabilityToken: 'session-1', stepUpToken: 'grant-1' },
    });
  });

  it('refuses without the teacher gate, and says nothing about the code', async () => {
    const getCompanionFinishCode = {
      execute: vi.fn(async () => { throw new GuestForbiddenError('The teacher PIN is missing or wrong.'); }),
    };
    const response = await request(app({ getCompanionFinishCode }))
      .post('/api/v1/school/teacher/sessions/ses_1/companion-finish-code')
      .send({ revealedBy: 'kckern', pin: 'wrong' })
      .expect(403);
    expect(response.body).toEqual({ error: 'The teacher PIN is missing or wrong.' });
    expect(JSON.stringify(response.body)).not.toContain('ACE');
  });

  it('404s when the reveal is not wired rather than pretending there is no code', async () => {
    await request(app())
      .post('/api/v1/school/teacher/sessions/ses_1/companion-finish-code')
      .send({ revealedBy: 'kckern' })
      .expect(404);
  });

  it('is not reachable by GET — the reveal is a recorded action, not a read', async () => {
    const getCompanionFinishCode = { execute: vi.fn(async () => REVEALED) };
    await request(app({ getCompanionFinishCode }))
      .get('/api/v1/school/teacher/sessions/ses_1/companion-finish-code')
      .expect(404);
    expect(getCompanionFinishCode.execute).not.toHaveBeenCalled();
  });
});
