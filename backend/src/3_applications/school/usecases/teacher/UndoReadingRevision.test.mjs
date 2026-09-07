/**
 * Undo is a VERB, not a stack pointer (teacher reading admin design §4).
 *
 * Undoing revision *n* computes its inverse, applies it, and APPENDS a new
 * revision saying so. The history grows and never rewinds — which is what
 * makes undoing an undo just another undo, and what makes "who changed this"
 * survive every correction of a correction.
 *
 * Two things it refuses by name rather than offering a button that lies: a
 * move the receiving child has since logged against, and the opening of a
 * reading, whose inverse would destroy the record and the history with it.
 * (Three, with a revision another undo already inverted.)
 *
 * Those sentences are also SERVED, on the revision, by the read the console
 * loads — so a grown-up reads the refusal instead of tapping a button that
 * would fail. The last describe here is the anti-drift test: the sentence the
 * read serves must be, character for character, the sentence the verb throws.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeBookLog, seedReading, fakeLauncher } from '../../../../../../tests/_lib/school/bookLogTestSupport.mjs';
import { UpdateReading } from './UpdateReading.mjs';
import { AddReadingEntry } from './AddReadingEntry.mjs';
import { UpdateReadingEntry } from './UpdateReadingEntry.mjs';
import { DeleteReadingEntry } from './DeleteReadingEntry.mjs';
import { AddReadingForLearner } from './AddReadingForLearner.mjs';
import { MoveReading } from './MoveReading.mjs';
import { UndoReadingRevision } from './UndoReadingRevision.mjs';
import { GetLearnerReadings } from './GetLearnerReadings.mjs';

const LEARNER = 'learner_a';
const SIBLING = 'learner_b';
const TEACHER = 'test-user';
const AT = '2026-09-06T17:00:00.000Z';

let notes;
let bookLog;
let teacherGate;
let now;
// ONE counter across every use case in a test: two revisions in one reading's
// history can never share an id, and a fixture that let them would fake the
// "already undone" guard into firing on an unrelated row.
let minted;

function deps(extra = {}) {
  return {
    bookLog,
    teacherGate,
    recordTeacherNote: { execute: notes },
    bookRepository: { findByIsbn: async () => ({ title: 'A Borrowed Title' }) },
    bookLogLauncher: fakeLauncher(),
    clock: () => new Date(now),
    idGen: () => { minted += 1; return `rev_${minted}`; },
    logger: { info() {}, warn() {}, error() {} },
    ...extra,
  };
}

beforeEach(() => {
  now = AT;
  minted = 0;
  notes = vi.fn(async () => ({ entry: { id: 'note_1' } }));
  teacherGate = { assert: vi.fn() };
  bookLog = fakeBookLog({ [LEARNER]: [seedReading()], [SIBLING]: [] });
});

const only = async (learnerId = LEARNER) => (await bookLog.listForLearner(learnerId))[0];
const undo = (extra) => new UndoReadingRevision(deps(extra));

describe('UndoReadingRevision', () => {
  it('puts a corrected ISBN back, and says so as a NEW revision', async () => {
    const { revision } = await new UpdateReading(deps()).execute({
      learnerId: LEARNER, readingId: 'rdg_a', by: TEACHER,
      patch: { isbn: '9780000000002' }, baseRevisionCount: 0,
    });
    const result = await undo().execute({
      learnerId: LEARNER, readingId: 'rdg_a', revisionId: revision.id,
      by: TEACHER, baseRevisionCount: 1,
    });
    const reading = await only();
    expect(reading.book.isbn).toBe('9780000000001');
    // History GREW. Nothing was removed, and the original still reads correctly.
    expect(reading.revisions).toHaveLength(2);
    expect(reading.revisions[0].id).toBe(revision.id);
    expect(reading.revisions[1]).toMatchObject({
      verb: 'reading.undo', op: 'reading.update',
      undoes: revision.id, undoneVerb: 'reading.update',
      before: { isbn: '9780000000002' }, after: { isbn: '9780000000001' },
    });
    expect(result.revision.toldChild).toBe(false);
    expect(notes).not.toHaveBeenCalled();
  });

  it('undoing an undo is just another undo, and reads correctly in the list', async () => {
    const first = await new UpdateReading(deps()).execute({
      learnerId: LEARNER, readingId: 'rdg_a', by: TEACHER,
      patch: { pageCount: 192 }, baseRevisionCount: 0,
    });
    const undone = await undo().execute({
      learnerId: LEARNER, readingId: 'rdg_a', revisionId: first.revision.id,
      by: TEACHER, baseRevisionCount: 1,
    });
    expect((await only()).book.pageCount).toBe(184);

    const redone = await undo().execute({
      learnerId: LEARNER, readingId: 'rdg_a', revisionId: undone.revision.id,
      by: TEACHER, baseRevisionCount: 2,
    });
    expect((await only()).book.pageCount).toBe(192);
    expect((await only()).revisions).toHaveLength(3);
    expect(redone.revision).toMatchObject({ verb: 'reading.undo', undoes: undone.revision.id });
  });

  it('refuses to undo the same revision twice — undo the undo instead', async () => {
    const { revision } = await new UpdateReading(deps()).execute({
      learnerId: LEARNER, readingId: 'rdg_a', by: TEACHER, patch: { pageCount: 192 }, baseRevisionCount: 0,
    });
    await undo().execute({ learnerId: LEARNER, readingId: 'rdg_a', revisionId: revision.id, by: TEACHER, baseRevisionCount: 1 });
    await expect(undo().execute({
      learnerId: LEARNER, readingId: 'rdg_a', revisionId: revision.id, by: TEACHER, baseRevisionCount: 2,
    })).rejects.toThrow(/already been undone/i);
    expect((await only()).book.pageCount).toBe(184);
  });

  it('undoing an added day REMOVES it — which is a shrink, so the child is told', async () => {
    const { revision } = await new AddReadingEntry(deps()).execute({
      learnerId: LEARNER, readingId: 'rdg_a', by: TEACHER, on: '2026-09-05', page: 120, baseRevisionCount: 0,
    });
    await expect(undo().execute({
      learnerId: LEARNER, readingId: 'rdg_a', revisionId: revision.id, by: TEACHER, baseRevisionCount: 1,
    })).rejects.toThrow(/reason/i);
    expect((await only()).entries).toHaveLength(3);

    await undo().execute({
      learnerId: LEARNER, readingId: 'rdg_a', revisionId: revision.id, by: TEACHER,
      reason: 'that day was added by mistake', baseRevisionCount: 1,
    });
    const reading = await only();
    expect(reading.entries).toHaveLength(2);
    expect(notes).toHaveBeenCalledTimes(1);
    expect(notes.mock.calls[0][0].note).toContain('that day was added by mistake');
    expect(reading.revisions[1]).toMatchObject({
      verb: 'reading.undo', op: 'reading.entry.delete', toldChild: true,
    });
  });

  it('undoing a deleted day puts the evidence back, silently', async () => {
    const { revision } = await new DeleteReadingEntry(deps()).execute({
      learnerId: LEARNER, readingId: 'rdg_a', entryId: 'ent_a', by: TEACHER,
      reason: 'logged on the wrong book', baseRevisionCount: 0,
    });
    notes.mockClear();
    await undo().execute({
      learnerId: LEARNER, readingId: 'rdg_a', revisionId: revision.id, by: TEACHER, baseRevisionCount: 1,
    });
    const reading = await only();
    expect(reading.entries).toHaveLength(2);
    // The row comes back with its day, its page and its instant intact. Only
    // the id is new — the store mints entry ids and never re-uses a removed one.
    expect(reading.entries[1]).toMatchObject({ on: '2026-09-02', page: 48, at: '2026-09-02T18:00:00.000Z' });
    expect(reading.entries[1].id).not.toBe('ent_a');
    expect(notes).not.toHaveBeenCalled();
  });

  it('undoing a re-date is judged on the window it lands in, not the one it left', async () => {
    const { revision } = await new UpdateReadingEntry(deps()).execute({
      learnerId: LEARNER, readingId: 'rdg_a', entryId: 'ent_b', by: TEACHER,
      patch: { on: '2026-08-20' }, reason: 'wrong day', baseRevisionCount: 0,
    });
    notes.mockClear();
    // Undoing it brings the day back INTO the counted week: the record grew,
    // so nothing is said.
    await undo().execute({
      learnerId: LEARNER, readingId: 'rdg_a', revisionId: revision.id, by: TEACHER, baseRevisionCount: 1,
    });
    expect((await only()).entries[1].on).toBe('2026-09-03');
    expect(notes).not.toHaveBeenCalled();
  });

  it('undoing an un-finish puts the finish back, silently', async () => {
    bookLog = fakeBookLog({ [LEARNER]: [seedReading({ status: 'finished', finishedOn: '2026-09-04' })] });
    const { revision } = await new UpdateReading(deps()).execute({
      learnerId: LEARNER, readingId: 'rdg_a', by: TEACHER,
      patch: { status: 'reading' }, reason: 'finished the wrong book', baseRevisionCount: 0,
    });
    notes.mockClear();
    await undo().execute({
      learnerId: LEARNER, readingId: 'rdg_a', revisionId: revision.id, by: TEACHER, baseRevisionCount: 1,
    });
    expect(await only()).toMatchObject({ status: 'finished', finishedOn: '2026-09-04' });
    expect(notes).not.toHaveBeenCalled();
  });

  it('undoing a move sends the reading home and tells both children', async () => {
    const { revision } = await new MoveReading(deps()).execute({
      learnerId: LEARNER, readingId: 'rdg_a', toLearnerId: SIBLING, by: TEACHER,
      reason: 'wrong shelf', baseRevisionCount: 0,
    });
    notes.mockClear();
    await undo().execute({
      learnerId: SIBLING, readingId: 'rdg_a', revisionId: revision.id, by: TEACHER,
      reason: 'it was the right shelf after all', baseRevisionCount: 1,
    });
    expect(await bookLog.listForLearner(SIBLING)).toHaveLength(0);
    const home = await only(LEARNER);
    expect(home.learnerId).toBe(LEARNER);
    expect(notes).toHaveBeenCalledTimes(2);
    expect(notes.mock.calls.map((call) => call[0].learnerId)).toEqual([SIBLING, LEARNER]);
    // Inherits the verb it undoes, which is a step-up scoped to the reading.
    expect(teacherGate.assert).toHaveBeenCalledWith(expect.objectContaining({
      action: 'books.reading.reassign',
      context: expect.objectContaining({ readingId: 'rdg_a' }),
    }));
  });

  it('will not undo a move the receiving child has read against — that would delete their evidence', async () => {
    const { revision } = await new MoveReading(deps()).execute({
      learnerId: LEARNER, readingId: 'rdg_a', toLearnerId: SIBLING, by: TEACHER,
      reason: 'wrong shelf', baseRevisionCount: 0,
    });
    now = '2026-09-07T17:00:00.000Z';
    await new AddReadingEntry(deps()).execute({
      learnerId: SIBLING, readingId: 'rdg_a', by: TEACHER, on: '2026-09-07', page: 100, baseRevisionCount: 1,
    });
    await expect(undo().execute({
      learnerId: SIBLING, readingId: 'rdg_a', revisionId: revision.id, by: TEACHER,
      reason: 'changed my mind', baseRevisionCount: 2,
    })).rejects.toThrow(/has been read since|logged against/i);
    // Still theirs, and their day is still there.
    expect(await bookLog.listForLearner(LEARNER)).toHaveLength(0);
    expect((await only(SIBLING)).entries).toHaveLength(3);
  });

  it('will not undo the opening of a reading — that is a delete, and a delete says so', async () => {
    const { reading, revision } = await new AddReadingForLearner(deps()).execute({
      learnerId: LEARNER, isbn: '9780000000009', by: TEACHER, idempotencyKey: 'teacher-add-1',
    });
    await expect(undo().execute({
      learnerId: LEARNER, readingId: reading.id, revisionId: revision.id, by: TEACHER,
      reason: 'added by mistake', baseRevisionCount: 1,
    })).rejects.toThrow(/delete the reading/i);
    expect(await bookLog.listForLearner(LEARNER)).toHaveLength(2);
  });

  it('refuses a revision this reading does not have', async () => {
    await expect(undo().execute({
      learnerId: LEARNER, readingId: 'rdg_a', revisionId: 'rev_nope', by: TEACHER, baseRevisionCount: 0,
    })).rejects.toThrow(/rev_nope/);
  });

  it('refuses a stale save and undoes nothing', async () => {
    const { revision } = await new UpdateReading(deps()).execute({
      learnerId: LEARNER, readingId: 'rdg_a', by: TEACHER, patch: { pageCount: 192 }, baseRevisionCount: 0,
    });
    await expect(undo().execute({
      learnerId: LEARNER, readingId: 'rdg_a', revisionId: revision.id, by: TEACHER, baseRevisionCount: 0,
    })).rejects.toMatchObject({ code: 'STALE_SAVE' });
    expect((await only()).book.pageCount).toBe(192);
  });

  it('asks the capability before it reads anything at all', async () => {
    teacherGate = { assert: vi.fn(() => { throw new Error('Only a listed teacher can do this.'); }) };
    const listForLearner = vi.spyOn(bookLog, 'listForLearner');
    await expect(undo().execute({
      learnerId: LEARNER, readingId: 'rdg_a', revisionId: 'rev_1', by: TEACHER, baseRevisionCount: 0,
    })).rejects.toThrow(/listed teacher/);
    expect(listForLearner).not.toHaveBeenCalled();
  });
});

describe('the sentence the read serves is the sentence the verb throws', () => {
  const served = async (learnerId, readingId, revisionId) => {
    const view = await new GetLearnerReadings(deps()).execute({ learnerId, readingId });
    return view.reading.revisions.find((row) => row?.id === revisionId);
  };
  const thrown = (promise) => promise.then(() => null, (error) => error.message);

  it('a move the receiving child has logged against', async () => {
    const { revision } = await new MoveReading(deps()).execute({
      learnerId: LEARNER, readingId: 'rdg_a', toLearnerId: SIBLING, by: TEACHER,
      reason: 'wrong shelf', baseRevisionCount: 0,
    });
    now = '2026-09-07T17:00:00.000Z';
    await new AddReadingEntry(deps()).execute({
      learnerId: SIBLING, readingId: 'rdg_a', by: TEACHER, on: '2026-09-07', page: 100, baseRevisionCount: 1,
    });
    const row = await served(SIBLING, 'rdg_a', revision.id);
    expect(row.canUndo).toBe(false);
    expect(row.undoRefusal).toMatch(/A Borrowed Title has been read since it moved/);
    expect(row.undoRefusal).toBe(await thrown(undo().execute({
      learnerId: SIBLING, readingId: 'rdg_a', revisionId: revision.id, by: TEACHER,
      reason: 'changed my mind', baseRevisionCount: 2,
    })));
  });

  it('the opening of a reading', async () => {
    const { reading, revision } = await new AddReadingForLearner(deps()).execute({
      learnerId: LEARNER, isbn: '9780000000009', by: TEACHER, idempotencyKey: 'teacher-add-1',
    });
    const view = await new GetLearnerReadings(deps()).execute({ learnerId: LEARNER, readingId: reading.id });
    const row = view.reading.revisions.find((entry) => entry.id === revision.id);
    expect(row.canUndo).toBe(false);
    expect(row.undoRefusal).toBe(await thrown(undo().execute({
      learnerId: LEARNER, readingId: reading.id, revisionId: revision.id, by: TEACHER,
      reason: 'added by mistake', baseRevisionCount: 1,
    })));
  });

  it('a revision another undo already inverted', async () => {
    const { revision } = await new UpdateReading(deps()).execute({
      learnerId: LEARNER, readingId: 'rdg_a', by: TEACHER, patch: { pageCount: 192 }, baseRevisionCount: 0,
    });
    await undo().execute({ learnerId: LEARNER, readingId: 'rdg_a', revisionId: revision.id, by: TEACHER, baseRevisionCount: 1 });
    const row = await served(LEARNER, 'rdg_a', revision.id);
    expect(row.canUndo).toBe(false);
    expect(row.undoRefusal).toBe(await thrown(undo().execute({
      learnerId: LEARNER, readingId: 'rdg_a', revisionId: revision.id, by: TEACHER, baseRevisionCount: 2,
    })));
    // And the undo ITSELF is still offered — that is the way back.
    const back = await served(LEARNER, 'rdg_a', 'rev_2');
    expect(back).toMatchObject({ canUndo: true, undoRefusal: null });
  });

  it('an ordinary correction carries no sentence at all', async () => {
    await new UpdateReading(deps()).execute({
      learnerId: LEARNER, readingId: 'rdg_a', by: TEACHER, patch: { isbn: '9780000000002' }, baseRevisionCount: 0,
    });
    const view = await new GetLearnerReadings(deps()).execute({ learnerId: LEARNER, readingId: 'rdg_a' });
    expect(view.reading.revisions[0]).toMatchObject({ canUndo: true, undoRefusal: null });
  });

  it('says nothing about a move that has not been read against since', async () => {
    const { revision } = await new MoveReading(deps()).execute({
      learnerId: LEARNER, readingId: 'rdg_a', toLearnerId: SIBLING, by: TEACHER,
      reason: 'wrong shelf', baseRevisionCount: 0,
    });
    const row = await served(SIBLING, 'rdg_a', revision.id);
    expect(row).toMatchObject({ canUndo: true, undoRefusal: null });
  });
});
