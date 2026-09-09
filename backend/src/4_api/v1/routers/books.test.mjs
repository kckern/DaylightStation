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

// ---------------------------------------------------------------------------
// The cover endpoint: one address the shelf renders from, whichever rung of the
// ladder the bytes actually came from.
// ---------------------------------------------------------------------------

const ART = Buffer.alloc(4096, 0x41);

const coverApp = (resolveBookCover, resolveBook = { async execute() { return { status: 'not-found' }; } }) => {
  const a = express();
  a.use('/books', createBooksRouter({ resolveBook, resolveBookCover, logger: { warn() {}, info() {} } }));
  a.use(errorHandlerMiddleware());
  return a;
};

describe('GET /books/:isbn13/cover', () => {
  const found = {
    async cover() { return { bytes: ART, contentType: 'image/jpeg', source: 'amazon' }; },
    async execute() { return { status: 'found' }; },
  };

  it('serves the stored bytes and names the rung they came from', async () => {
    const res = await request(coverApp(found)).get('/books/9780064400558/cover');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/jpeg');
    expect(res.headers['x-cover-source']).toBe('amazon');
    expect(res.body.length).toBe(ART.length);
  });

  it('404s honestly when the whole ladder found nothing — the panel draws its own placeholder', async () => {
    const none = { async cover() { return null; }, async execute() { return { status: 'none' }; } };
    const res = await request(coverApp(none)).get('/books/9780064400558/cover');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ status: 'not-found', reason: 'no-cover-anywhere' });
  });

  it('answers 304 to a panel that already has this exact cover', async () => {
    const app = coverApp(found);
    const first = await request(app).get('/books/9780064400558/cover');
    const again = await request(app).get('/books/9780064400558/cover').set('If-None-Match', first.headers.etag);
    expect(again.status).toBe(304);
  });

  it('refuses anything that is not a thirteen-digit isbn without touching the resolver', async () => {
    let called = false;
    const spy = { async cover() { called = true; return null; }, async execute() { return {}; } };
    const res = await request(coverApp(spy)).get('/books/not-a-book/cover');
    expect(res.status).toBe(400);
    expect(called).toBe(false);
  });

  it('rewrites a resolved book onto our cover address and warms the ladder without blocking', async () => {
    let warmed = null;
    const warm = {
      async cover() { return null; },
      async execute(isbn13) { warmed = isbn13; return { status: 'found' }; },
    };
    const resolveBook = { async execute() { return { status: 'ok', book: { isbn13: '9780064400558', title: 'x', coverUrl: 'https://provider.test/c.jpg' } }; } };
    const res = await request(coverApp(warm, resolveBook)).get('/books/resolve?id=9780064400558');
    expect(res.status).toBe(200);
    expect(res.body.book.coverUrl).toBe('/api/v1/books/9780064400558/cover');
    expect(warmed).toBe('9780064400558');
  });

  it('is simply absent when no cover resolver is composed', async () => {
    const a = express();
    a.use('/books', createBooksRouter({ resolveBook: { async execute() { return { status: 'ok', book: { isbn13: '9780064400558' } }; } } }));
    a.use(errorHandlerMiddleware());
    expect((await request(a).get('/books/9780064400558/cover')).status).toBe(404);
  });
});
