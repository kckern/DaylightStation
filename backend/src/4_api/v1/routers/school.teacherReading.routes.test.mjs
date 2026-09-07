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

  // The shelf as a whole is a READ and one create. Editing a reading names the
  // reading; there is no bulk verb, deliberately (design §8).
  it('offers no edit-the-whole-shelf verb at this address', async () => {
    const deps = wired();
    const server = app(deps);
    await withCookie(request(server).patch(PATH).send({ status: 'finished' })).expect(404);
    await withCookie(request(server).delete(PATH)).expect(404);
    expect(deps.getBookShelf.execute).not.toHaveBeenCalled();
  });

  it('answers 404 where the shelf is not wired, so an older install reads as unavailable', async () => {
    await withCookie(request(app(wired({ getBookShelf: null }))).get(PATH)).expect(404);
  });
});

/**
 * The write half (design §5). Every route is capability-gated, every write
 * carries `baseRevisionCount`, and the two destructive verbs additionally
 * carry the one-use step-up grant in `X-Teacher-Step-Up` — which reaches the
 * use case as part of the same `pin` proof the cookie makes, so the gate
 * inside the use case is the one that decides.
 */
const EDIT_DEPS = () => ({
  getBookShelf: { execute: vi.fn(async () => SHELF) },
  getLearnerReadings: { execute: vi.fn(async () => ({ learnerId: LEARNER, reading: { id: 'rdg_1', revisions: [] } })) },
  updateReading: { execute: vi.fn(async () => ({ revision: { id: 'rev_1' }, result: {} })) },
  addReadingEntry: { execute: vi.fn(async () => ({ revision: { id: 'rev_1' }, result: { id: 'ent_1' } })) },
  updateReadingEntry: { execute: vi.fn(async () => ({ revision: { id: 'rev_1' }, result: {} })) },
  deleteReadingEntry: { execute: vi.fn(async () => ({ revision: { id: 'rev_1' }, result: { id: 'ent_1' } })) },
  addReadingForLearner: { execute: vi.fn(async () => ({ reading: { id: 'rdg_2' }, revision: { id: 'rev_1' }, created: true })) },
  moveReading: { execute: vi.fn(async () => ({ revision: { id: 'rev_1' }, result: {} })) },
  deleteReading: { execute: vi.fn(async () => ({ revision: { id: 'rev_1' }, removed: { id: 'rdg_1' } })) },
  undoReadingRevision: { execute: vi.fn(async () => ({ revision: { id: 'rev_2' }, result: {} })) },
  teacherGate: { assert: vi.fn() },
  teacherCapabilitySessions: activeCapability(),
});

const READING = `${PATH}/rdg_1`;

