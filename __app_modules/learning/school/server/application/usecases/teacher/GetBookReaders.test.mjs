/**
 * Who in the household has this book, and where they are with it — the read
 * behind the teacher console's "Log a book" sheet.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeBookLog, seedReading, fakeLauncher } from "../../../../../../../tests/_lib/school/bookLogTestSupport.mjs";
import { GetBookReaders } from "./GetBookReaders.mjs";

const ISBN = '9780000000002';
const TEACHER = 'test-user';
const ROSTER = [
  { id: 'learner_a', name: 'Learner A' },
  { id: 'learner_b', name: 'Learner B' },
  { id: 'learner_c', name: 'Learner C' },
];
const day = (on, id, extra = {}) => ({ id, on, at: `${on}T18:00:00.000Z`, source: 'panel', idempotencyKey: id, ...extra });

let teacherGate;
let bookLog;

function deps(extra = {}) {
  return {
    bookLog,
    teacherGate,
    roster: () => ROSTER,
    bookRepository: { findByIsbn: async () => ({ title: 'A Borrowed Title', pageCount: 32 }) },
    bookLogLauncher: fakeLauncher({ studyDay: '2026-09-06' }),
    clock: () => new Date('2026-09-06T17:00:00.000Z'),
    logger: { info() {}, warn() {}, error() {} },
    ...extra,
  };
}

beforeEach(() => {
  teacherGate = { assert: vi.fn() };
  bookLog = fakeBookLog({
    // Finished it TODAY.
    learner_a: [seedReading({
      id: 'rdg_a', book: { isbn: ISBN, pageCount: 32 }, status: 'finished', finishedOn: '2026-09-06',
      entries: [day('2026-09-06', 'ent_a', { source: 'teacher' })],
    })],
    // Finished it once before, and is reading it again now.
    learner_b: [
      seedReading({
        id: 'rdg_old', learnerId: 'learner_b', book: { isbn: ISBN, pageCount: 32 }, status: 'finished',
        openedOn: '2026-08-01', finishedOn: '2026-08-03', entries: [day('2026-08-03', 'ent_old')],
      }),
      seedReading({
        id: 'rdg_b', learnerId: 'learner_b', book: { isbn: ISBN, pageCount: 32 }, progressMode: 'check',
        status: 'reading', openedOn: '2026-09-01', entries: [day('2026-09-02', 'ent_b')],
        revisions: [{ id: 'rev_1' }, { id: 'rev_2' }],
      }),
    ],
    // learner_c has no shelf file at all.
  });
});

const rowFor = (view, learnerId) => view.readers.find((row) => row.learnerId === learnerId);

describe('GetBookReaders', () => {
  it('lists every enrolled learner, in roster order, against the household study day', async () => {
    const view = await new GetBookReaders(deps()).execute({ isbn: ISBN, by: TEACHER });
    expect(view).toMatchObject({ isbn: ISBN, studyDay: '2026-09-06', pageCount: 32, suggestedMode: 'check' });
    expect(view.readers.map((row) => row.learnerId)).toEqual(['learner_a', 'learner_b', 'learner_c']);
    expect(rowFor(view, 'learner_a').name).toBe('Learner A');
  });

  it('marks a child who already logged this book today', async () => {
    const view = await new GetBookReaders(deps()).execute({ isbn: ISBN, by: TEACHER });
    expect(rowFor(view, 'learner_a')).toMatchObject({ today: true, openReadingId: null, openReading: null });
  });

  it('counts a reading opened on the study day, with nothing logged yet, as today', async () => {
    bookLog = fakeBookLog({
      learner_c: [seedReading({
        id: 'rdg_c', learnerId: 'learner_c', book: { isbn: ISBN, pageCount: 32 }, progressMode: 'check',
        status: 'unread', openedOn: '2026-09-06', entries: [],
      })],
    });
    const view = await new GetBookReaders(deps()).execute({ isbn: ISBN, by: TEACHER });
    expect(rowFor(view, 'learner_c')).toMatchObject({ today: true, openReadingId: 'rdg_c' });
  });

  it('counts a day logged on the study day as today, on a reading opened earlier and not finished', async () => {
    bookLog = fakeBookLog({
      learner_c: [seedReading({
        id: 'rdg_c', learnerId: 'learner_c', book: { isbn: ISBN, pageCount: 32 }, progressMode: 'check',
        status: 'reading', openedOn: '2026-09-01', entries: [day('2026-09-06', 'ent_c')],
      })],
    });
    const view = await new GetBookReaders(deps()).execute({ isbn: ISBN, by: TEACHER });
    expect(rowFor(view, 'learner_c')).toMatchObject({ today: true, openReadingId: 'rdg_c' });
  });

  it('names the open reading, with what a write to it must carry', async () => {
    const view = await new GetBookReaders(deps()).execute({ isbn: ISBN, by: TEACHER });
    expect(rowFor(view, 'learner_b')).toMatchObject({
      today: false,
      openReadingId: 'rdg_b',
      openReading: { id: 'rdg_b', progressMode: 'check', pageCount: 32, revisionCount: 2 },
    });
  });

  it('gives a child with no shelf file a plain row, not an error', async () => {
    const view = await new GetBookReaders(deps()).execute({ isbn: ISBN, by: TEACHER });
    expect(rowFor(view, 'learner_c')).toEqual({
      learnerId: 'learner_c', name: 'Learner C', suggestedMode: 'check',
      today: false, openReadingId: null, openReading: null, unreadable: false,
    });
  });

  it('suggests page mode for a book of 64 pages or more', async () => {
    const view = await new GetBookReaders(deps({
      bookRepository: { findByIsbn: async () => ({ title: 'A Long One', pageCount: 200 }) },
    })).execute({ isbn: ISBN, by: TEACHER });
    expect(view.suggestedMode).toBe('page');
    expect(view.readers.every((row) => row.suggestedMode === 'page')).toBe(true);
  });

  it('answers for an ISBN no catalog knows: no length, check mode, every learner still listed', async () => {
    const view = await new GetBookReaders(deps({
      bookRepository: { findByIsbn: async () => null },
    })).execute({ isbn: '9780000000019', by: TEACHER });
    expect(view).toMatchObject({ pageCount: null, suggestedMode: 'check' });
    expect(view.readers).toHaveLength(3);
    expect(view.readers.every((row) => !row.today && !row.openReadingId)).toBe(true);
  });

  it('names an unreadable shelf on its own row instead of failing the whole read', async () => {
    const real = bookLog;
    bookLog = {
      ...real,
      listForLearner: async (learnerId) => {
        if (learnerId === 'learner_c') throw new Error('shelf unreadable');
        return real.listForLearner(learnerId);
      },
    };
    const view = await new GetBookReaders(deps()).execute({ isbn: ISBN, by: TEACHER });
    expect(rowFor(view, 'learner_c')).toMatchObject({ unreadable: true, today: false, openReadingId: null });
    expect(rowFor(view, 'learner_b').openReadingId).toBe('rdg_b');
  });

  it('asserts the teacher gate before reading anything', async () => {
    teacherGate.assert.mockImplementation(() => { throw new Error('Only a listed teacher can do this.'); });
    const spy = vi.spyOn(bookLog, 'listForLearner');
    await expect(new GetBookReaders(deps()).execute({ isbn: ISBN, by: TEACHER })).rejects.toThrow(/listed teacher/);
    expect(spy).not.toHaveBeenCalled();
    expect(teacherGate.assert).toHaveBeenCalledWith(expect.objectContaining({
      userId: TEACHER, action: 'books.readers.read', context: expect.objectContaining({ isbn: ISBN }),
    }));
  });

  it('refuses something that is not a 13-digit ISBN', async () => {
    await expect(new GetBookReaders(deps()).execute({ isbn: '12345', by: TEACHER })).rejects.toThrow(/isbn/i);
  });

  it('writes nothing', async () => {
    // The seeded shelves only: the fake store materialises an empty shelf for
    // learner_c on first read, which is the fake's bookkeeping, not a write.
    const seeded = () => JSON.stringify(['learner_a', 'learner_b'].map((id) => bookLog.shelves.get(id)));
    const before = seeded();
    await new GetBookReaders(deps()).execute({ isbn: ISBN, by: TEACHER });
    expect(seeded()).toBe(before);
  });

  it('requires a roster accessor', () => {
    expect(() => new GetBookReaders({ ...deps(), roster: null })).toThrow(/roster/);
  });
});
