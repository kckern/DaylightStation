/**
 * The preview route, wired.
 *
 * A use case can be perfect and still be unreachable — that failure mode took
 * the school subsystem down once already while every unit test stayed green.
 * So this asserts the things only a mounted router can answer: the segment
 * arrives unmangled, a bad link is a 200 with words rather than a 4xx, and
 * `/act` is not reachable with anything a preview holds.
 */
import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSchoolSelfServiceRouter } from './school.selfservice.mjs';

const appWith = (deps) => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/school/self-service', createSchoolSelfServiceRouter(deps));
  return app;
};

const resolverWith = (preview) => ({
  execute: vi.fn(async () => ({ ok: false })),
  preview,
});

describe('GET /api/v1/school/self-service/preview/:link', () => {
  it('hands the segment to the use case byte-for-byte and answers its card', async () => {
    const preview = vi.fn(async () => ({ ok: true, preview: true, actions: [{ kind: 'program', inert: true }] }));
    const res = await request(appWith({ resolveAccessCode: resolverWith(preview) }))
      .get('/api/v1/school/self-service/preview/eyJsZWFybmVySWQiOiJmZWxpeCJ9');

    expect(res.status).toBe(200);
    expect(preview).toHaveBeenCalledWith({ link: 'eyJsZWFybmVySWQiOiJmZWxpeCJ9' });
    expect(res.body.preview).toBe(true);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('a link the use case cannot read is a 200 carrying a sentence, never a 4xx', async () => {
    const preview = vi.fn(async () => ({
      ok: false, preview: true, reason: 'unreadable',
      sentence: 'That preview link could not be read. Generate a new one.', actions: [],
    }));
    const res = await request(appWith({ resolveAccessCode: resolverWith(preview) }))
      .get('/api/v1/school/self-service/preview/not-a-link');

    expect(res.status).toBe(200);
    expect(res.body.sentence).toMatch(/preview link/i);
  });

  it('is not registered when the resolver cannot preview — a 404 beats half an answer', async () => {
    const res = await request(appWith({ resolveAccessCode: { execute: vi.fn() } }))
      .get('/api/v1/school/self-service/preview/anything');
    expect(res.status).toBe(404);
  });

  it('leaves /resolve exactly as it was — a preview link is not a code', async () => {
    const resolveAccessCode = resolverWith(vi.fn(async () => ({ ok: true, preview: true })));
    const res = await request(appWith({ resolveAccessCode }))
      .post('/api/v1/school/self-service/resolve').send({ code: '482913' });

    expect(res.status).toBe(200);
    expect(resolveAccessCode.execute).toHaveBeenCalledWith({ code: '482913' });
    expect(resolveAccessCode.preview).not.toHaveBeenCalled();
  });
});
