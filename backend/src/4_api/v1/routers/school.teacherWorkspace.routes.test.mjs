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

const activeCapability = () => ({ status: vi.fn(() => ({ active: true, userId: 'parent' })), authorize: vi.fn(() => true) });
const teacherCookie = (test) => test.set('Cookie', 'daylight_teacher_session=session-1');

describe('teacher workspace routes', () => {
  it('serves timeline and session-inspector read models without caching', async () => {
    const getLearnerTimeline = { execute: vi.fn(async (args) => ({ learnerId: args.learnerId, items: [] })) };
    const getTeacherSession = { execute: vi.fn(async (args) => ({ sessionId: args.sessionId, revision: 4 })) };
    await teacherCookie(request(app({ getLearnerTimeline, getTeacherSession, teacherCapabilitySessions: activeCapability() }))
      .get('/api/v1/school/teacher/learners/kid/timeline?limit=20&unitId=math')).expect(200)
      .expect('Cache-Control', 'no-store').expect({ learnerId: 'kid', items: [] });
    await teacherCookie(request(app({ getLearnerTimeline, getTeacherSession, teacherCapabilitySessions: activeCapability() }))
      .get('/api/v1/school/teacher/sessions/ses_1')).expect(200)
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
    await teacherCookie(request(app({ issuedArtifactStore, teacherCapabilitySessions: activeCapability() })).get('/api/v1/school/teacher/artifacts/art_1/original.pdf'))
      .expect(200).expect('Content-Type', /application\/pdf/).expect((response) => {
        expect(Buffer.compare(response.body, Buffer.from('%PDF exact'))).toBe(0);
      });
  });

  it('refuses teacher history and original artifacts while the teacher session is locked', async () => {
    const teacherCapabilitySessions = { status: vi.fn(() => ({ active: false })) };
    await request(app({ getLearnerTimeline: { execute: vi.fn() }, teacherCapabilitySessions }))
      .get('/api/v1/school/teacher/learners/kid/timeline').expect(403);
    await request(app({ issuedArtifactStore: { get: vi.fn() }, teacherCapabilitySessions }))
      .get('/api/v1/school/teacher/artifacts/art_1/original.pdf').expect(403);
  });

  it('gates and attributes a teacher-opened remediation session', async () => {
    const teacherGate = { assert: vi.fn() };
    const openRemediation = { execute: vi.fn(async (args) => ({ status: 'opened', ...args })) };
    await request(app({ teacherGate, openRemediation })).post('/api/v1/school/teacher/sessions/ses_1/remediation')
      .send({ openedBy: 'parent', pin: '4321' }).expect(201);
    expect(teacherGate.assert).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'parent', pin: '4321', action: 'sessions.remediation.open', context: { sessionId: 'ses_1' },
    }));
    expect(openRemediation.execute).toHaveBeenCalledWith({ sessionId: 'ses_1', openedBy: 'parent' });
  });

  it('renders a postview from retained bytes plus the linked session evidence', async () => {
    const issuedArtifactStore = { get: vi.fn(async () => ({ manifest: { artifactId: 'art_1', sessionId: 'ses_1' }, bytes: Buffer.from('%PDF original') })) };
    const getTeacherSession = { execute: vi.fn(async () => ({ sessionId: 'ses_1', state: { gradedPercent: 90 } })) };
    const renderArtifactPostview = vi.fn(async () => ({ pdf: Buffer.from('%PDF postview') }));
    const teacherCapabilitySessions = { status: vi.fn(() => ({ active: true, userId: 'parent' })), authorize: vi.fn(() => true) };
    await request(app({ issuedArtifactStore, getTeacherSession, renderArtifactPostview, teacherCapabilitySessions }))
      .get('/api/v1/school/teacher/artifacts/art_1/postview.pdf')
      .set('Cookie', 'daylight_teacher_session=session-1').set('X-Teacher-Step-Up', 'grant-1')
      .expect(200).expect('Content-Type', /application\/pdf/);
    expect(renderArtifactPostview).toHaveBeenCalledWith(expect.objectContaining({
      originalPdf: Buffer.from('%PDF original'), session: expect.objectContaining({ sessionId: 'ses_1' }),
    }));
  });

  it('sets/clears a strict HttpOnly session cookie and exposes status', async () => {
    const teacherCapabilitySessions = {
      unlock: vi.fn(() => ({ capabilityToken: 'secret-token', userId: 'parent', idleExpiresAt: 'idle', absoluteExpiresAt: 'absolute' })),
      status: vi.fn(() => ({ active: true, userId: 'parent' })), lock: vi.fn(() => ({ locked: true })),
    };
    const unlocked = await request(app({ teacherCapabilitySessions })).post('/api/v1/school/teacher/auth/unlock')
      .send({ userId: 'parent', pin: '4321' }).expect(200);
    expect(unlocked.headers['set-cookie'][0]).toMatch(/daylight_teacher_session=secret-token;.*HttpOnly; SameSite=Strict/);
    expect(unlocked.body).not.toHaveProperty('capabilityToken');
    await request(app({ teacherCapabilitySessions })).get('/api/v1/school/teacher/auth/status')
      .set('Cookie', 'daylight_teacher_session=secret-token').expect(200).expect({ active: true, userId: 'parent' });
    const locked = await request(app({ teacherCapabilitySessions })).post('/api/v1/school/teacher/auth/lock')
      .set('Cookie', 'daylight_teacher_session=secret-token').expect(200);
    expect(locked.headers['set-cookie'][0]).toMatch(/Max-Age=0/);
  });

  it('marks the capability cookie Secure when the request arrived over HTTPS', async () => {
    const teacherCapabilitySessions = {
      unlock: vi.fn(() => ({ capabilityToken: 'secret-token', userId: 'parent' })),
    };
    const response = await request(app({ teacherCapabilitySessions })).post('/api/v1/school/teacher/auth/unlock')
      .set('X-Forwarded-Proto', 'https').send({ userId: 'parent', pin: '4321' }).expect(200);
    expect(response.headers['set-cookie'][0]).toMatch(/; Secure$/);
  });

  it('refuses a postview without an active resource-scoped grant', async () => {
    const issuedArtifactStore = { get: vi.fn(async () => ({ manifest: { sessionId: 'ses_1' }, bytes: Buffer.from('%PDF') })) };
    const renderArtifactPostview = vi.fn();
    const teacherCapabilitySessions = { status: vi.fn(() => ({ active: true, userId: 'parent' })), authorize: vi.fn(() => false) };
    await request(app({ issuedArtifactStore, getTeacherSession: { execute: vi.fn() }, renderArtifactPostview, teacherCapabilitySessions }))
      .get('/api/v1/school/teacher/artifacts/art_1/postview.pdf')
      .set('Cookie', 'daylight_teacher_session=session-1').expect(403);
    expect(renderArtifactPostview).not.toHaveBeenCalled();
  });

  it('passes cookie capability and one-use step-up headers through the existing pin argument', async () => {
    const adjustSessionGrade = { execute: vi.fn(async () => ({ applied: true })) };
    await request(app({ adjustSessionGrade })).post('/api/v1/school/teacher/sessions/ses_1/grade-adjustments')
      .set('Cookie', 'daylight_teacher_session=session-1').set('X-Teacher-Step-Up', 'grant-1')
      .send({ percent: 100, reason: 'fix', adjustedBy: 'parent', apply: true }).expect(201);
    expect(adjustSessionGrade.execute).toHaveBeenCalledWith(expect.objectContaining({
      pin: { capabilityToken: 'session-1', stepUpToken: 'grant-1' },
    }));
  });
});
