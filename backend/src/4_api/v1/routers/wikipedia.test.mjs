// @vitest-environment node
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createWikipediaRouter } from './wikipedia.mjs';

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

const makeApp = (adapter) => {
  const app = express();
  app.use('/api/v1/wikipedia', createWikipediaRouter({ adapter, logger: silentLogger }));
  return app;
};

describe('wikipedia router', () => {
  it('GET /search proxies query and limit to the adapter', async () => {
    let seen;
    const app = makeApp({
      search: async (q, opts) => { seen = { q, ...opts }; return [{ title: 'Kelp', snippet: '', path: 'Kelp' }]; },
    });

    const res = await request(app).get('/api/v1/wikipedia/search?q=kelp&limit=3').expect(200);

    expect(seen).toEqual({ q: 'kelp', limit: 3 });
    expect(res.body).toEqual([{ title: 'Kelp', snippet: '', path: 'Kelp' }]);
  });

  it('GET /search without q returns 400', async () => {
    const app = makeApp({ search: async () => [] });
    const res = await request(app).get('/api/v1/wikipedia/search').expect(400);
    expect(res.body.error).toMatch(/q/);
  });

  it('GET /article/:title returns the article', async () => {
    const app = makeApp({
      getArticle: async (title) => ({ title, text: 'body' }),
    });

    const res = await request(app).get('/api/v1/wikipedia/article/Isaac%20Newton').expect(200);
    expect(res.body).toEqual({ title: 'Isaac Newton', text: 'body' });
  });

  it('GET /article/:title returns 404 when adapter yields null', async () => {
    const app = makeApp({ getArticle: async () => null });
    const res = await request(app).get('/api/v1/wikipedia/article/Nope').expect(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('GET /random returns an article', async () => {
    const app = makeApp({ random: async () => ({ title: 'Kelp', text: 'Kelp is...' }) });
    const res = await request(app).get('/api/v1/wikipedia/random').expect(200);
    expect(res.body.title).toBe('Kelp');
  });

  it('GET /health passes through service health', async () => {
    const app = makeApp({ health: async () => ({ status: 'ok', book_id: 'current' }) });
    const res = await request(app).get('/api/v1/wikipedia/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('adapter failures surface as 502 with the error message', async () => {
    const app = makeApp({
      search: async () => { throw new Error('wikipedia service unreachable at http://wiki:8098'); },
    });
    const res = await request(app).get('/api/v1/wikipedia/search?q=x').expect(502);
    expect(res.body.error).toMatch(/unreachable/);
  });
});
