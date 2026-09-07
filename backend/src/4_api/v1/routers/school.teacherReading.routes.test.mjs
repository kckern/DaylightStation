/**
 * The grown-up's read of one child's reading shelf.
 *
 * The child's own panel reads the SAME shelf through `/books/:learnerId/shelf`,
 * gated by a launch grant (`X-School-Book-Grant`). A grown-up has no launch and
 * never will: they are looking at a child's record, not reading a book. So this
 * route is gated the way every other learner-scoped teacher surface is — the
 * console capability, asserted through `TeacherGate` — and takes its learner
 * from the URL rather than from a grant.
 *
 * One use case serves both (`GetBookShelf`). A second projection of the same
 * evidence is a second thing to be wrong about a child's year.
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSchoolTestRouter as createSchoolRouter } from '../../../../../tests/_lib/school/schoolRouterTestSupport.mjs';

// The router matches refusals against the class COMPOSITION injects, never one
// it imports (a 4_api module may not reach into 2_domains).
class GuestForbiddenError extends Error {}

const LEARNER = 'learner_a';
const PATH = `/api/v1/school/teacher/learners/${LEARNER}/reading`;

const SHELF = Object.freeze({
  learnerId: LEARNER,
  studyDay: '2026-09-06',
  earliestFinishDay: '2026-08-23',
  items: [{
    itemId: 'itm_1', bookId: '9780000000001', progressMode: 'page', pageCount: 184,
    title: 'A Borrowed Title', authors: ['Someone'], coverUrl: null,
    projection: { status: 'reading', page: 84, percent: 46, minutes: null, daysRead: 6, lastAt: '2026-09-03T18:00:00.000Z' },
  }],
  obligation: { label: '4 of 7 days', met: false, actual: 4, target: 7, metric: 'checkins', incompatibleBooks: [] },
});

const activeCapability = () => ({
  status: vi.fn(() => ({ active: true, userId: 'test-user' })),
  authorize: vi.fn(() => true),
});

function app(overrides = {}) {
  const server = express();
  server.use(express.json());
  server.use('/api/v1/school', createSchoolRouter({
    schoolService: {}, learnerDirectory: { listLearners: async () => [] },
    schoolErrors: { GuestForbiddenError },
    logger: { error() {} }, ...overrides,
  }));
  return server;
}

const wired = (overrides = {}) => ({
  getBookShelf: { execute: vi.fn(async () => SHELF) },
  teacherGate: { assert: vi.fn() },
  teacherCapabilitySessions: activeCapability(),
  ...overrides,
});

const withCookie = (test) => test.set('Cookie', 'daylight_teacher_session=session-1');

describe('GET /teacher/learners/:learnerId/reading', () => {
  it('serves the same shelf view the child panel reads, for the learner in the URL', async () => {
    const deps = wired();
    await withCookie(request(app(deps)).get(PATH))
      .expect(200).expect('Cache-Control', 'no-store').expect(SHELF);
    expect(deps.getBookShelf.execute).toHaveBeenCalledWith({ learnerId: LEARNER });
  });

  it('asserts the console capability for the learner being read', async () => {
    const deps = wired();
    await withCookie(request(app(deps)).get(PATH)).expect(200);
    expect(deps.teacherGate.assert).toHaveBeenCalledWith({
      userId: 'test-user',
      pin: { capabilityToken: 'session-1', stepUpToken: null },
      action: 'books.shelf.read',
      context: { learnerId: LEARNER },
    });
  });

  it('refuses, and reads nothing at all, when the gate says no', async () => {
    const deps = wired({
      teacherGate: { assert: vi.fn(() => { throw new GuestForbiddenError('Only a listed teacher can do this.'); }) },
    });
    const response = await request(app(deps)).get(PATH).expect(403);
    expect(response.body).toMatchObject({ error: 'Only a listed teacher can do this.' });
    // The refusal happens BEFORE the read, so a 403 cannot leak whether the
    // child has a shelf at all.
    expect(deps.getBookShelf.execute).not.toHaveBeenCalled();
  });

  it('does not accept a child book grant in place of the capability', async () => {
    const deps = wired({
      teacherGate: { assert: vi.fn(() => { throw new GuestForbiddenError('Only a grown-up can do this.'); }) },
    });
    await request(app(deps)).get(PATH).set('X-School-Book-Grant', 'a-child-launch').expect(403);
    expect(deps.getBookShelf.execute).not.toHaveBeenCalled();
    // The gate saw no learner claim from the grant — the URL is the only source.
    expect(deps.teacherGate.assert).toHaveBeenCalledWith(expect.objectContaining({ context: { learnerId: LEARNER } }));
  });

  it('needs no book grant when the capability is present', async () => {
    const deps = wired();
    await withCookie(request(app(deps)).get(PATH)).expect(200);
    expect(deps.getBookShelf.execute).toHaveBeenCalledTimes(1);
  });

  it('offers no write verb at this address', async () => {
    const deps = wired();
    const server = app(deps);
    await withCookie(request(server).post(PATH).send({ bookId: '9780000000001' })).expect(404);
    await withCookie(request(server).patch(PATH).send({ status: 'finished' })).expect(404);
    await withCookie(request(server).delete(PATH)).expect(404);
    expect(deps.getBookShelf.execute).not.toHaveBeenCalled();
  });

  it('answers 404 where the shelf is not wired, so an older install reads as unavailable', async () => {
    await withCookie(request(app(wired({ getBookShelf: null }))).get(PATH)).expect(404);
  });
});
