import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createRubiksCubeRouter } from './rubiksCube.mjs';

function app({ grants = { verify: vi.fn(() => ({ ok: false })) }, service = { preview: vi.fn(() => ({ preview: true })) } } = {}) {
  const result = express(); result.use('/cube', createRubiksCubeRouter({ service, grants, revision: 3 })); return result;
}

describe('Rubik’s Cube router', () => {
  it('makes the first demonstration available as an untracked preview', async () => {
    const res = await request(app()).get('/cube/preview');
    expect(res.status).toBe(200); expect(res.body).toEqual({ preview: true });
  });

  it('rejects a course read without a current learner grant', async () => {
    const res = await request(app()).get('/cube/users/learner3/courses/beginner-v1');
    expect(res.status).toBe(403);
  });

  it('uses the grant learner, not the path claim, when opening a course', async () => {
    const service = { preview: vi.fn(), open: vi.fn(() => ({ course: true })) };
    const grants = { verify: vi.fn(() => ({ ok: true, payload: { learnerId: 'learner3', courseId: 'beginner-v1', revision: 3 } })) };
    const res = await request(app({ service, grants })).get('/cube/users/not-learner3/courses/beginner-v1').set('X-School-Cube-Grant', 'token');
    expect(res.status).toBe(200); expect(service.open).toHaveBeenCalledWith({ userId: 'learner3' });
  });

  it('binds physical-cube import to the learner named in the grant', async () => {
    const service = { preview: vi.fn(), importPhysicalCube: vi.fn(() => ({ physical: true })) };
    const grants = { verify: vi.fn(() => ({ ok: true, payload: { learnerId: 'learner3', courseId: 'beginner-v1', revision: 3 } })) };
    const faces = { U: Array(9).fill('white') };
    const res = await request(app({ service, grants })).post('/cube/users/not-learner3/courses/beginner-v1/physical/import').set('X-School-Cube-Grant', 'token').send({ faces });
    expect(res.status).toBe(200); expect(service.importPhysicalCube).toHaveBeenCalledWith({ userId: 'learner3', faces });
  });

  it('binds paper-packet creation to the learner named in the grant', async () => {
    const service = { preview: vi.fn(), generatePacket: vi.fn(async () => ({ packet: true })) };
    const grants = { verify: vi.fn(() => ({ ok: true, payload: { learnerId: 'learner3', courseId: 'beginner-v1', revision: 3 } })) };
    const res = await request(app({ service, grants })).post('/cube/users/not-learner3/courses/beginner-v1/packets').set('X-School-Cube-Grant', 'token').send({ lessonId: 'centres-and-pieces' });
    expect(res.status).toBe(200); expect(service.generatePacket).toHaveBeenCalledWith({ userId: 'learner3', lessonId: 'centres-and-pieces' });
  });
});
