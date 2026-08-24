import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSchoolRouter } from './school.mjs';

function app(overrides = {}) {
  const server = express();
  server.use(express.json());
  server.use('/api/v1/school', createSchoolRouter({
    schoolService: {}, learnerDirectory: { listLearners: async () => [] },
    logger: { error() {} }, ...overrides,
  }));
  return server;
}

describe('teacher workspace routes', () => {
  it('serves timeline and session-inspector read models without caching', async () => {
    const getLearnerTimeline = { execute: vi.fn(async (args) => ({ learnerId: args.learnerId, items: [] })) };
    const getTeacherSession = { execute: vi.fn(async (args) => ({ sessionId: args.sessionId, revision: 4 })) };
    await request(app({ getLearnerTimeline, getTeacherSession }))
      .get('/api/v1/school/teacher/learners/kid/timeline?limit=20&unitId=math').expect(200)
      .expect('Cache-Control', 'no-store').expect({ learnerId: 'kid', items: [] });
    await request(app({ getLearnerTimeline, getTeacherSession }))
      .get('/api/v1/school/teacher/sessions/ses_1').expect(200)
      .expect({ sessionId: 'ses_1', revision: 4 });
  });

  it('keeps grade writes preview-first and forwards explicit apply', async () => {
    const adjustSessionGrade = { execute: vi.fn(async (args) => ({ applied: args.apply, sessionId: args.sessionId })) };
    await request(app({ adjustSessionGrade })).post('/api/v1/school/teacher/sessions/ses_1/grade-adjustments')
      .send({ percent: 100, reason: 'eraser', adjustedBy: 'parent' }).expect(200)
      .expect({ applied: false, sessionId: 'ses_1' });
    await request(app({ adjustSessionGrade })).post('/api/v1/school/teacher/sessions/ses_1/grade-adjustments')
      .send({ percent: 100, reason: 'eraser', adjustedBy: 'parent', apply: true }).expect(201)
      .expect({ applied: true, sessionId: 'ses_1' });
  });

  it('forwards the Idempotency-Key on a real agenda dispatch', async () => {
    const teacherAgendaDispatch = { execute: vi.fn(async (args) => ({ printed: true, idempotencyKey: args.idempotencyKey })) };
    await request(app({ teacherAgendaDispatch })).post('/api/v1/school/teacher/learners/kid/agenda/dispatch')
      .set('Idempotency-Key', 'agenda-123').send({ dispatchedBy: 'parent', pin: '1234' }).expect(201)
      .expect({ printed: true, idempotencyKey: 'agenda-123' });
    expect(teacherAgendaDispatch.execute).toHaveBeenCalledWith(expect.objectContaining({ learnerId: 'kid', idempotencyKey: 'agenda-123' }));
  });

  it('serves retained original PDF bytes', async () => {
    const issuedArtifactStore = { get: vi.fn(async () => ({ manifest: { artifactId: 'art_1' }, bytes: Buffer.from('%PDF exact') })) };
    await request(app({ issuedArtifactStore })).get('/api/v1/school/teacher/artifacts/art_1/original.pdf')
      .expect(200).expect('Content-Type', /application\/pdf/).expect((response) => {
        expect(Buffer.compare(response.body, Buffer.from('%PDF exact'))).toBe(0);
      });
  });

  it('renders a postview from retained bytes plus the linked session evidence', async () => {
    const issuedArtifactStore = { get: vi.fn(async () => ({ manifest: { artifactId: 'art_1', sessionId: 'ses_1' }, bytes: Buffer.from('%PDF original') })) };
    const getTeacherSession = { execute: vi.fn(async () => ({ sessionId: 'ses_1', state: { gradedPercent: 90 } })) };
    const renderArtifactPostview = vi.fn(async () => ({ pdf: Buffer.from('%PDF postview') }));
    await request(app({ issuedArtifactStore, getTeacherSession, renderArtifactPostview }))
      .get('/api/v1/school/teacher/artifacts/art_1/postview.pdf').expect(200).expect('Content-Type', /application\/pdf/);
    expect(renderArtifactPostview).toHaveBeenCalledWith(expect.objectContaining({
      originalPdf: Buffer.from('%PDF original'), session: expect.objectContaining({ sessionId: 'ses_1' }),
    }));
  });
});
