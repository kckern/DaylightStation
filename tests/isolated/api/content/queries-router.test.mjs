// tests/isolated/api/content/queries-router.test.mjs
import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createQueriesRouter } from '#api/v1/routers/queries.mjs';
import { SavedQueryService } from '#apps/content/SavedQueryService.mjs';

describe('Queries CRUD Router', () => {
  let app;
  let store;

  beforeAll(() => {
    store = {
      dailynews: { type: 'freshvideo', sources: ['news/cnn', 'news/az'] },
    };

    const savedQueryService = new SavedQueryService({
      readQuery: (name) => store[name] || null,
      listQueries: () => Object.keys(store),
      writeQuery: (name, data) => { store[name] = data; },
      deleteQuery: (name) => { delete store[name]; },
    });

    app = express();
    app.use(express.json());
    app.use('/api/v1/queries', createQueriesRouter({ savedQueryService }));
  });

  it('GET / lists all queries', async () => {
    const res = await request(app).get('/api/v1/queries');
    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(Array);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].name).toBe('dailynews');
    expect(res.body[0].source).toBe('freshvideo');
  });

  it('GET /:name returns a single query', async () => {
    const res = await request(app).get('/api/v1/queries/dailynews');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('dailynews');
    expect(res.body.source).toBe('freshvideo');
    expect(res.body.filters.sources).toEqual(['news/cnn', 'news/az']);
  });

  it('GET /:name returns 404 for unknown query', async () => {
    const res = await request(app).get('/api/v1/queries/nonexistent');
    expect(res.status).toBe(404);
  });

  it('POST /:name creates a new query', async () => {
    const res = await request(app)
      .post('/api/v1/queries/morning')
      .send({ type: 'freshvideo', sources: ['teded', 'science'] });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('morning');
    expect(res.body.source).toBe('freshvideo');

    // Verify it persisted
    const get = await request(app).get('/api/v1/queries/morning');
    expect(get.status).toBe(200);
    expect(get.body.filters.sources).toEqual(['teded', 'science']);
  });

  it('POST /:name rejects missing type', async () => {
    const res = await request(app)
      .post('/api/v1/queries/bad')
      .send({ sources: ['foo'] });
    expect(res.status).toBe(400);
  });

  it('DELETE /:name deletes a query', async () => {
    // Ensure it exists first
    await request(app)
      .post('/api/v1/queries/tempquery')
      .send({ type: 'freshvideo', sources: ['temp'] });

    const del = await request(app).delete('/api/v1/queries/tempquery');
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBe('tempquery');

    // Verify gone
    const get = await request(app).get('/api/v1/queries/tempquery');
    expect(get.status).toBe(404);
  });

  it('DELETE /:name returns 404 for unknown query', async () => {
    const res = await request(app).delete('/api/v1/queries/nonexistent');
    expect(res.status).toBe(404);
  });
});
