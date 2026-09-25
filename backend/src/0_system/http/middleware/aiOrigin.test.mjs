import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { aiOriginMiddleware, normalizeOriginPath } from './aiOrigin.mjs';
import { currentOrigin } from '../../runtime/aiContext.mjs';

describe('normalizeOriginPath', () => {
  it.each([
    ['/api/v1/health/log', '/api/v1/health/log'],
    ['/api/v1/health/log?date=2026-09-25&user=alice', '/api/v1/health/log'],
    ['/api/v1/items/12345', '/api/v1/items/:id'],
    ['/api/v1/runs/3f2b8c1e-9a4d-4e2f-8b1a-0c9d8e7f6a5b/detail', '/api/v1/runs/:id/detail'],
    ['/api/v1/photo/a1b2c3d4e5f6a7b8', '/api/v1/photo/:id'],
    ['/api/v1/health/day/2026-09-25', '/api/v1/health/day/:id'],
    ['/api/v1/journal/20260925', '/api/v1/journal/:id'],
    ['/api/v1/users/alice%40example.com/prefs', '/api/v1/users/:id/prefs'],
    ['/api/v1/agents/turn1234abcd', '/api/v1/agents/:id'],
    ['/api/v1/nutribot/webhook#frag', '/api/v1/nutribot/webhook'],
    ['/', '/'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeOriginPath(input)).toBe(expected);
  });

  it('keeps short words that carry a digit, like the api version', () => {
    expect(normalizeOriginPath('/api/v1/ai-usage')).toBe('/api/v1/ai-usage');
  });

  it('caps a very long path', () => {
    const long = '/api/' + 'segment/'.repeat(60);
    expect(normalizeOriginPath(long).length).toBeLessThanOrEqual(201);
  });
});

describe('aiOriginMiddleware', () => {
  function app() {
    const a = express();
    a.use(express.json());
    a.use(aiOriginMiddleware());
    a.post('/api/v1/health/log/:id', async (req, res) => {
      await new Promise((r) => setTimeout(r, 2));
      res.json({ origin: currentOrigin(), body: req.body });
    });
    const router = express.Router();
    router.get('/day/:date', (req, res) => res.json({ origin: currentOrigin() }));
    a.use('/api/v1/health', router);
    return a;
  }

  it('runs a handler (after body parsing and an await) under the request origin', async () => {
    const res = await request(app()).post('/api/v1/health/log/98765?x=1').send({ a: 1 });
    expect(res.body).toEqual({ origin: 'http:POST /api/v1/health/log/:id', body: { a: 1 } });
  });

  it('reaches handlers in mounted routers', async () => {
    const res = await request(app()).get('/api/v1/health/day/2026-09-25');
    expect(res.body.origin).toBe('http:GET /api/v1/health/day/:id');
  });

  it('survives a route-level body parser that reads the stream after the middleware', async () => {
    const a = express();
    a.use(aiOriginMiddleware());
    a.post('/api/v1/language/answer', express.raw({ type: 'audio/ogg', limit: '10mb' }),
      (req, res) => res.json({ origin: currentOrigin(), bytes: req.body.length }));
    const res = await request(a).post('/api/v1/language/answer').set('content-type', 'audio/ogg').send(Buffer.alloc(300_000));
    expect(res.body).toEqual({ origin: 'http:POST /api/v1/language/answer', bytes: 300_000 });
  });

  it('leaves no origin behind once the request is done', async () => {
    await request(app()).get('/api/v1/health/day/2026-09-25');
    expect(currentOrigin()).toBeNull();
  });
});
