import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSchoolTestRouter as createSchoolRouter } from '../../../../../tests/_lib/school/schoolRouterTestSupport.mjs';
import { GuestForbiddenError } from '#domains/school/errors.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

function app(cardLadderStudy, extra = {}) {
  const server = express();
  server.use(express.json());
  server.use('/api/v1/school', createSchoolRouter({
    schoolService: {}, learnerDirectory: { listLearners: async () => [] },
    schoolErrors: { GuestForbiddenError }, logger: { error() {} }, cardLadderStudy, ...extra,
  }));
  return server;
}

describe('/api/v1/school/card-ladder (through the School router)', () => {
  it('404s when the card ladder (or its test mode) is not wired', async () => {
    await request(app(null)).post('/api/v1/school/card-ladder/open').send({ userId: 'kid', deckId: 'd' }).expect(404);
    const live = { open: vi.fn() };
    await request(app(live)).post('/api/v1/school/card-ladder/test/open').send({ userId: 'kid', deckId: 'd' }).expect(404);
    expect(live.open).not.toHaveBeenCalled();
  });
  it('opens a sitting and never caches it', async () => {
    const service = { open: vi.fn(async () => ({ sittingId: 'korean-vocab.live.1', item: { id: 'i1' } })) };
    const res = await request(app(service)).post('/api/v1/school/card-ladder/open')
      .send({ userId: 'kid', deckId: 'language/korean/week-01-classroom' }).expect(200);
    expect(service.open).toHaveBeenCalledWith({ userId: 'kid', deckId: 'language/korean/week-01-classroom' });
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body.sittingId).toBe('korean-vocab.live.1');
  });
  it('maps a missing assignment to 403 and a bad response to 400', async () => {
    const refusing = { open: vi.fn(async () => { throw new GuestForbiddenError('no assignment'); }) };
    await request(app(refusing)).post('/api/v1/school/card-ladder/open').send({ userId: 'kid', deckId: 'd' }).expect(403);
    const invalid = { respond: vi.fn(async () => { throw new ValidationError('item is not current'); }) };
    await request(app(invalid)).post('/api/v1/school/card-ladder/sittings/korean-vocab.live.1/items/i9')
      .send({ userId: 'kid', response: {} }).expect(400);
  });
  it('serves the test mode, the stage screen and the teacher fold', async () => {
    const live = { fold: vi.fn(async () => ({ learnerId: 'kid', folded: 2, demoted: ['gawi'] })) };
    const test = { open: vi.fn(async () => ({ sittingId: 'test.korean-vocab.t.1' })) };
    const server = app(live, { cardLadderTest: test, cardLadderStageScreen: 'portal' });
    await request(server).post('/api/v1/school/card-ladder/test/open').send({ userId: 'kid', deckId: 'd', scenario: 'fresh' }).expect(200);
    expect(test.open).toHaveBeenCalledWith({ userId: 'kid', deckId: 'd', scenario: 'fresh' });
    expect((await request(server).get('/api/v1/school/card-ladder/stage').expect(200)).body).toEqual({ screen: 'portal' });
    const res = await request(server).post('/api/v1/school/card-ladder/fold').send({ learnerId: 'kid', actorId: 'parent' }).expect(200);
    expect(res.body).toEqual({ learnerId: 'kid', folded: 2, demoted: ['gawi'] });
    expect(live.fold).toHaveBeenCalledWith({ learnerId: 'kid', actorId: 'parent', pin: null });
  });
});
