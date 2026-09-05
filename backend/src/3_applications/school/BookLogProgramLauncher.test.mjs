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

  it('exposes ONE day function, the household study day, for every reader of the shelf', () => {
    const instance = launcher(enrolled());
    // 04:30Z on Aug 10 is 9:30pm PDT on Aug 9 — study day 2026-08-09 under the 4am rule.
    expect(instance.dayOf('2026-08-10T04:30:00.000Z')).toBe('2026-08-09');
    expect(instance.dayOf('garbage')).toBe('');
    expect(instance.dayOf(null)).toBe('');
  });
});
