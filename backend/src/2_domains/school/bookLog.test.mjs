import { describe, expect, it } from 'vitest';
import {
  BOOK_LOG_PROGRAM_ID, OBLIGATION_METRICS, OBLIGATION_WINDOWS,
  validateBookLogEnrollment,
} from './bookLog.mjs';

const ok = (raw) => {
  const result = validateBookLogEnrollment(raw);
  expect(result.errors, JSON.stringify(result.errors)).toEqual([]);
  return result.enrollment;
};
const errs = (raw) => validateBookLogEnrollment(raw).errors;

const base = { programId: BOOK_LOG_PROGRAM_ID };

describe('validateBookLogEnrollment', () => {
  it('accepts an enrollment with NO obligation — the shelf is a log by default', () => {
    const enrollment = ok(base);
    expect(enrollment.obligation).toBeNull();
    expect(enrollment.programId).toBe('book-log');
    expect(enrollment.subject).toBe('english');
  });

  it('refuses a different programId', () => {
    expect(errs({ programId: 'story-time' })).toContainEqual(expect.stringMatching(/programId/));
  });

  it('refuses anything that is not a mapping', () => {
    for (const raw of [null, 'x', 42, []]) {
      expect(errs(raw).length).toBeGreaterThan(0);
    }
  });

  describe('the five obligations a grown-up must be able to express', () => {
    it('reads 20 pages a day', () => {
      expect(ok({ ...base, obligation: { metric: 'pages', quantity: 20, per: 'day' } }).obligation)
        .toEqual({ metric: 'pages', quantity: 20, per: 'day', scope: null });
    });

    it('reads 2 books a week', () => {
      expect(ok({ ...base, obligation: { metric: 'books', quantity: 2, per: 'week' } }).obligation)
        .toMatchObject({ metric: 'books', quantity: 2, per: 'week' });
    });

    it('checks in every day', () => {
      expect(ok({ ...base, obligation: { metric: 'checkins', per: 'day' } }).obligation)
        .toMatchObject({ metric: 'checkins', quantity: 1, per: 'day' });
    });

    it('reads THIS book', () => {
      const enrollment = ok({
        ...base,
        obligation: { metric: 'books', quantity: 1, per: 'once', scope: { books: ['9780064400558'] } },
      });
      expect(enrollment.obligation.scope).toEqual({ books: ['9780064400558'], label: null });
    });

    it('reads THIS series', () => {
      const enrollment = ok({
        ...base,
        obligation: {
          metric: 'books', quantity: 7, per: 'once',
          scope: { books: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], label: 'The Chronicles of Narnia' },
        },
      });
      expect(enrollment.obligation.scope.label).toBe('The Chronicles of Narnia');
      expect(enrollment.obligation.scope.books).toHaveLength(7);
    });
  });

  describe('the grammar is closed', () => {
    it('names the four metrics and refuses anything else', () => {
      expect(OBLIGATION_METRICS).toEqual(['pages', 'minutes', 'books', 'checkins']);
      expect(errs({ ...base, obligation: { metric: 'chapters', per: 'day' } }))
        .toContainEqual(expect.stringMatching(/metric/));
    });

    it('names the four windows and refuses anything else', () => {
      expect(OBLIGATION_WINDOWS).toEqual(['day', 'week', 'month', 'once']);
      expect(errs({ ...base, obligation: { metric: 'pages', quantity: 1, per: 'fortnight' } }))
        .toContainEqual(expect.stringMatching(/per/));
    });

    it('refuses an unknown key rather than dropping it', () => {
      // A dropped key is an obligation whose author believes it is in force.
      expect(errs({ ...base, obligation: { metric: 'pages', quantity: 1, per: 'day', pagez: 3 } }))
        .toContainEqual(expect.stringMatching(/unknown/i));
    });

    it('refuses a quantity that is not a positive integer', () => {
      for (const quantity of [0, -1, 2.5, '3']) {
        expect(errs({ ...base, obligation: { metric: 'pages', quantity, per: 'day' } }).length)
          .toBeGreaterThan(0);
      }
    });

    it('refuses an unmeetable quantity, because a typo leaves a child permanently red', () => {
      expect(errs({ ...base, obligation: { metric: 'books', quantity: 5000, per: 'day' } }))
        .toContainEqual(expect.stringMatching(/quantity/));
    });
  });

  describe('scope', () => {
    it('refuses a scope that is not a list of book ids', () => {
      expect(errs({ ...base, obligation: { metric: 'books', quantity: 1, per: 'once', scope: { books: 'x' } } }).length)
        .toBeGreaterThan(0);
    });

    it('refuses an empty scope, which would be an obligation nothing can satisfy', () => {
      expect(errs({ ...base, obligation: { metric: 'books', quantity: 1, per: 'once', scope: { books: [] } } }).length)
        .toBeGreaterThan(0);
    });

    it('refuses asking for more books than the scope contains', () => {
      expect(errs({
        ...base,
        obligation: { metric: 'books', quantity: 4, per: 'once', scope: { books: ['a', 'b'] } },
      })).toContainEqual(expect.stringMatching(/quantity/));
    });

    it('refuses a page or minute target scoped to a fixed book list', () => {
      // "20 pages a day, but only out of these three books" is not a thing a
      // grown-up means, and it silently makes the target unmeetable once they
      // are finished.
      expect(errs({
        ...base,
        obligation: { metric: 'pages', quantity: 20, per: 'day', scope: { books: ['a'] } },
      })).toContainEqual(expect.stringMatching(/scope/));
    });
  });

  it('refuses a subject outside the school taxonomy', () => {
    expect(errs({ ...base, subject: 'underwater-basket-weaving' }))
      .toContainEqual(expect.stringMatching(/subject/));
  });

  it('carries a title through when one is given', () => {
    expect(ok({ ...base, title: 'Free Reading' }).title).toBe('Free Reading');
  });
});
