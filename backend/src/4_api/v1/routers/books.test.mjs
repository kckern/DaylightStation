import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandlerMiddleware } from '#system/http/middleware/index.mjs';
import { createBooksRouter } from './books.mjs';

// The real error middleware, so a resolver that throws answers in the app's
// one error shape rather than hanging the request.
const app = (resolveBook) => {
  const a = express();
  a.use('/books', createBooksRouter({ resolveBook }));
  a.use(errorHandlerMiddleware());
  return a;
};

describe('GET /books/resolve', () => {
  it('returns the resolver outcome verbatim', async () => {
    const resolveBook = { async execute(id) { return { status: 'ok', book: { isbn13: id, title: 'x' } }; } };
    const res = await request(app(resolveBook)).get('/books/resolve?id=9780064400558');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', book: { title: 'x' } });
  });
  it('answers 400 for an empty id and never calls the resolver', async () => {
    let called = false;
    const res = await request(app({ async execute() { called = true; return { status: 'ok' }; } })).get('/books/resolve');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ status: 'invalid', reason: 'empty' });
    expect(called).toBe(false);
  });
  it('treats a whitespace-only id as empty and never calls the resolver', async () => {
    let called = false;
    const res = await request(app({ async execute() { called = true; return { status: 'ok' }; } })).get('/books/resolve?id=%20');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ status: 'invalid', reason: 'empty' });
    expect(called).toBe(false);
  });
  it('maps invalid→400, not-found→404, unavailable→503, each with the body', async () => {
    expect((await request(app({ async execute() { return { status: 'invalid', reason: 'isbn13-checksum' }; } })).get('/books/resolve?id=x')).status).toBe(400);
    expect((await request(app({ async execute() { return { status: 'not-found' }; } })).get('/books/resolve?id=x')).status).toBe(404);
    const un = await request(app({ async execute() { return { status: 'unavailable', failures: [{ source: 'openlibrary', error: '429' }] }; } })).get('/books/resolve?id=x');
    expect(un.status).toBe(503);
    expect(un.body.failures).toHaveLength(1);
  });
  it('passes refresh=1 through', async () => {
    let opts;
    await request(app({ async execute(_id, o) { opts = o; return { status: 'ok', book: {} }; } })).get('/books/resolve?id=x&refresh=1');
    expect(opts).toMatchObject({ refresh: true });
  });
});
