// @vitest-environment node
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createLanguageReelsRouter } from './languageReels.mjs';

describe('language reel grant identity', () => {
  it('allowlists attempt fields and takes both identities exclusively from the grant', async () => {
    let received;
    const service = { getReel: () => ({ revision: 'current' }), recordAttempt: (input) => { received = input; return { learnerId: input.userId, reelId: input.reelId, attempts: [] }; } };
    const grants = { verify: vi.fn(() => ({ ok: true, payload: { learnerId: 'assigned', reelId: '123', revision: 'current' } })) };
    const app = express(); app.use(createLanguageReelsRouter({ service, grants }));
    const response = await request(app).post('/users/assigned/reels/123/attempts').set('X-School-Reel-Grant', 'signed').send({
      userId: 'sibling', learnerId: 'sibling', reelId: '456', type: 'cloze', itemId: 'fill', answer: 'hello', correct: true, completedAt: 'forged' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ learnerId: 'assigned', reelId: '123' });
    expect(received).toEqual({ userId: 'assigned', reelId: '123', type: 'cloze', itemId: 'fill', answer: 'hello' });
  });
});


it.each([
  ['get', '/users/assigned/reels/123'],
  ['post', '/users/assigned/reels/123/attempts'],
  ['post', '/users/assigned/reels/123/stages/listen'],
])('rejects a stale content grant before %s %s can mutate the current session', async (method, path) => {
  const mutations = [];
  const service = {
    getReel: () => ({ revision: 'current' }),
    open: () => { mutations.push('open'); return { revision: 'current', reel: {} }; },
    recordAttempt: () => { mutations.push('attempt'); return {}; },
    markStage: () => { mutations.push('stage'); return {}; },
  };
  const grants = { verify: () => ({ ok: true, payload: { learnerId: 'assigned', reelId: '123', revision: 'old' } }) };
  const app = express(); app.use(createLanguageReelsRouter({ service, grants }));
  const response = await request(app)[method](path).set('X-School-Reel-Grant', 'signed').send({ type: 'cloze', itemId: 'fill', answer: 'hello' });
  expect(response.status).toBe(403);
  expect(mutations).toEqual([]);
});
