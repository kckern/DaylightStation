import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { exceptPaths } from './exceptPaths.mjs';

function build() {
  const app = express();
  const selfGuarded = exceptPaths(['/api/v1/journalist/memo']);
  app.use(selfGuarded((req, res, next) => { res.setHeader('X-Ran', 'yes'); next(); }));
  app.use(selfGuarded(express.json()));
  app.use((req, res) => res.json({ ran: res.getHeader('X-Ran') ?? null, body: req.body ?? null }));
  return app;
}

describe('exceptPaths', () => {
  it('runs the middleware for every other path', async () => {
    const res = await request(build()).post('/api/v1/journalist/trigger').send({ a: 1 });
    expect(res.body).toEqual({ ran: 'yes', body: { a: 1 } });
  });

  it('skips the middleware for a listed path, so its body is left unread', async () => {
    const res = await request(build()).post('/api/v1/journalist/memo').send({ a: 1 });
    expect(res.body).toEqual({ ran: null, body: null });
  });

  it('matches the way the router does: any case, a trailing slash, a query string', async () => {
    for (const url of ['/API/v1/Journalist/MEMO', '/api/v1/journalist/memo/', '/api/v1/journalist/memo?user=x']) {
      const res = await request(build()).post(url).send({ a: 1 });
      expect(res.body, url).toEqual({ ran: null, body: null });
    }
  });

  it('does not skip a longer path that only starts the same', async () => {
    const res = await request(build()).post('/api/v1/journalist/memorial').send({ a: 1 });
    expect(res.body.ran).toBe('yes');
  });
});
