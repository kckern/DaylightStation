import { describe, expect, it } from 'vitest';
import { BookLogProgramLauncher } from './BookLogProgramLauncher.mjs';

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
const CLOCK = () => new Date('2026-08-09T18:00:00Z'); // Sunday, still 2026-08-09 in PT

const assignmentsWith = (enrollment) => ({
  async get(learnerId) {
    return { learnerId, programs: enrollment ? [enrollment] : [] };
  },
});
const brokenAssignments = { async get() { throw new Error('unreadable'); } };
const storeWith = (items) => ({ async listForLearner() { return items; } });
const brokenStore = { async listForLearner() { throw new Error('unreadable'); } };

const launcher = (enrollment, items = [], overrides = {}) => new BookLogProgramLauncher({
  assignments: assignmentsWith(enrollment),
  bookLog: storeWith(items),
  timezone: 'America/Los_Angeles',
  clock: CLOCK,
  logger: silentLogger,
  ...overrides,
});

const enrolled = (obligation = null) => ({ programId: 'book-log', obligation, subject: 'english' });
const item = (overrides = {}) => ({ bookId: 'b1', progressMode: 'page', pageCount: 184, events: [], ...overrides });

describe('BookLogProgramLauncher', () => {
  it('requires the real assignment port shape at construction', () => {
    expect(() => new BookLogProgramLauncher({
      assignments: { async listForLearner() { return []; } },
      bookLog: storeWith([]),
    })).toThrow(/get\(learnerId\)/);
  });

  it('is the book-log program and says where it lives', () => {
    const instance = launcher(enrolled());
    expect(instance.id).toBe('book-log');
    expect(instance.locationHint).toMatch(/\w/);
  });

  it('takes { userId } like every sibling launcher — a bare string fails loudly, not as "not enrolled"', async () => {
    // collectProgramStatuses calls `launcher.status({ userId, programInstance })`.
    // A string-shaped call used to fall through to `enrolled: false`, which
    // reads as a child with no shelf rather than a caller on the wrong shape.
    await expect(launcher(enrolled()).status('kid')).rejects.toThrow(TypeError);
    await expect(launcher(enrolled()).status()).rejects.toThrow(/userId/);
  });

  it('accepts and ignores programInstance — there is one shelf per learner', async () => {
    expect(await launcher(enrolled()).status({ userId: 'kid', programInstance: 'shelf' }))
      .toMatchObject({ enrolled: true, error: false });
  });

  describe('three distinguishable answers', () => {
    it('reports NOT ENROLLED without calling it an error', async () => {
      expect(await launcher(null).status({ userId: 'kid' })).toMatchObject({ enrolled: false, error: false });
    });

    it('reports an unreadable assignment record as an ERROR', async () => {
      expect((await launcher(enrolled(), [], { assignments: brokenAssignments }).status({ userId: 'kid' })).error).toBe(true);
    });

    it('reports an unreadable shelf as an ERROR, never as zero', async () => {
      // A false zero shows a child who read four books as owing four books.
      const status = await launcher(enrolled({ metric: 'books', quantity: 2, per: 'week', scope: null }), [],
        { bookLog: brokenStore }).status({ userId: 'kid' });
      expect(status.error).toBe(true);
    });

    it('an unreadable shelf still names itself, so the card has artwork to draw', async () => {
      // A `context: null` is the blank-artwork case the poster route refuses.
      // Not being able to read what is ON the shelf does not make it nameless.
      const status = await launcher(enrolled({ metric: 'books', quantity: 2, per: 'week', scope: null }), [],
        { bookLog: brokenStore }).status({ userId: 'kid' });
      expect(status.context?.course?.title).toBeTruthy();
      expect(status.context?.course?.id).toBe('program:book-log');
    });
  });

  describe('with no obligation, nothing is ever owed', () => {
    it('is neither done nor owed — null keeps the subject unserved AND unnagged', async () => {
      // agenda.mjs:259 `programDone = statuses.some(s => s.doneToday === true)`
      // A `true` here marked English served for the day and made the reading
      // code answer "All done" instead of mounting the shelf.
      expect(await launcher(enrolled(), [item()]).status({ userId: 'kid' }))
        .toMatchObject({ enrolled: true, error: false, doneToday: null, terminal: false });
    });

    it('still describes the shelf, because presence is the point', async () => {
      const status = await launcher(enrolled(), [
        item({ events: [{ kind: 'progress', at: '2026-08-09T10:00:00Z', page: 84 }] }),
        item({ bookId: 'b2', events: [{ kind: 'finished', at: '2026-08-01T10:00:00Z' }] }),
      ]).status({ userId: 'kid' });
      expect(status.reading).toBe(1);
      expect(status.finished).toBe(1);
      expect(status.progressLabel).toMatch(/reading/i);
    });
  });

  describe('with a daily obligation', () => {
    const pagesPerDay = { metric: 'pages', quantity: 20, per: 'day', scope: null };

    it('is not done when today has no reading', async () => {
      const status = await launcher(enrolled(pagesPerDay), [
        item({ events: [{ kind: 'progress', at: '2026-08-05T10:00:00Z', page: 40 }] }),
      ]).status({ userId: 'kid' });
      expect(status.doneToday).toBe(false);
      expect(status.obligationProgress).toMatchObject({ actual: 0, target: 20, per: 'day' });
    });

    it('is done once today clears the target', async () => {
      const status = await launcher(enrolled(pagesPerDay), [
        item({ events: [
          { kind: 'progress', at: '2026-08-08T10:00:00Z', page: 40 },
          // 18:00Z = 11am PDT — unambiguously study-day 2026-08-09. (10:00Z would be
          // 3am PDT, before the 4am boundary, and belong to the 8th.)
          { kind: 'progress', at: '2026-08-09T18:00:00Z', page: 84 },
        ] }),
      ]).status({ userId: 'kid' });
      expect(status.doneToday).toBe(true);
      expect(status.obligationProgress.actual).toBe(44);
    });
  });

  describe('with a weekly obligation', () => {
    const booksPerWeek = { metric: 'books', quantity: 2, per: 'week', scope: null };

    it('reads DONE TODAY as "nothing owed today" once the week is met', async () => {
      // A weekly target unmet on six days of seven would be a permanent red
      // tile for a child who is on track.
      const status = await launcher(enrolled(booksPerWeek), [
        item({ events: [{ kind: 'finished', at: '2026-08-04T10:00:00Z' }] }),
        item({ bookId: 'b2', events: [{ kind: 'finished', at: '2026-08-06T10:00:00Z' }] }),
      ]).status({ userId: 'kid' });
      expect(status.doneToday).toBe(true);
      expect(status.obligationProgress).toMatchObject({ actual: 2, target: 2 });
    });

    it('is not done while the week is short', async () => {
      const status = await launcher(enrolled(booksPerWeek), [
        item({ events: [{ kind: 'finished', at: '2026-08-06T10:00:00Z' }] }),
      ]).status({ userId: 'kid' });
      expect(status.doneToday).toBe(false);
    });
  });

  describe('with a once obligation — read this series', () => {
    const series = {
      metric: 'books', quantity: 2, per: 'once',
      scope: { books: ['narnia-1', 'narnia-2'], label: 'Narnia' },
    };
    const bothFinished = [
      item({ bookId: 'narnia-1', events: [{ kind: 'finished', at: '2026-02-01T10:00:00Z' }] }),
      item({ bookId: 'narnia-2', events: [{ kind: 'finished', at: '2026-07-14T10:00:00Z' }] }),
    ];

    it('counts finishes from any time, not just this week', async () => {
      const status = await launcher(enrolled(series), bothFinished).status({ userId: 'kid' });
      expect(status.obligationProgress.actual).toBe(2);
      expect(status.doneToday).toBe(true);
    });

    it('is TERMINAL once complete — a finished series leaves the agenda', async () => {
      expect((await launcher(enrolled(series), bothFinished).status({ userId: 'kid' })).terminal).toBe(true);
    });

    it('is not terminal while the series is unfinished', async () => {
      const status = await launcher(enrolled(series), [bothFinished[0]]).status({ userId: 'kid' });
      expect(status.terminal).toBe(false);
    });

    it('a daily obligation is never terminal — tomorrow it asks again', async () => {
      const status = await launcher(enrolled({ metric: 'checkins', quantity: 1, per: 'day', scope: null }), [
        // 18:00Z = 11am PDT — unambiguously study-day 2026-08-09. (10:00Z would be
        // 3am PDT, before the 4am boundary, and belong to the 8th.)
        item({ events: [{ kind: 'progress', at: '2026-08-09T18:00:00Z', page: 4 }] }),
      ]).status({ userId: 'kid' });
      expect(status).toMatchObject({ doneToday: true, terminal: false });
    });
  });

  it('surfaces books whose mode cannot satisfy the metric', async () => {
    const status = await launcher(enrolled({ metric: 'pages', quantity: 10, per: 'day', scope: null }), [
      item({ bookId: 'dictionary', progressMode: 'check', pageCount: null,
        events: [{ kind: 'progress', at: '2026-08-09T10:00:00Z' }] }),
    ]).status({ userId: 'kid' });
    expect(status.obligationProgress.incompatibleBooks).toEqual(['dictionary']);
  });

  it('counts a 9pm Pacific read toward TODAY, not tomorrow', async () => {
    // Clock is 2026-08-10T05:00Z = 10pm PDT Sunday Aug 9. An event at
    // 2026-08-10T04:30Z is 9:30pm PDT Sunday — still study-day 2026-08-09
    // under the 4am rule, and so is the clock itself.
    const status = await launcher(enrolled({ metric: 'pages', quantity: 10, per: 'day', scope: null }), [
      item({ events: [{ kind: 'progress', at: '2026-08-10T04:30:00.000Z', page: 40 }] }),
    ], { clock: () => new Date('2026-08-10T05:00:00Z') }).status({ userId: 'kid' });
    expect(status.obligationProgress.actual).toBe(40);
    expect(status.doneToday).toBe(true);
  });

  it('issues a launch target carrying a grant for the learner', () => {
    const grants = { issue: ({ learnerId }) => `grant-for-${learnerId}` };
    const instance = launcher(enrolled(), [], { grants });
    expect(instance.issueLaunchTarget({ userId: 'kid' }))
      .toEqual({ kind: 'program', program: 'book-log', learnerId: 'kid', bookGrant: 'grant-for-kid' });
  });

  it('refuses to issue a target without a grants issuer', () => {
    expect(() => launcher(enrolled()).issueLaunchTarget({ userId: 'kid' })).toThrow(/grant/);
  });

  it('names itself with a program: course id, so the card can draw its artwork', async () => {
    const status = await launcher(enrolled()).status({ userId: 'kid' });
    // NOT a curriculum course id. A course with no units is what the catalog
    // gate exists to reject; the scheme lets a program carry art without
    // pretending to be one. Same trick `piano-course` plays with `plex:`.
    expect(status.context.course).toEqual({ id: 'program:book-log', title: 'Independent study' });
    expect(status.context.lesson.id).toBe('book-log:shelf');
  });

  it('stays reopenable with a met DAILY target — the shelf is a log, not a task', async () => {
    const status = await launcher(enrolled()).status({ userId: 'kid' });
    expect(status.reopenable).toBe(true);
  });

  it('exposes ONE day function, the household study day, for every reader of the shelf', () => {
    const instance = launcher(enrolled());
    // 04:30Z on Aug 10 is 9:30pm PDT on Aug 9 — study day 2026-08-09 under the 4am rule.
    expect(instance.dayOf('2026-08-10T04:30:00.000Z')).toBe('2026-08-09');
    expect(instance.dayOf('garbage')).toBe('');
    expect(instance.dayOf(null)).toBe('');
  });

  describe('featuredBook — the printed card, and the only place titles are joined', () => {
    const shelfBook = (bookId, overrides = {}) => item({ itemId: `item:${bookId}`, bookId, ...overrides });
    const read = (at, page) => ({ kind: 'progress', at, page });
    const library = (byId) => ({ async findByIsbn(bookId) { return byId[bookId] ?? null; } });

    it('names the book, its author and its page', async () => {
      const result = await launcher(enrolled(), [
        shelfBook('hatchet', { pageCount: 184, events: [read('2026-08-09T18:00:00Z', 84)] }),
      ], {
        bookRepository: library({ hatchet: { title: 'Hatchet', authors: ['Gary Paulsen'], pageCount: 184 } }),
      }).featuredBook({ userId: 'kid' });
      expect(result.state).toBe('reading');
      expect(result.book).toEqual({ title: 'Hatchet', authors: ['Gary Paulsen'] });
      expect(result.page).toBe(84);
      // 84/184 = 45.65, rounded — the bar the card draws.
      expect(result.percent).toBe(46);
      // The denominator the bar used, from the shelf item — not the catalog's.
      expect(result.pageCount).toBe(184);
    });

    it('prints the denominator the BAR used, not the catalog length', async () => {
      // The child's own record says 200 pages; the catalog says 184. `percentFor`
      // divided by 200, so the card must print 200 or the fraction lies about
      // the bar beside it.
      const result = await launcher(enrolled(), [
        shelfBook('hatchet', { pageCount: 200, events: [read('2026-08-09T18:00:00Z', 100)] }),
      ], {
        bookRepository: library({ hatchet: { title: 'Hatchet', authors: [], pageCount: 184 } }),
      }).featuredBook({ userId: 'kid' });
      expect(result.percent).toBe(50);
      expect(result.pageCount).toBe(200);
      expect(result.book).toEqual({ title: 'Hatchet', authors: [] });
    });

    it('answers for an UNENROLLED learner — the shelf never needed an enrollment', async () => {
      // status() short-circuits on no enrollment and must keep doing so. The
      // card does not: every learner has a shelf, enrolled or not.
      const result = await launcher(null, [
        shelfBook('hatchet', { pageCount: 184, events: [read('2026-08-09T18:00:00Z', 84)] }),
      ], {
        bookRepository: library({ hatchet: { title: 'Hatchet', authors: [], pageCount: 184 } }),
      }).featuredBook({ userId: 'kid' });
      expect(result.state).toBe('reading');
      expect(result.book.title).toBe('Hatchet');
    });

    it('degrades to a titleless card when the repository throws', async () => {
      const result = await launcher(enrolled(), [
        shelfBook('hatchet', { pageCount: 184, events: [read('2026-08-09T18:00:00Z', 84)] }),
      ], {
        bookRepository: { async findByIsbn() { throw new Error('cache cold'); } },
      }).featuredBook({ userId: 'kid' });
      expect(result.state).toBe('reading');
      expect(result.book).toBeNull();
      expect(result.page).toBe(84);
      expect(result.percent).toBe(46);
    });

    it('degrades the same way with no repository wired at all', async () => {
      // A household with no books API runs this permanently, not just cold.
      const result = await launcher(enrolled(), [
        shelfBook('hatchet', { pageCount: 184, events: [read('2026-08-09T18:00:00Z', 84)] }),
      ], { bookRepository: null }).featuredBook({ userId: 'kid' });
      expect(result.book).toBeNull();
      expect(result.state).toBe('reading');
      expect(result.page).toBe(84);
    });

    it('reports an unreadable shelf as UNREADABLE, never as empty', async () => {
      // `empty` would print "no books yet" to a child whose shelf is full.
      const result = await launcher(enrolled(), [], { bookLog: brokenStore })
        .featuredBook({ userId: 'kid' });
      expect(result.state).toBe('unreadable');
      expect(result.book).toBeNull();
      expect(result.alsoReading).toEqual([]);
    });

    it('names up to two other in-progress books, as titles', async () => {
      const result = await launcher(enrolled(), [
        shelfBook('frindle', { pageCount: 100, events: [read('2026-08-05T18:00:00Z', 90)] }),
        shelfBook('hatchet', { pageCount: 184, events: [read('2026-08-09T18:00:00Z', 84)] }),
        shelfBook('hobbit', { pageCount: 300, events: [read('2026-08-08T18:00:00Z', 30)] }),
        shelfBook('narnia', { pageCount: 200, events: [read('2026-08-07T18:00:00Z', 20)] }),
      ], {
        bookRepository: library({
          frindle: { title: 'Frindle', authors: ['Andrew Clements'], pageCount: 100 },
          hatchet: { title: 'Hatchet', authors: ['Gary Paulsen'], pageCount: 184 },
          hobbit: { title: 'The Hobbit', authors: ['J.R.R. Tolkien'], pageCount: 300 },
          narnia: { title: 'Prince Caspian', authors: ['C.S. Lewis'], pageCount: 200 },
        }),
      }).featuredBook({ userId: 'kid' });
      // Nearest the end leads; the rest are named newest-first, capped at two.
      expect(result.book.title).toBe('Frindle');
      expect(result.alsoReading).toEqual(['Hatchet', 'The Hobbit']);
    });

    it('survives a store that rejects with a non-object', async () => {
      // `throw null` makes `error.message` throw inside the catch, which would
      // escape and take the whole card down instead of degrading it.
      const nullThrower = { async listForLearner() { throw null; } }; // eslint-disable-line no-throw-literal
      const result = await launcher(enrolled(), [], { bookLog: nullThrower })
        .featuredBook({ userId: 'kid' });
      expect(result.state).toBe('unreadable');
      expect(result.book).toBeNull();
    });

    it('survives a repository that rejects with a non-object', async () => {
      // Same escape, one layer down: this one runs inside `Promise.all`.
      const result = await launcher(enrolled(), [
        shelfBook('hatchet', { pageCount: 184, events: [read('2026-08-09T18:00:00Z', 84)] }),
      ], {
        bookRepository: { async findByIsbn() { throw null; } }, // eslint-disable-line no-throw-literal
      }).featuredBook({ userId: 'kid' });
      expect(result.state).toBe('reading');
      expect(result.book).toBeNull();
      expect(result.page).toBe(84);
    });

    it('collapses a record it cannot NAME to no book at all', async () => {
      // `createBookRecord` stubs every field for an unresolved ISBN, so a
      // record can come back with no title. A titleless record carries nothing
      // a headline can use, so `book !== null` must keep meaning "I have a name".
      const result = await launcher(enrolled(), [
        shelfBook('hatchet', { pageCount: 184, events: [read('2026-08-09T18:00:00Z', 84)] }),
      ], {
        bookRepository: library({ hatchet: { title: null, authors: [], pageCount: null } }),
      }).featuredBook({ userId: 'kid' });
      expect(result.book).toBeNull();
      expect(result.state).toBe('reading');
      expect(result.page).toBe(84);
    });

    it('says EMPTY for a shelf with no books', async () => {
      // Every child is here before their first book, and there is no featured
      // row to read a page off.
      const result = await launcher(enrolled(), [], {
        bookRepository: library({ hatchet: { title: 'Hatchet', authors: [] } }),
      }).featuredBook({ userId: 'kid' });
      expect(result.state).toBe('empty');
      expect(result.book).toBeNull();
      expect(result.page).toBeNull();
      expect(result.pageCount).toBeNull();
      expect(result.alsoReading).toEqual([]);
    });

    it('headlines the most recent FINISHED book when nothing is in progress', async () => {
      const result = await launcher(enrolled(), [
        shelfBook('frindle', { events: [{ kind: 'finished', at: '2026-02-01T18:00:00Z' }] }),
        shelfBook('hatchet', { events: [{ kind: 'finished', at: '2026-08-08T18:00:00Z' }] }),
      ], {
        bookRepository: library({
          frindle: { title: 'Frindle', authors: [] },
          hatchet: { title: 'Hatchet', authors: [] },
        }),
      }).featuredBook({ userId: 'kid' });
      expect(result.state).toBe('finished');
      expect(result.book.title).toBe('Hatchet');
      expect(result.percent).toBe(100);
    });

    it('says SET-ASIDE for a book a child put down on purpose', async () => {
      const result = await launcher(enrolled(), [
        shelfBook('hobbit', { events: [read('2026-08-01T18:00:00Z', 30), { kind: 'set-aside', at: '2026-08-02T18:00:00Z' }] }),
      ], {
        bookRepository: library({ hobbit: { title: 'The Hobbit', authors: [] } }),
      }).featuredBook({ userId: 'kid' });
      expect(result.state).toBe('set-aside');
      expect(result.book.title).toBe('The Hobbit');
    });

    it('drops a co-read book the repository could not name, rather than a null', async () => {
      const result = await launcher(enrolled(), [
        shelfBook('frindle', { pageCount: 100, events: [read('2026-08-05T18:00:00Z', 90)] }),
        shelfBook('hatchet', { pageCount: 184, events: [read('2026-08-09T18:00:00Z', 84)] }),
        shelfBook('hobbit', { pageCount: 300, events: [read('2026-08-08T18:00:00Z', 30)] }),
      ], {
        // No entry for `hatchet` — the middle co-read book has no name.
        bookRepository: library({
          frindle: { title: 'Frindle', authors: [] },
          hobbit: { title: 'The Hobbit', authors: [] },
        }),
      }).featuredBook({ userId: 'kid' });
      expect(result.book.title).toBe('Frindle');
      expect(result.alsoReading).toEqual(['The Hobbit']);
    });

    it('takes { userId } — a bare string fails loudly, as status() does', async () => {
      await expect(launcher(enrolled()).featuredBook('kid')).rejects.toThrow(TypeError);
      await expect(launcher(enrolled()).featuredBook()).rejects.toThrow(/userId/);
    });
  });

  it('status() still makes no repository read — the card must not tax the boards', async () => {
    // status() runs inside collectProgramStatuses -> PlanProjection, which the
    // teacher board, the status board, DoNow and the completion recompute all
    // call. N per-book reads must never ride along with them.
    let called = false;
    const status = await launcher(enrolled(), [
      item({ itemId: 'item:hatchet', events: [{ kind: 'progress', at: '2026-08-09T18:00:00Z', page: 84 }] }),
    ], {
      bookRepository: { async findByIsbn() { called = true; throw new Error('nope'); } },
    }).status({ userId: 'kid' });
    expect(called).toBe(false);
    expect(status).toMatchObject({ enrolled: true, error: false });
  });
});