describe('the teacher reading edit routes', () => {
  it('reads one reading with its whole history', async () => {
    const deps = EDIT_DEPS();
    await withCookie(request(app(deps)).get(READING)).expect(200).expect('Cache-Control', 'no-store');
    expect(deps.getLearnerReadings.execute).toHaveBeenCalledWith(expect.objectContaining({
      learnerId: LEARNER, readingId: 'rdg_1', by: 'test-user',
    }));
  });

  it('patches identity and state, passing the base revision count through', async () => {
    const deps = EDIT_DEPS();
    await withCookie(request(app(deps)).patch(READING)
      .send({ isbn: '9780000000002', status: 'finished', finishedOn: '2026-09-04', baseRevisionCount: 3 }))
      .expect(200);
    expect(deps.updateReading.execute).toHaveBeenCalledWith(expect.objectContaining({
      learnerId: LEARNER, readingId: 'rdg_1', baseRevisionCount: 3,
      patch: { isbn: '9780000000002', status: 'finished', finishedOn: '2026-09-04' },
    }));
  });

  it('adds a day they read', async () => {
    const deps = EDIT_DEPS();
    await withCookie(request(app(deps)).post(`${READING}/entries`)
      .send({ on: '2026-09-05', page: 120, baseRevisionCount: 1 })).expect(201);
    expect(deps.addReadingEntry.execute).toHaveBeenCalledWith(expect.objectContaining({
      readingId: 'rdg_1', on: '2026-09-05', page: 120, baseRevisionCount: 1,
    }));
  });

  it('fixes one entry, and deletes one entry with its reason', async () => {
    const deps = EDIT_DEPS();
    const server = app(deps);
    await withCookie(request(server).patch(`${READING}/entries/ent_1`)
      .send({ page: 48, baseRevisionCount: 1 })).expect(200);
    expect(deps.updateReadingEntry.execute).toHaveBeenCalledWith(expect.objectContaining({
      entryId: 'ent_1', patch: { page: 48 }, baseRevisionCount: 1,
    }));
    await withCookie(request(server).delete(`${READING}/entries/ent_1`)
      .send({ reason: 'logged on the wrong book', baseRevisionCount: 2 })).expect(200);
    expect(deps.deleteReadingEntry.execute).toHaveBeenCalledWith(expect.objectContaining({
      entryId: 'ent_1', reason: 'logged on the wrong book', baseRevisionCount: 2,
    }));
  });

  it('adds a book on the child\'s behalf', async () => {
    const deps = EDIT_DEPS();
    await withCookie(request(app(deps)).post(PATH)
      .send({ isbn: '9780000000009', progressMode: 'page', pageCount: 96 })).expect(201);
    expect(deps.addReadingForLearner.execute).toHaveBeenCalledWith(expect.objectContaining({
      learnerId: LEARNER, isbn: '9780000000009', pageCount: 96, where: 'starting',
    }));
  });

  it('carries the door the grown-up chose — where the child is with it', async () => {
    const deps = EDIT_DEPS();
    await withCookie(request(app(deps)).post(PATH)
      .send({ isbn: '9780000000009', where: 'partway', page: 84 })).expect(201);
    expect(deps.addReadingForLearner.execute).toHaveBeenCalledWith(expect.objectContaining({
      where: 'partway', page: 84, finishedOn: null,
    }));

    await withCookie(request(app(deps)).post(PATH)
      .send({ isbn: '9780000000009', where: 'finished', finishedOn: '2026-08-20' })).expect(201);
    expect(deps.addReadingForLearner.execute).toHaveBeenLastCalledWith(expect.objectContaining({
      where: 'finished', finishedOn: '2026-08-20', page: null,
    }));
  });

  it('undoes a named revision', async () => {
    const deps = EDIT_DEPS();
    await withCookie(request(app(deps)).post(`${READING}/undo`)
      .send({ revisionId: 'rev_1', reason: 'wrong call', baseRevisionCount: 4 })).expect(200);
    expect(deps.undoReadingRevision.execute).toHaveBeenCalledWith(expect.objectContaining({
      readingId: 'rdg_1', revisionId: 'rev_1', baseRevisionCount: 4,
    }));
  });

  // The two step-up verbs. The header rides into the use case as part of the
  // `pin` proof, so the gate that refuses a missing grant is the one inside.
  it('moves a reading to another child, carrying the step-up grant', async () => {
    const deps = EDIT_DEPS();
    await withCookie(request(app(deps)).post(`${READING}/reassign`)
      .set('X-Teacher-Step-Up', 'grant-1')
      .send({ toLearnerId: 'learner_b', reason: 'wrong shelf', baseRevisionCount: 0 })).expect(200);
    const call = deps.moveReading.execute.mock.calls[0][0];
    expect(call).toMatchObject({ learnerId: LEARNER, readingId: 'rdg_1', toLearnerId: 'learner_b' });
    expect(call.pin).toEqual({ capabilityToken: 'session-1', stepUpToken: 'grant-1' });
  });

  it('deletes a reading, carrying the step-up grant', async () => {
    const deps = EDIT_DEPS();
    await withCookie(request(app(deps)).delete(READING)
      .set('X-Teacher-Step-Up', 'grant-1')
      .send({ reason: 'scanned twice', baseRevisionCount: 0 })).expect(200);
    const call = deps.deleteReading.execute.mock.calls[0][0];
    expect(call).toMatchObject({ readingId: 'rdg_1', reason: 'scanned twice' });
    expect(call.pin).toEqual({ capabilityToken: 'session-1', stepUpToken: 'grant-1' });
  });

  // The gate lives inside every use case, so a refusal is the use case's
  // refusal and the router only maps it.
  it('answers 403 when a verb is refused, and 404 where it is not wired', async () => {
    const refused = { execute: vi.fn(() => { throw new GuestForbiddenError('The teacher PIN is missing or wrong.'); }) };
    await withCookie(request(app({ ...EDIT_DEPS(), deleteReading: refused }))
      .delete(READING).send({ reason: 'x', baseRevisionCount: 0 })).expect(403);
    await withCookie(request(app({ ...EDIT_DEPS(), moveReading: null }))
      .post(`${READING}/reassign`).send({ toLearnerId: 'learner_b', reason: 'x', baseRevisionCount: 0 })).expect(404);
  });
});
