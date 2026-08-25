// @vitest-environment node
import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSchoolSelfServiceRouter } from '#api/v1/routers/school.selfservice.mjs';

const appFor = (overrides = {}) => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/school/self-service', createSchoolSelfServiceRouter({
    resolveAccessCode: {
      execute: async ({ code }) => ({ ok: true, schema: 'school.self-service-card/v2', code }),
    },
    runSelfServiceAction: {
      execute: async ({ code, action }) => ({ outcome: 'done', transition: 'message', code, action }),
    },
    ...overrides,
  }));
  return app;
};

describe('school self-service router', () => {
  it('keeps resolve and act private and carries the additive v2 contract unchanged', async () => {
    const app = appFor();
    const resolved = await request(app)
      .post('/api/v1/school/self-service/resolve')
      .send({ code: '481920' });
    expect(resolved.status).toBe(200);
    expect(resolved.headers['cache-control']).toBe('no-store');
    expect(resolved.body).toMatchObject({
      ok: true, schema: 'school.self-service-card/v2', code: '481920',
    });

    const acted = await request(app)
      .post('/api/v1/school/self-service/act')
      .send({ code: '481920', action: 'print' });
    expect(acted.status).toBe(200);
    expect(acted.headers['cache-control']).toBe('no-store');
    expect(acted.body).toMatchObject({
      outcome: 'done', transition: 'message', code: '481920', action: 'print',
    });
  });

  it('serves only poster bytes from the learner-safe curriculum route', async () => {
    const calls = [];
    const app = appFor({
      curriculum: {
        getCoursePoster: async (courseId) => {
          calls.push(courseId);
          return courseId === 'fractions' ? Buffer.from('jpeg-poster') : null;
        },
      },
    });

    const response = await request(app)
      .get('/api/v1/school/self-service/curriculum/fractions/poster.jpg');

    expect(response.status).toBe(200);
    expect(calls).toEqual(['fractions']);
    expect(response.headers['content-type']).toMatch(/^image\/jpeg/);
    expect(response.headers['cache-control']).toBe('private, max-age=3600');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.body).toEqual(Buffer.from('jpeg-poster'));
  });

  it('uses the generated poster fallback without exposing another curriculum payload', async () => {
    const app = appFor({
      curriculum: { getCoursePoster: async () => null },
      renderCoursePosterFallback: (courseId) => Buffer.from(`fallback:${courseId}`),
    });

    const response = await request(app)
      .get('/api/v1/school/self-service/curriculum/missing-course/poster.jpg');

    expect(response.status).toBe(200);
    expect(response.headers['x-school-poster-fallback']).toBe('missing-asset');
    expect(response.body).toEqual(Buffer.from('fallback:missing-course'));
  });

  it('does not mount the artwork route without curriculum access', async () => {
    const response = await request(appFor())
      .get('/api/v1/school/self-service/curriculum/fractions/poster.jpg');
    expect(response.status).toBe(404);
  });
});
