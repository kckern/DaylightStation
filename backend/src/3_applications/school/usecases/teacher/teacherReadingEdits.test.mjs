/**
 * The grown-up's verbs over a child's reading shelf (teacher reading admin
 * design §3, §7).
 *
 * Three rules carry every case below and each is asserted per verb rather than
 * once in the abstract:
 *
 * 1. Every write appends a revision — `{id, by, at, verb, before, after,
 *    reason, toldChild}` — because history is the only route back.
 * 2. Five verbs tell the child (the record got SMALLER); the rest are silent,
 *    because a feed of "a grown-up fixed the page count" teaches a child to
 *    ignore the feed.
 * 3. A stale `baseRevisionCount` is refused and writes NOTHING. Never merged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeBookLog, seedReading, fakeLauncher } from '../../../../../../tests/_lib/school/bookLogTestSupport.mjs';
import { GetLearnerReadings } from './GetLearnerReadings.mjs';
import { UpdateReading } from './UpdateReading.mjs';
import { AddReadingEntry } from './AddReadingEntry.mjs';
import { UpdateReadingEntry } from './UpdateReadingEntry.mjs';
import { DeleteReadingEntry } from './DeleteReadingEntry.mjs';
import { AddReadingForLearner } from './AddReadingForLearner.mjs';
import { MoveReading } from './MoveReading.mjs';
import { DeleteReading } from './DeleteReading.mjs';

const LEARNER = 'learner_a';
const SIBLING = 'learner_b';
const TEACHER = 'test-user';
const AT = '2026-09-06T17:00:00.000Z';

let notes;
let bookLog;
let teacherGate;

const recordTeacherNote = () => ({ execute: notes });

function deps(extra = {}) {
  let minted = 0;
  return {
    bookLog,
    teacherGate,
    recordTeacherNote: recordTeacherNote(),
    bookRepository: { findByIsbn: async () => ({ title: 'A Borrowed Title' }) },
    bookLogLauncher: fakeLauncher(),
    clock: () => new Date(AT),
    idGen: () => { minted += 1; return `rev_${minted}`; },
    logger: { info() {}, warn() {}, error() {} },
    ...extra,
  };
}

beforeEach(() => {
  notes = vi.fn(async () => ({ entry: { id: 'note_1' } }));
  teacherGate = { assert: vi.fn() };
  bookLog = fakeBookLog({ [LEARNER]: [seedReading()], [SIBLING]: [] });
});

const only = async (learnerId = LEARNER) => (await bookLog.listForLearner(learnerId))[0];

describe('GetLearnerReadings', () => {
  it('hands back every reading with its entries, its revisions and the count an editor must send back', async () => {
    const view = await new GetLearnerReadings(deps()).execute({ learnerId: LEARNER });
    expect(view.learnerId).toBe(LEARNER);
    expect(view.readings).toHaveLength(1);
    expect(view.readings[0]).toMatchObject({
      id: 'rdg_a', title: 'A Borrowed Title', baseRevisionCount: 0,
    });
    expect(view.readings[0].entries).toHaveLength(2);
    expect(view.readings[0].projection).toMatchObject({ status: 'reading', page: 84, daysRead: 2 });
  });

  it('names one reading with its full history when asked for it', async () => {
    const view = await new GetLearnerReadings(deps()).execute({ learnerId: LEARNER, readingId: 'rdg_a' });
    expect(view.reading.id).toBe('rdg_a');
    expect(view.reading.revisions).toEqual([]);
  });

  it('refuses a reading the child does not have rather than answering an empty one', async () => {
    await expect(new GetLearnerReadings(deps()).execute({ learnerId: LEARNER, readingId: 'rdg_nope' }))
      .rejects.toThrow(/rdg_nope/);
  });

  // Invariant 7: observation costs nothing.
  it('writes nothing at all', async () => {
    const before = JSON.stringify(await bookLog.listForLearner(LEARNER));
    await new GetLearnerReadings(deps()).execute({ learnerId: LEARNER });
    expect(JSON.stringify(await bookLog.listForLearner(LEARNER))).toBe(before);
    expect(notes).not.toHaveBeenCalled();
  });

  it('still answers when the books API is not wired — titleless, with the ISBN', async () => {
    const view = await new GetLearnerReadings(deps({ bookRepository: null })).execute({ learnerId: LEARNER });
    expect(view.readings[0]).toMatchObject({ title: null, isbn: '9780000000001' });
  });
});

describe('UpdateReading', () => {
  it('corrects a mis-scanned ISBN silently, and says so in the history', async () => {
    const result = await new UpdateReading(deps()).execute({
      learnerId: LEARNER, readingId: 'rdg_a', by: TEACHER,
      patch: { isbn: '9780000000002' }, baseRevisionCount: 0,
    });
    expect((await only()).book.isbn).toBe('9780000000002');
    expect(notes).not.toHaveBeenCalled();
    expect(result.revision).toMatchObject({
      id: 'rev_1', by: TEACHER, at: AT, verb: 'reading.update',
      before: { isbn: '9780000000001' }, after: { isbn: '9780000000002' },
      reason: null, toldChild: false,
    });
    expect((await only()).revisions).toHaveLength(1);
  });

  it('corrects a page count and a mode without telling the child', async () => {
    await new UpdateReading(deps()).execute({
      learnerId: LEARNER, readingId: 'rdg_a', by: TEACHER,
      patch: { pageCount: 192, progressMode: 'minutes' }, baseRevisionCount: 0,
    });
    const reading = await only();
    expect(reading.book.pageCount).toBe(192);
    expect(reading.progressMode).toBe('minutes');
    expect(notes).not.toHaveBeenCalled();
  });

  it('marks a book finished on a chosen day, silently', async () => {
    await new UpdateReading(deps()).execute({
      learnerId: LEARNER, readingId: 'rdg_a', by: TEACHER,
      patch: { status: 'finished', finishedOn: '2026-09-04' }, baseRevisionCount: 0,
    });
    expect(await only()).toMatchObject({ status: 'finished', finishedOn: '2026-09-04' });
    expect(notes).not.toHaveBeenCalled();
  });

  it('un-finishing takes a book off the finished pile, so it needs a reason and tells the child', async () => {
    bookLog = fakeBookLog({ [LEARNER]: [seedReading({ status: 'finished', finishedOn: '2026-09-04' })] });
    const use = new UpdateReading(deps());
    await expect(use.execute({
      learnerId: LEARNER, readingId: 'rdg_a', by: TEACHER,
      patch: { status: 'reading' }, baseRevisionCount: 0,
    })).rejects.toThrow(/reason/i);
    expect((await only()).status).toBe('finished');

    const result = await use.execute({
      learnerId: LEARNER, readingId: 'rdg_a', by: TEACHER,
      patch: { status: 'reading' }, reason: 'finished the wrong book', baseRevisionCount: 0,
    });
    expect(await only()).toMatchObject({ status: 'reading', finishedOn: null });
    expect(notes).toHaveBeenCalledTimes(1);
    const sent = notes.mock.calls[0][0];
    expect(sent.learnerId).toBe(LEARNER);
    expect(sent.from).toBe(TEACHER);
    expect(sent.note).toContain('A Borrowed Title');
    expect(sent.note).toContain('finished the wrong book');
    expect(result.revision.toldChild).toBe(true);
  });

  it('setting a book aside is not a shrink — no reason, no note', async () => {
    await new UpdateReading(deps()).execute({
      learnerId: LEARNER, readingId: 'rdg_a', by: TEACHER,
      patch: { status: 'set-aside' }, baseRevisionCount: 0,
    });
    expect((await only()).status).toBe('set-aside');
    expect(notes).not.toHaveBeenCalled();
  });

  it('setting a FINISHED book aside is still an un-finish — the finished pile lost it', async () => {
    bookLog = fakeBookLog({ [LEARNER]: [seedReading({ status: 'finished', finishedOn: '2026-09-04' })] });
    const use = new UpdateReading(deps());
    await expect(use.execute({
      learnerId: LEARNER, readingId: 'rdg_a', by: TEACHER,
      patch: { status: 'set-aside' }, baseRevisionCount: 0,
    })).rejects.toThrow(/reason/i);
    await use.execute({
      learnerId: LEARNER, readingId: 'rdg_a', by: TEACHER,
      patch: { status: 'set-aside' }, reason: 'it was never finished', baseRevisionCount: 0,
    });
    expect(await only()).toMatchObject({ status: 'set-aside', finishedOn: null });
    expect(notes).toHaveBeenCalledTimes(1);
  });

  it('records that the child was NOT told when the note could not be delivered', async () => {
    bookLog = fakeBookLog({ [LEARNER]: [seedReading({ status: 'finished', finishedOn: '2026-09-04' })] });
    notes = vi.fn(async () => { throw new Error('notes store is unreadable'); });
    const result = await new UpdateReading(deps()).execute({
      learnerId: LEARNER, readingId: 'rdg_a', by: TEACHER,
      patch: { status: 'reading' }, reason: 'finished the wrong book', baseRevisionCount: 0,
    });
    expect(result.revision.toldChild).toBe(false);
    expect((await only()).revisions[0].toldChild).toBe(false);
  });

  it('asserts the capability for this learner and this reading', async () => {
    await new UpdateReading(deps()).execute({
      learnerId: LEARNER, readingId: 'rdg_a', by: TEACHER,
      patch: { isbn: '9780000000002' }, baseRevisionCount: 0,
    });
    expect(teacherGate.assert).toHaveBeenCalledWith({
      userId: TEACHER, pin: null, action: 'books.reading.update',
      context: { learnerId: LEARNER, readingId: 'rdg_a' },
    });
  });

  it('refuses a stale save and writes nothing', async () => {
    const use = new UpdateReading(deps());
    await use.execute({ learnerId: LEARNER, readingId: 'rdg_a', by: TEACHER, patch: { pageCount: 192 }, baseRevisionCount: 0 });
    await expect(use.execute({
      learnerId: LEARNER, readingId: 'rdg_a', by: TEACHER, patch: { pageCount: 200 }, baseRevisionCount: 0,
    })).rejects.toMatchObject({ code: 'STALE_SAVE' });
    const reading = await only();
    expect(reading.book.pageCount).toBe(192);
    expect(reading.revisions).toHaveLength(1);
  });

  it('will not take a write with no baseRevisionCount at all', async () => {
    await expect(new UpdateReading(deps()).execute({
      learnerId: LEARNER, readingId: 'rdg_a', by: TEACHER, patch: { pageCount: 192 },
    })).rejects.toThrow(/baseRevisionCount/);
  });
});

describe('AddReadingEntry', () => {
  it('adds a day they read, stamped as the teacher\'s, and says nothing to the child', async () => {
    const result = await new AddReadingEntry(deps()).execute({
      learnerId: LEARNER, readingId: 'rdg_a', by: TEACHER,
      on: '2026-09-05', page: 120, baseRevisionCount: 0,
    });
    const reading = await only();
    expect(reading.entries).toHaveLength(3);
    expect(reading.entries[2]).toMatchObject({ on: '2026-09-05', page: 120, source: 'teacher' });
    expect(notes).not.toHaveBeenCalled();
    expect(result.revision).toMatchObject({ verb: 'reading.entry.add', toldChild: false });
    expect(reading.revisions).toHaveLength(1);
  });

  it('refuses a day that is not a real calendar day', async () => {
    await expect(new AddReadingEntry(deps()).execute({
      learnerId: LEARNER, readingId: 'rdg_a', by: TEACHER, on: '2026-02-31', page: 12, baseRevisionCount: 0,
    })).rejects.toThrow(/day/i);
  });

  it('refuses an entry with nothing in it', async () => {
    await expect(new AddReadingEntry(deps()).execute({
      learnerId: LEARNER, readingId: 'rdg_a', by: TEACHER, on: '2026-09-05', baseRevisionCount: 0,
    })).rejects.toThrow(/page|minutes|check/i);
  });
});

describe('UpdateReadingEntry', () => {
  it('fixes a page typed wrong, silently', async () => {
    const result = await new UpdateReadingEntry(deps()).execute({
      learnerId: LEARNER, readingId: 'rdg_a', entryId: 'ent_b', by: TEACHER,
      patch: { page: 48 }, baseRevisionCount: 0,
    });
    expect((await only()).entries[1].page).toBe(48);
    expect(notes).not.toHaveBeenCalled();
    expect(result.revision).toMatchObject({
      verb: 'reading.entry.update', before: { page: 84 }, after: { page: 48 }, toldChild: false,
    });
  });

  it('re-dating inside the counted window says nothing — the week still holds the day', async () => {
    await new UpdateReadingEntry(deps()).execute({
      learnerId: LEARNER, readingId: 'rdg_a', entryId: 'ent_b', by: TEACHER,
      patch: { on: '2026-09-04' }, baseRevisionCount: 0,
    });
    expect((await only()).entries[1].on).toBe('2026-09-04');
    expect(notes).not.toHaveBeenCalled();
  });

  it('re-dating OUT of the counted window shrinks the record — reason required, child told', async () => {
    const use = new UpdateReadingEntry(deps());
    await expect(use.execute({
      learnerId: LEARNER, readingId: 'rdg_a', entryId: 'ent_b', by: TEACHER,
      patch: { on: '2026-08-20' }, baseRevisionCount: 0,
    })).rejects.toThrow(/reason/i);
    expect((await only()).entries[1].on).toBe('2026-09-03');

    const result = await use.execute({
      learnerId: LEARNER, readingId: 'rdg_a', entryId: 'ent_b', by: TEACHER,
      patch: { on: '2026-08-20' }, reason: 'logged on the wrong day', baseRevisionCount: 0,
    });
    expect((await only()).entries[1].on).toBe('2026-08-20');
    expect(notes).toHaveBeenCalledTimes(1);
    expect(notes.mock.calls[0][0].note).toContain('logged on the wrong day');
    expect(result.revision.toldChild).toBe(true);
  });

  it('treats a learner with no obligation as having no counted window to leave', async () => {
    await new UpdateReadingEntry(deps({ bookLogLauncher: fakeLauncher({ per: null }) })).execute({
      learnerId: LEARNER, readingId: 'rdg_a', entryId: 'ent_b', by: TEACHER,
      patch: { on: '2026-08-20' }, baseRevisionCount: 0,
    });
    expect(notes).not.toHaveBeenCalled();
  });
});

describe('DeleteReadingEntry', () => {
  it('always needs a reason, and always tells the child', async () => {
    const use = new DeleteReadingEntry(deps());
    await expect(use.execute({
      learnerId: LEARNER, readingId: 'rdg_a', entryId: 'ent_a', by: TEACHER, baseRevisionCount: 0,
    })).rejects.toThrow(/reason/i);
    expect((await only()).entries).toHaveLength(2);

    const result = await use.execute({
      learnerId: LEARNER, readingId: 'rdg_a', entryId: 'ent_a', by: TEACHER,
      reason: 'logged on the wrong book', baseRevisionCount: 0,
    });
    const reading = await only();
    expect(reading.entries.map((entry) => entry.id)).toEqual(['ent_b']);
    expect(notes).toHaveBeenCalledTimes(1);
    expect(notes.mock.calls[0][0].note).toContain('logged on the wrong book');
    // The whole row is kept in `before`, which is what makes the undo possible.
    expect(result.revision.before).toMatchObject({ id: 'ent_a', on: '2026-09-02', page: 48 });
    expect(reading.revisions[0]).toMatchObject({ verb: 'reading.entry.delete', toldChild: true });
  });
});

describe('AddReadingForLearner', () => {
  it('opens a book on the child\'s behalf, stamped teacher, silently', async () => {
    const result = await new AddReadingForLearner(deps()).execute({
      learnerId: LEARNER, isbn: '9780000000009', pageCount: 96, progressMode: 'page',
      openedOn: '2026-09-06', by: TEACHER, idempotencyKey: 'teacher-add-1',
    });
    const shelf = await bookLog.listForLearner(LEARNER);
    expect(shelf).toHaveLength(2);
    expect(result.reading).toMatchObject({ book: { isbn: '9780000000009' }, status: 'reading' });
    expect(result.revision).toMatchObject({ verb: 'reading.add', toldChild: false });
    expect(shelf[1].revisions).toHaveLength(1);
    expect(notes).not.toHaveBeenCalled();
  });

  it('is idempotent on the key, and does not record a second opening', async () => {
    const use = new AddReadingForLearner(deps());
    const args = { learnerId: LEARNER, isbn: '9780000000009', by: TEACHER, idempotencyKey: 'teacher-add-1' };
    await use.execute(args);
    await use.execute(args);
    const shelf = await bookLog.listForLearner(LEARNER);
    expect(shelf).toHaveLength(2);
    expect(shelf[1].revisions).toHaveLength(1);
  });

  it('needs an ISBN to open anything at all', async () => {
    await expect(new AddReadingForLearner(deps()).execute({ learnerId: LEARNER, by: TEACHER }))
      .rejects.toThrow(/isbn/i);
  });
});

describe('MoveReading', () => {
  it('moves the reading, tells BOTH children, and is scoped to the reading for step-up', async () => {
    const result = await new MoveReading(deps()).execute({
      learnerId: LEARNER, readingId: 'rdg_a', toLearnerId: SIBLING, by: TEACHER,
      reason: 'it was the wrong shelf', baseRevisionCount: 0,
    });
    expect(await bookLog.listForLearner(LEARNER)).toHaveLength(0);
    const moved = await only(SIBLING);
    expect(moved).toMatchObject({ id: 'rdg_a', learnerId: SIBLING });
    expect(moved.revisions).toHaveLength(1);
    expect(moved.revisions[0]).toMatchObject({
      verb: 'reading.move', before: { learnerId: LEARNER }, after: { learnerId: SIBLING }, toldChild: true,
    });
    expect(notes).toHaveBeenCalledTimes(2);
    expect(notes.mock.calls.map((call) => call[0].learnerId)).toEqual([LEARNER, SIBLING]);
    expect(teacherGate.assert).toHaveBeenCalledWith(expect.objectContaining({
      action: 'books.reading.reassign',
      context: { learnerId: LEARNER, readingId: 'rdg_a', toLearnerId: SIBLING },
    }));
    expect(result.revision.reason).toBe('it was the wrong shelf');
  });

  it('needs a reason', async () => {
    await expect(new MoveReading(deps()).execute({
      learnerId: LEARNER, readingId: 'rdg_a', toLearnerId: SIBLING, by: TEACHER, baseRevisionCount: 0,
    })).rejects.toThrow(/reason/i);
    expect(await bookLog.listForLearner(LEARNER)).toHaveLength(1);
  });

  it('refuses a move to the shelf it is already on', async () => {
    await expect(new MoveReading(deps()).execute({
      learnerId: LEARNER, readingId: 'rdg_a', toLearnerId: LEARNER, by: TEACHER,
      reason: 'nowhere', baseRevisionCount: 0,
    })).rejects.toThrow(/same|already/i);
  });
});

describe('DeleteReading', () => {
  it('destroys the reading, with a reason the child hears', async () => {
    const result = await new DeleteReading(deps()).execute({
      learnerId: LEARNER, readingId: 'rdg_a', by: TEACHER,
      reason: 'this was scanned twice', baseRevisionCount: 0,
    });
    expect(await bookLog.listForLearner(LEARNER)).toHaveLength(0);
    expect(notes).toHaveBeenCalledTimes(1);
    expect(notes.mock.calls[0][0].note).toContain('this was scanned twice');
    expect(result.revision).toMatchObject({ verb: 'reading.delete', toldChild: true });
    // Nothing survives to append the revision TO, so it comes back with the
    // removed reading and is logged — that is the whole trail there can be.
    expect(result.removed.id).toBe('rdg_a');
  });

  it('needs a reason, and destroys nothing without one', async () => {
    await expect(new DeleteReading(deps()).execute({
      learnerId: LEARNER, readingId: 'rdg_a', by: TEACHER, baseRevisionCount: 0,
    })).rejects.toThrow(/reason/i);
    expect(await bookLog.listForLearner(LEARNER)).toHaveLength(1);
  });

  it('is scoped to the reading for step-up', async () => {
    await new DeleteReading(deps()).execute({
      learnerId: LEARNER, readingId: 'rdg_a', by: TEACHER, reason: 'scanned twice', baseRevisionCount: 0,
    });
    expect(teacherGate.assert).toHaveBeenCalledWith(expect.objectContaining({
      action: 'books.reading.delete', context: { learnerId: LEARNER, readingId: 'rdg_a' },
    }));
  });

  it('refuses a stale save and destroys nothing', async () => {
    await expect(new DeleteReading(deps()).execute({
      learnerId: LEARNER, readingId: 'rdg_a', by: TEACHER, reason: 'scanned twice', baseRevisionCount: 3,
    })).rejects.toMatchObject({ code: 'STALE_SAVE' });
    expect(await bookLog.listForLearner(LEARNER)).toHaveLength(1);
    expect(notes).not.toHaveBeenCalled();
  });
});

describe('the gate runs before anything is read or written', () => {
  it('refuses every verb without touching the shelf', async () => {
    teacherGate = { assert: vi.fn(() => { throw new Error('Only a listed teacher can do this.'); }) };
    const listForLearner = vi.spyOn(bookLog, 'listForLearner');
    const cases = [
      [new UpdateReading(deps()), { learnerId: LEARNER, readingId: 'rdg_a', patch: { pageCount: 1 }, baseRevisionCount: 0 }],
      [new AddReadingEntry(deps()), { learnerId: LEARNER, readingId: 'rdg_a', on: '2026-09-05', page: 1, baseRevisionCount: 0 }],
      [new UpdateReadingEntry(deps()), { learnerId: LEARNER, readingId: 'rdg_a', entryId: 'ent_a', patch: { page: 1 }, baseRevisionCount: 0 }],
      [new DeleteReadingEntry(deps()), { learnerId: LEARNER, readingId: 'rdg_a', entryId: 'ent_a', reason: 'x', baseRevisionCount: 0 }],
      [new AddReadingForLearner(deps()), { learnerId: LEARNER, isbn: '9780000000009' }],
      [new MoveReading(deps()), { learnerId: LEARNER, readingId: 'rdg_a', toLearnerId: SIBLING, reason: 'x', baseRevisionCount: 0 }],
      [new DeleteReading(deps()), { learnerId: LEARNER, readingId: 'rdg_a', reason: 'x', baseRevisionCount: 0 }],
      [new GetLearnerReadings(deps()), { learnerId: LEARNER }],
    ];
    for (const [use, args] of cases) {
      await expect(use.execute({ ...args, by: TEACHER })).rejects.toThrow(/listed teacher/);
    }
    expect(listForLearner).not.toHaveBeenCalled();
    expect(notes).not.toHaveBeenCalled();
  });
});
