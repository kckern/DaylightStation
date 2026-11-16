// @vitest-environment node
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createLanguageReelsRouter } from './languageReels.mjs';

describe('language reel grant identity', () => {
  it('allowlists attempt fields and takes both identities exclusively from the grant', async () => {
    let received;
    const service = { recordAttempt: (input) => { received = input; return { learnerId: input.userId, reelId: input.reelId, attempts: [] }; } };
    const grants = { verify: vi.fn(() => ({ ok: true, payload: { learnerId: 'assigned', reelId: '123' } })) };
    const app = express(); app.use(createLanguageReelsRouter({ service, grants }));
    const response = await request(app).post('/users/assigned/reels/123/attempts').set('X-School-Reel-Grant', 'signed').send({
      userId: 'sibling', learnerId: 'sibling', reelId: '456', type: 'cloze', itemId: 'fill', answer: 'hello', correct: true, completedAt: 'forged' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ learnerId: 'assigned', reelId: '123' });
    expect(received).toEqual({ userId: 'assigned', reelId: '123', type: 'cloze', itemId: 'fill', answer: 'hello' });
  });
});
