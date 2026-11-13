/**
 * The grown-up's read of one child's reading shelf.
 *
 * The child's own panel reads the SAME shelf through `/books/:learnerId/shelf`,
 * gated by a launch grant (`X-School-Book-Grant`). A grown-up has no launch and
 * never will: they are looking at a child's record, not reading a book. So this
 * route is gated the way every other learner-scoped teacher surface is — the
 * picked teacher, asserted through `TeacherGate` — and takes its learner
 * from the URL rather than from a grant.
 *
 * One use case serves both (`GetBookShelf`). A second projection of the same
 * evidence is a second thing to be wrong about a child's year.
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSchoolTestRouter as createSchoolRouter } from "../../../../../tests/_lib/school/schoolRouterTestSupport.mjs";

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
  ...overrides,
});

describe('GET /teacher/learners/:learnerId/reading', () => {
  it('serves the same shelf view the child panel reads, for the learner in the URL', async () => {
    const deps = wired();
    await request(app(deps)).get(PATH)
      .expect(200).expect('Cache-Control', 'no-store').expect(SHELF);
    expect(deps.getBookShelf.execute).toHaveBeenCalledWith({ learnerId: LEARNER });
  });

  it('asserts the gate as the picked teacher (`?by=`) for the learner being read', async () => {
    const deps = wired();
    await request(app(deps)).get(`${PATH}?by=test-user`).expect(200);
    expect(deps.teacherGate.assert).toHaveBeenCalledWith({
      userId: 'test-user',
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

  it('does not accept a child book grant in place of a teacher', async () => {
    const deps = wired({
      teacherGate: { assert: vi.fn(() => { throw new GuestForbiddenError('Only a grown-up can do this.'); }) },
    });
    await request(app(deps)).get(PATH).set('X-School-Book-Grant', 'a-child-launch').expect(403);
    expect(deps.getBookShelf.execute).not.toHaveBeenCalled();
    // The gate saw no learner claim from the grant — the URL is the only source.
    expect(deps.teacherGate.assert).toHaveBeenCalledWith(expect.objectContaining({ context: { learnerId: LEARNER } }));
  });

  it('needs no book grant when a teacher is named', async () => {
    const deps = wired();
    await request(app(deps)).get(`${PATH}?by=test-user`).expect(200);
    expect(deps.getBookShelf.execute).toHaveBeenCalledTimes(1);
  });

  // The shelf as a whole is a READ and one create. Editing a reading names the
  // reading; there is no bulk verb, deliberately (design §8).
  it('offers no edit-the-whole-shelf verb at this address', async () => {
    const deps = wired();
    const server = app(deps);
    await request(server).patch(PATH).send({ status: 'finished' }).expect(404);
    await request(server).delete(PATH).expect(404);
    expect(deps.getBookShelf.execute).not.toHaveBeenCalled();
  });

  it('answers 404 where the shelf is not wired, so an older install reads as unavailable', async () => {
    await request(app(wired({ getBookShelf: null }))).get(PATH).expect(404);
  });
});

/**
 * The write half (design §5). Every route is teacher-gated inside its use
 * case, and every write carries `baseRevisionCount`.
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
});

const READING = `${PATH}/rdg_1`;

describe('the teacher reading edit routes', () => {
  it('reads one reading with its whole history', async () => {
    const deps = EDIT_DEPS();
    await request(app(deps)).get(`${READING}?by=test-user`).expect(200).expect('Cache-Control', 'no-store');
    expect(deps.getLearnerReadings.execute).toHaveBeenCalledWith(expect.objectContaining({
      learnerId: LEARNER, readingId: 'rdg_1', by: 'test-user',
    }));
  });

  it('patches identity and state, passing the base revision count through', async () => {
    const deps = EDIT_DEPS();
    await request(app(deps)).patch(READING)
      .send({ isbn: '9780000000002', status: 'finished', finishedOn: '2026-09-04', baseRevisionCount: 3 })
      .expect(200);
    expect(deps.updateReading.execute).toHaveBeenCalledWith(expect.objectContaining({
      learnerId: LEARNER, readingId: 'rdg_1', baseRevisionCount: 3,
      patch: { isbn: '9780000000002', status: 'finished', finishedOn: '2026-09-04' },
    }));
  });

  it('adds a day they read', async () => {
    const deps = EDIT_DEPS();
    await request(app(deps)).post(`${READING}/entries`)
      .send({ on: '2026-09-05', page: 120, baseRevisionCount: 1 }).expect(201);
    expect(deps.addReadingEntry.execute).toHaveBeenCalledWith(expect.objectContaining({
      readingId: 'rdg_1', on: '2026-09-05', page: 120, baseRevisionCount: 1,
    }));
  });

  it('serves the reading\'s revision count with an added day, and a replay on the same key', async () => {
    const deps = EDIT_DEPS();
    deps.addReadingEntry.execute.mockResolvedValue({
      revision: null, result: { id: 'ent_1' }, revisionCount: 2, replayed: true,
    });
    const response = await request(app(deps)).post(`${READING}/entries`)
      .set('Idempotency-Key', 'log-1:entry')
      .send({ on: '2026-09-05', baseRevisionCount: 1 }).expect(201);
    expect(response.body).toMatchObject({ result: { id: 'ent_1' }, revisionCount: 2, replayed: true });
    expect(deps.addReadingEntry.execute).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'log-1:entry' }));
  });

  it('fixes one entry, and deletes one entry with its reason', async () => {
    const deps = EDIT_DEPS();
    const server = app(deps);
    await request(server).patch(`${READING}/entries/ent_1`)
      .send({ page: 48, baseRevisionCount: 1 }).expect(200);
    expect(deps.updateReadingEntry.execute).toHaveBeenCalledWith(expect.objectContaining({
      entryId: 'ent_1', patch: { page: 48 }, baseRevisionCount: 1,
    }));
    await request(server).delete(`${READING}/entries/ent_1`)
      .send({ reason: 'logged on the wrong book', baseRevisionCount: 2 }).expect(200);
    expect(deps.deleteReadingEntry.execute).toHaveBeenCalledWith(expect.objectContaining({
      entryId: 'ent_1', reason: 'logged on the wrong book', baseRevisionCount: 2,
    }));
  });

  it('adds a book on the child\'s behalf', async () => {
    const deps = EDIT_DEPS();
    await request(app(deps)).post(PATH)
      .send({ isbn: '9780000000009', progressMode: 'page', pageCount: 96 }).expect(201);
    expect(deps.addReadingForLearner.execute).toHaveBeenCalledWith(expect.objectContaining({
      learnerId: LEARNER, isbn: '9780000000009', pageCount: 96, where: 'starting',
    }));
  });

  it('carries the door the grown-up chose — where the child is with it', async () => {
    const deps = EDIT_DEPS();
    await request(app(deps)).post(PATH)
      .send({ isbn: '9780000000009', where: 'partway', page: 84 }).expect(201);
    expect(deps.addReadingForLearner.execute).toHaveBeenCalledWith(expect.objectContaining({
      where: 'partway', page: 84, finishedOn: null,
    }));

    await request(app(deps)).post(PATH)
      .send({ isbn: '9780000000009', where: 'finished', finishedOn: '2026-08-20' }).expect(201);
    expect(deps.addReadingForLearner.execute).toHaveBeenLastCalledWith(expect.objectContaining({
      where: 'finished', finishedOn: '2026-08-20', page: null,
    }));
  });

  it('undoes a named revision', async () => {
    const deps = EDIT_DEPS();
    await request(app(deps)).post(`${READING}/undo`)
      .send({ revisionId: 'rev_1', reason: 'wrong call', baseRevisionCount: 4 }).expect(200);
    expect(deps.undoReadingRevision.execute).toHaveBeenCalledWith(expect.objectContaining({
      readingId: 'rdg_1', revisionId: 'rev_1', baseRevisionCount: 4,
    }));
  });

  it('moves a reading to another child, as the teacher who asked', async () => {
    const deps = EDIT_DEPS();
    await request(app(deps)).post(`${READING}/reassign`)
      .send({ toLearnerId: 'learner_b', reason: 'wrong shelf', baseRevisionCount: 0, by: 'test-user' }).expect(200);
    expect(deps.moveReading.execute).toHaveBeenCalledWith({
      learnerId: LEARNER, readingId: 'rdg_1', toLearnerId: 'learner_b',
      reason: 'wrong shelf', baseRevisionCount: 0, by: 'test-user',
    });
  });

  it('deletes a reading, as the teacher who asked', async () => {
    const deps = EDIT_DEPS();
    await request(app(deps)).delete(READING)
      .send({ reason: 'scanned twice', baseRevisionCount: 0, by: 'test-user' }).expect(200);
    expect(deps.deleteReading.execute).toHaveBeenCalledWith({
      learnerId: LEARNER, readingId: 'rdg_1', reason: 'scanned twice', baseRevisionCount: 0, by: 'test-user',
    });
  });

  // The gate lives inside every use case, so a refusal is the use case's
  // refusal and the router only maps it.
  it('answers 403 when a verb is refused, and 404 where it is not wired', async () => {
    const refused = { execute: vi.fn(() => { throw new GuestForbiddenError('Only a listed teacher can do this.'); }) };
    await request(app({ ...EDIT_DEPS(), deleteReading: refused }))
      .delete(READING).send({ reason: 'x', baseRevisionCount: 0 }).expect(403);
    await request(app({ ...EDIT_DEPS(), moveReading: null }))
      .post(`${READING}/reassign`).send({ toLearnerId: 'learner_b', reason: 'x', baseRevisionCount: 0 }).expect(404);
  });
});

/**
 * The quick-log sheet's read (2026-10-20): one book, every enrolled learner.
 * The gate lives in the use case, so the route's job is the address, the
 * acting teacher, and `no-store`.
 */
