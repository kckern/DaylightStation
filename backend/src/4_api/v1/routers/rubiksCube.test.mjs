import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createRubiksCubeRouter } from './rubiksCube.mjs';

function app({ grants = { verify: vi.fn(() => ({ ok: false })) }, service = { preview: vi.fn(() => ({ preview: true })) } } = {}) {
  const result = express(); result.use('/cube', createRubiksCubeRouter({ service, grants })); return result;
}

describe('Rubik’s Cube router', () => {
  it('makes the first demonstration available as an untracked preview', async () => {
    const res = await request(app()).get('/cube/preview');
    expect(res.status).toBe(200); expect(res.body).toEqual({ preview: true });
  });

  it('rejects a course read without a current learner grant', async () => {
    const res = await request(app()).get('/cube/users/milo/courses/beginner-v1');
    expect(res.status).toBe(403);
  });

  it('uses the grant learner, not the path claim, when opening a course', async () => {
    const service = { preview: vi.fn(), open: vi.fn(() => ({ course: true })) };
    const grants = { verify: vi.fn(() => ({ ok: true, payload: { learnerId: 'milo', courseId: 'beginner-v1', revision: 1 } })) };
    const res = await request(app({ service, grants })).get('/cube/users/not-milo/courses/beginner-v1').set('X-School-Cube-Grant', 'token');
    expect(res.status).toBe(200); expect(service.open).toHaveBeenCalledWith({ userId: 'milo' });
  });
});
