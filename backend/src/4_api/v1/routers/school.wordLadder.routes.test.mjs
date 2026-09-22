import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSchoolTestRouter as createSchoolRouter } from '../../../../../tests/_lib/school/schoolRouterTestSupport.mjs';
import { GuestForbiddenError } from '#domains/school/errors.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

const PLAN = { day: '2026-09-22', checks: [], study: [], review: [], deckCards: [], remaining: { checks: 0, study: 0, review: 0 }, doneToday: true, progressLabel: 'Done for today' };

function app(wordLadderStudy, extra = {}) {
  const server = express();
  server.use(express.json());
  server.use('/api/v1/school', createSchoolRouter({
    schoolService: {}, learnerDirectory: { listLearners: async () => [] },
    schoolErrors: { GuestForbiddenError }, logger: { error() {} }, wordLadderStudy, ...extra,
  }));
  return server;
}

describe('/api/v1/school/word-ladder', () => {
  it('404s when the word ladder is not wired', async () => {
    await request(app(null)).post('/api/v1/school/word-ladder/open').send({ userId: 'kid', deckId: 'd' }).expect(404);
  });
  it('opens a session and never caches it', async () => {
    const service = { open: vi.fn(async () => ({ sessionId: 'korean-vocab.s1', day: '2026-09-22', deckId: 'd', folded: 0, plan: PLAN })) };
    const res = await request(app(service)).post('/api/v1/school/word-ladder/open').send({ userId: 'kid', deckId: 'language/korean/week-01-classroom' }).expect(200);
    expect(service.open).toHaveBeenCalledWith({ userId: 'kid', deckId: 'language/korean/week-01-classroom' });
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body.sessionId).toBe('korean-vocab.s1');
  });
  it('maps a missing assignment to 403 and a bad request to 400', async () => {
    const refusing = { open: vi.fn(async () => { throw new GuestForbiddenError('no assignment'); }) };
    await request(app(refusing)).post('/api/v1/school/word-ladder/open').send({ userId: 'kid', deckId: 'd' }).expect(403);
    const invalid = { answerCheck: vi.fn(async () => { throw new ValidationError('choice is not one of the offered answers'); }) };
    await request(app(invalid)).post('/api/v1/school/word-ladder/korean-vocab.s1/checks/gawi').send({ userId: 'kid', choice: 'x' }).expect(400);
  });
  it('passes checks, marks, plan reads and review views through', async () => {
    const service = {
      plan: vi.fn(async () => ({ sessionId: 'korean-vocab.s1', plan: PLAN })),
      answerCheck: vi.fn(async () => ({ correct: true, plan: PLAN })),
      markCard: vi.fn(async () => ({ state: 'claimed', plan: PLAN })),
      viewReviewCard: vi.fn(async () => ({ wordId: 'gawi', logged: true })),
    };
    const server = app(service);
    await request(server).get('/api/v1/school/word-ladder/korean-vocab.s1/plan?userId=kid').expect(200);
    expect(service.plan).toHaveBeenCalledWith({ userId: 'kid', sessionId: 'korean-vocab.s1' });
    await request(server).post('/api/v1/school/word-ladder/korean-vocab.s1/checks/gawi').send({ userId: 'kid', choice: 'Scissors' }).expect(200);
    expect(service.answerCheck).toHaveBeenCalledWith({ userId: 'kid', sessionId: 'korean-vocab.s1', wordId: 'gawi', choice: 'Scissors' });
    await request(server).post('/api/v1/school/word-ladder/korean-vocab.s1/cards/gawi/mark').send({ userId: 'kid', mark: 'know', recording: { status: 'unavailable', reason: 'denied' } }).expect(200);
    expect(service.markCard).toHaveBeenCalledWith({ userId: 'kid', sessionId: 'korean-vocab.s1', wordId: 'gawi', mark: 'know', recording: { status: 'unavailable', reason: 'denied' } });
    await request(server).post('/api/v1/school/word-ladder/korean-vocab.s1/review/gawi').send({ userId: 'kid' }).expect(200);
    expect(service.viewReviewCard).toHaveBeenCalledWith({ userId: 'kid', sessionId: 'korean-vocab.s1', wordId: 'gawi' });
  });
  it('accepts a raw audio body for a take and streams the latest take back', async () => {
    const service = {
      saveRecording: vi.fn(async ({ buffer }) => ({ wordId: 'gawi', take: 1, bytes: buffer.length, plan: PLAN })),
      latestRecording: vi.fn(async () => ({ resource: { body: 'TAKE' }, contentType: 'audio/webm' })),
    };
    const server = app(service, { sendFileResource: (req, res, resource) => res.send(resource.body) });
    const res = await request(server).post('/api/v1/school/word-ladder/korean-vocab.s1/cards/gawi/recording?userId=kid&ext=webm')
      .set('Content-Type', 'audio/webm;codecs=opus').send(Buffer.from('abcde')).expect(200);
    expect(res.body.bytes).toBe(5);
    expect(service.saveRecording).toHaveBeenCalledWith(expect.objectContaining({ userId: 'kid', sessionId: 'korean-vocab.s1', wordId: 'gawi', ext: 'webm' }));
    const latest = await request(server).get('/api/v1/school/word-ladder/korean-vocab.s1/cards/gawi/recording/latest?userId=kid').expect(200);
    expect(latest.headers['content-type']).toMatch(/audio\/webm/);
    expect(latest.headers['cache-control']).toBe('private, no-store');
  });
  it('runs the teacher fold', async () => {
    const service = { fold: vi.fn(async () => ({ learnerId: 'kid', folded: 2, demoted: ['gawi'] })) };
    const res = await request(app(service)).post('/api/v1/school/word-ladder/fold').send({ learnerId: 'kid', actorId: 'parent' }).expect(200);
    expect(res.body).toEqual({ learnerId: 'kid', folded: 2, demoted: ['gawi'] });
    expect(service.fold).toHaveBeenCalledWith({ learnerId: 'kid', actorId: 'parent', pin: null });
  });
});
