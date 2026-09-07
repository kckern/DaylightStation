import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandlerMiddleware } from '#system/http/middleware/index.mjs';
import { createSchoolBooksRouter } from './schoolBooks.mjs';

const grants = { verify: (token, { learnerId }) => (token === `ok-${learnerId}` ? { ok: true, payload: { learnerId } } : { ok: false }) };
const view = { learnerId: 'kid', items: [{ itemId: 'kid:b:e1' }], obligation: null, studyDay: '2026-09-02' };

function deps() {
  return {
    grants,
    getBookShelf: { calls: [], async execute(input) { this.calls.push(input); return view; } },
    openBookShelfItem: { calls: [], async execute(input) { this.calls.push(input); return { item: { itemId: 'kid:b:new' }, event: null, book: {} }; } },
    recordBookProgress: { calls: [], modes: [],
      async execute(input) { this.calls.push(input); return { item: {}, event: { kind: input.kind } }; },
      async setMode(input) { this.modes.push(input); return { itemId: input.itemId, progressMode: input.progressMode }; } },
    onBookLogChanged: vi.fn(async () => {}),
    logger: { warn: vi.fn() },
  };
}
// The REAL error middleware, so these tests pin the one error shape a client
// reads — `{ ok:false, error:{ type, message, code }, traceId }` — for the
// router's own 403 and for a use case's ValidationError alike.
const app = (d = deps()) => {
  const a = express();
  a.use('/school/books', createSchoolBooksRouter(d));
  a.use(errorHandlerMiddleware());
  return [a, d];
};
const H = 'X-School-Book-Grant';

describe('school books routes', () => {
  it('refuses every route without a grant for THAT learner, in the app error shape, before any use case runs', async () => {
    const [a, d] = app();
    for (const [m, p] of [['get', '/school/books/kid/shelf'], ['post', '/school/books/kid/shelf'],
      ['post', '/school/books/kid/shelf/kid:b:e1/progress'], ['post', '/school/books/kid/shelf/kid:b:e1/mode']]) {
      for (const [label, req] of [['sibling grant', request(a)[m](p).set(H, 'ok-sibling')], ['no header', request(a)[m](p)]]) {
        const res = await req.send({});
        expect(res.status, `${m} ${p} ${label}`).toBe(403);
        expect(res.body.ok, `${m} ${p} ${label}`).toBe(false);
        expect(res.body.error.message, `${m} ${p} ${label}`).toMatch(/reading launch/);
      }
    }
    expect(d.getBookShelf.calls).toHaveLength(0);
    expect(d.openBookShelfItem.calls).toHaveLength(0);
    expect(d.recordBookProgress.calls).toHaveLength(0);
    expect(d.recordBookProgress.modes).toHaveLength(0);
  });

  it('GET shelf hands the grant learner to GetBookShelf and returns its view', async () => {
    const [a, d] = app();
    const res = await request(a).get('/school/books/kid/shelf').set(H, 'ok-kid');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(view);
    expect(d.getBookShelf.calls[0]).toEqual({ learnerId: 'kid' });
  });

  it('POST shelf takes the learner from the grant, not the body', async () => {
    const [a, d] = app();
    const res = await request(a).post('/school/books/kid/shelf').set(H, 'ok-kid')
      .send({ learnerId: 'sibling', bookId: 'b', entryId: 'e1', where: 'starting' });
    expect(res.status).toBe(200);
    expect(d.openBookShelfItem.calls[0]).toMatchObject({ learnerId: 'kid', bookId: 'b', entryId: 'e1', where: 'starting' });
  });

  it('POST progress and POST mode route to the use case with the grant learner and the URL itemId', async () => {
    const [a, d] = app();
    await request(a).post('/school/books/kid/shelf/kid:b:e1/progress').set(H, 'ok-kid').send({ kind: 'progress', page: 90, entryId: 'p1', learnerId: 'sibling' });
    expect(d.recordBookProgress.calls[0]).toMatchObject({ learnerId: 'kid', itemId: 'kid:b:e1', kind: 'progress', page: 90, entryId: 'p1' });
    await request(a).post('/school/books/kid/shelf/kid:b:e1/mode').set(H, 'ok-kid').send({ progressMode: 'check' });
    expect(d.recordBookProgress.modes[0]).toEqual({ learnerId: 'kid', itemId: 'kid:b:e1', progressMode: 'check' });
  });

  it.each([
    ['open', '/school/books/kid/shelf', { bookId: 'b', entryId: 'open-1' }],
    ['progress', '/school/books/kid/shelf/kid:b:e1/progress', { kind: 'progress', page: 90, entryId: 'p-1' }],
    ['mode', '/school/books/kid/shelf/kid:b:e1/mode', { progressMode: 'check' }],
  ])('publishes one grant-scoped learner invalidation after a successful %s', async (_label, url, body) => {
    const [a, d] = app();
    const res = await request(a).post(url).set(H, 'ok-kid').send({ ...body, learnerId: 'sibling' });

    expect(res.status).toBe(200);
    expect(d.onBookLogChanged).toHaveBeenCalledTimes(1);
    expect(d.onBookLogChanged).toHaveBeenCalledWith({ event: 'book-log-changed', learnerId: 'kid' });
  });

  it('publishes only after the write reports success', async () => {
    const order = [];
    const d = deps();
    d.openBookShelfItem.execute = async () => { order.push('saved'); return { item: {}, event: null, book: {} }; };
    d.onBookLogChanged = async () => { order.push('notified'); };
    const [a] = app(d);

    const res = await request(a).post('/school/books/kid/shelf').set(H, 'ok-kid').send({ bookId: 'b', entryId: 'open-1' });
    expect(res.status).toBe(200);
    expect(order).toEqual(['saved', 'notified']);
  });

  it('does not notify when the persisted mutation is rejected', async () => {
    const [a, d] = app();
    d.recordBookProgress.execute = async () => { throw new Error('write refused'); };

    const res = await request(a).post('/school/books/kid/shelf/kid:b:e1/progress')
      .set(H, 'ok-kid').send({ kind: 'progress', page: 90, entryId: 'p-1' });
    expect(res.status).toBe(500);
    expect(d.onBookLogChanged).not.toHaveBeenCalled();
  });

  it('keeps a saved response successful when notification fails', async () => {
    const [a, d] = app();
    d.onBookLogChanged.mockRejectedValue(new Error('bus unavailable'));

    const res = await request(a).post('/school/books/kid/shelf').set(H, 'ok-kid')
      .send({ bookId: 'b', entryId: 'open-1' });
    expect(res.status).toBe(200);
    expect(res.body.item.itemId).toBe('kid:b:new');
    expect(d.logger.warn).toHaveBeenCalledWith('school.book-log.notification-failed', {
      learnerId: 'kid', error: 'bus unavailable',
    });
  });

  it('lets a ValidationError reach the app error middleware as a 400 in the same shape', async () => {
    const [a, d] = app();
    d.recordBookProgress.execute = async () => { const e = new Error('page must be a positive integer'); e.name = 'ValidationError'; throw e; };
    const res = await request(a).post('/school/books/kid/shelf/kid:b:e1/progress').set(H, 'ok-kid').send({ kind: 'progress', page: -1, entryId: 'p' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.message).toMatch(/page/);
  });

  it('names each missing collaborator at construction', () => {
    for (const name of ['grants', 'getBookShelf', 'openBookShelfItem', 'recordBookProgress', 'onBookLogChanged']) {
      expect(() => createSchoolBooksRouter({ ...deps(), [name]: undefined }), name).toThrow(new RegExp(name));
    }
  });
});