describe('GET /teacher/books/:isbn/readers', () => {
  const READERS_PATH = '/api/v1/school/teacher/books/9780000000002/readers';
  const READERS = Object.freeze({
    isbn: '9780000000002', studyDay: '2026-09-06', pageCount: 32, suggestedMode: 'check',
    readers: [{ learnerId: LEARNER, name: 'Learner A', suggestedMode: 'check', today: true, openReadingId: null, openReading: null, unreadable: false }],
  });
  const readersDeps = (overrides = {}) => ({
    getBookReaders: { execute: vi.fn(async () => READERS) },
    teacherGate: { assert: vi.fn() },
      ...overrides,
  });

  it('serves the readers view, no-store, for the named teacher', async () => {
    const deps = readersDeps();
    await request(app(deps)).get(`${READERS_PATH}?by=test-user`)
      .expect(200).expect('Cache-Control', 'no-store').expect(READERS);
    expect(deps.getBookReaders.execute).toHaveBeenCalledWith({
      isbn: '9780000000002', by: 'test-user',
    });
  });

  it('answers 403 when the gate refuses', async () => {
    const deps = readersDeps({
      getBookReaders: { execute: vi.fn(async () => { throw new GuestForbiddenError('Only a listed teacher can do this.'); }) },
    });
    const response = await request(app(deps)).get(READERS_PATH).expect(403);
    expect(response.body).toMatchObject({ error: 'Only a listed teacher can do this.' });
  });

  it('answers 404 where it is not wired', async () => {
    await request(app(readersDeps({ getBookReaders: null }))).get(READERS_PATH).expect(404);
  });

  it('is read-only: no write lives at this address', async () => {
    const deps = readersDeps();
    await request(app(deps)).post(READERS_PATH).send({}).expect(404);
    expect(deps.getBookReaders.execute).not.toHaveBeenCalled();
  });
});
