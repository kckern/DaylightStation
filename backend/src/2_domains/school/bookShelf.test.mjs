import { describe, expect, it } from 'vitest';
import {
  PROGRESS_MODES, inferProgressMode, projectShelfItem, measureObligation, isDayKey, noonOf,
} from './bookShelf.mjs';

const item = (overrides = {}) => ({
  learnerId: 'kid', bookId: '9780064400558', progressMode: 'page', pageCount: 184,
  events: [], ...overrides,
});
const ev = (kind, at, extra = {}) => ({ kind, at, ...extra });

describe('inferProgressMode', () => {
  it('is page when the book has a page count', () => {
    expect(inferProgressMode({ pageCount: 184 })).toBe('page');
  });

  it('is check when it does not, because a page you are "on" needs a total', () => {
    expect(inferProgressMode({ pageCount: null })).toBe('check');
  });

  it('never infers minutes — nothing in metadata reliably says "audiobook"', () => {
    expect(PROGRESS_MODES).toEqual(['page', 'minutes', 'check']);
    expect(inferProgressMode({ pageCount: 0 })).toBe('check');
  });
});

describe('projectShelfItem', () => {
  it('derives state from the LAST event, never from a stored column', () => {
    const projection = projectShelfItem(item({ events: [
      ev('started', '2026-08-01T10:00:00Z'),
      ev('progress', '2026-08-03T10:00:00Z', { page: 40 }),
      ev('finished', '2026-08-09T10:00:00Z'),
    ] }));
    expect(projection.status).toBe('finished');
  });

  it('reports reading while progress is still being logged', () => {
    expect(projectShelfItem(item({ events: [
      ev('started', '2026-08-01T10:00:00Z'), ev('progress', '2026-08-03T10:00:00Z', { page: 40 }),
    ] })).status).toBe('reading');
  });

  it('treats set-aside as an outcome, not a failure', () => {
    expect(projectShelfItem(item({ events: [
      ev('started', '2026-08-01T10:00:00Z'), ev('set-aside', '2026-08-05T10:00:00Z'),
    ] })).status).toBe('set-aside');
  });

  it('draws a bar from the furthest page reached', () => {
    const projection = projectShelfItem(item({ events: [
      ev('progress', '2026-08-03T10:00:00Z', { page: 40 }),
      ev('progress', '2026-08-04T10:00:00Z', { page: 84 }),
    ] }));
    expect(projection.page).toBe(84);
    expect(projection.percent).toBe(46);
  });

  it('clamps the bar but keeps the page a child reported', () => {
    // Editions differ; refusing "212 of 184" tells a child holding the book
    // that they are wrong when they are not.
    const projection = projectShelfItem(item({ events: [ev('progress', '2026-08-04T10:00:00Z', { page: 212 })] }));
    expect(projection.page).toBe(212);
    expect(projection.percent).toBe(100);
  });

  it('shows a finished book as complete even with no page ever logged', () => {
    expect(projectShelfItem(item({ events: [ev('finished', '2026-08-09T10:00:00Z')] })).percent).toBe(100);
  });

  it('has no percentage in check mode — there is no denominator', () => {
    const projection = projectShelfItem(item({
      progressMode: 'check', pageCount: null,
      events: [ev('progress', '2026-08-01T10:00:00Z'), ev('progress', '2026-08-02T10:00:00Z')],
    }));
    expect(projection.percent).toBeNull();
    expect(projection.daysRead).toBe(2);
  });

  it('totals minutes in minutes mode', () => {
    const projection = projectShelfItem(item({
      progressMode: 'minutes', pageCount: null,
      events: [ev('progress', '2026-08-01T10:00:00Z', { minutes: 25 }),
        ev('progress', '2026-08-02T10:00:00Z', { minutes: 35 })],
    }));
    expect(projection.minutes).toBe(60);
  });

  it('counts a day once however many times a child logs that day', () => {
    const projection = projectShelfItem(item({ events: [
      ev('progress', '2026-08-01T10:00:00Z', { page: 10 }),
      ev('progress', '2026-08-01T18:00:00Z', { page: 22 }),
    ] }));
    expect(projection.daysRead).toBe(1);
  });

  it('reports finished when the finish is backdated before the open', () => {
    // "I already finished it last week": the item is opened NOW and the
    // finished event carries the chosen day, so it sorts BEFORE `started`.
    // The last-event rule read that as still reading, with percent 100.
    const projection = projectShelfItem(item({ events: [
      ev('started', '2026-09-02T20:00:00.000Z'),
      ev('finished', '2026-08-25T12:00:00.000Z'),
    ] }));
    expect(projection.status).toBe('finished');
    expect(projection.percent).toBe(100);
  });

  it('still reports set-aside from the last event, and reading after a resume', () => {
    expect(projectShelfItem(item({ events: [
      ev('started', '2026-08-01T10:00:00Z'), ev('set-aside', '2026-08-05T10:00:00Z'),
    ] })).status).toBe('set-aside');
    expect(projectShelfItem(item({ events: [
      ev('started', '2026-08-01T10:00:00Z'), ev('set-aside', '2026-08-05T10:00:00Z'),
      ev('progress', '2026-08-09T10:00:00Z', { page: 30 }),
    ] })).status).toBe('reading');
  });

  it('counts a finish-only day as a day read — the same set measureObligation(checkins) counts (review m5)', () => {
    const item = { progressMode: 'page', pageCount: 100, events: [
      { kind: 'started', at: '2026-09-01T18:00:00.000Z' },
      { kind: 'finished', at: '2026-09-02T18:00:00.000Z' },
    ] };
    expect(projectShelfItem(item).daysRead).toBe(2);
    expect(measureObligation({ metric: 'checkins', quantity: 1, per: 'day' }, [item], { from: '2026-09-01', to: '2026-09-02' }).actual).toBe(2);
  });

  it('a set-aside day is not a day read, in either count', () => {
    const item = { progressMode: 'page', pageCount: 100, events: [
      { kind: 'started', at: '2026-09-01T18:00:00.000Z' },
      { kind: 'set-aside', at: '2026-09-02T18:00:00.000Z' },
    ] };
    expect(projectShelfItem(item).daysRead).toBe(1);
    expect(measureObligation({ metric: 'checkins', quantity: 1, per: 'day' }, [item], { from: '2026-09-01', to: '2026-09-02' }).actual).toBe(1);
  });

  it('does not count a corrupt at as a day read', () => {
    const projection = projectShelfItem(item({ events: [
      ev('progress', '2026-08-01T10:00:00Z', { page: 5 }),
      ev('progress', 'not-a-date', { page: 6 }),
    ] }), { dayOf: (iso) => (Number.isFinite(Date.parse(iso)) ? String(iso).slice(0, 10) : '') });
    expect(projection.daysRead).toBe(1);
  });
});

describe('day keys', () => {
  it('accepts a real day and refuses a calendar-impossible one', () => {
    expect(isDayKey('2026-09-02')).toBe(true);
    expect(isDayKey('2026-02-31')).toBe(false);
    expect(isDayKey('2026-9-2')).toBe(false);
    expect(isDayKey(null)).toBe(false);
  });
  it('noonOf is noon UTC of the day', () => {
    expect(noonOf('2026-08-25')).toBe('2026-08-25T12:00:00.000Z');
  });
});

describe('measureObligation', () => {
  const window = { from: '2026-08-03', to: '2026-08-09' };

  it('counts pages as a delta across the window, not as a position', () => {
    const items = [item({ events: [
      ev('progress', '2026-08-01T10:00:00Z', { page: 20 }),   // before the window
      ev('progress', '2026-08-05T10:00:00Z', { page: 60 }),
    ] })];
    expect(measureObligation({ metric: 'pages', quantity: 30, per: 'week' }, items, window))
      .toMatchObject({ actual: 40, target: 30, met: true });
  });

  it('never lets a re-read subtract from another book', () => {
    // Going back a chapter moves the page backwards; a negative day would eat
    // real reading elsewhere in the sum.
    const items = [
      item({ bookId: 'a', events: [
        ev('progress', '2026-08-01T10:00:00Z', { page: 100 }),
        ev('progress', '2026-08-05T10:00:00Z', { page: 40 }),
      ] }),
      item({ bookId: 'b', events: [ev('progress', '2026-08-05T10:00:00Z', { page: 30 })] }),
    ];
    expect(measureObligation({ metric: 'pages', quantity: 10, per: 'week' }, items, window).actual).toBe(30);
  });

  it('counts finished books inside the window', () => {
    const items = [
      item({ bookId: 'a', events: [ev('finished', '2026-08-05T10:00:00Z')] }),
      item({ bookId: 'b', events: [ev('finished', '2026-07-01T10:00:00Z')] }),
    ];
    expect(measureObligation({ metric: 'books', quantity: 2, per: 'week' }, items, window))
      .toMatchObject({ actual: 1, met: false });
  });

  it('honours a scope, so "read this series" counts only those books', () => {
    const items = [
      item({ bookId: 'narnia-1', events: [ev('finished', '2026-08-05T10:00:00Z')] }),
      item({ bookId: 'something-else', events: [ev('finished', '2026-08-06T10:00:00Z')] }),
    ];
    const obligation = { metric: 'books', quantity: 2, per: 'once', scope: { books: ['narnia-1', 'narnia-2'] } };
    expect(measureObligation(obligation, items, window).actual).toBe(1);
  });

  it('counts check-ins as distinct days, whatever mode each book is in', () => {
    const items = [
      item({ progressMode: 'check', events: [ev('progress', '2026-08-04T10:00:00Z')] }),
      item({ bookId: 'b', events: [ev('progress', '2026-08-04T20:00:00Z', { page: 5 })] }),
      item({ bookId: 'c', events: [ev('progress', '2026-08-06T10:00:00Z', { page: 9 })] }),
    ];
    expect(measureObligation({ metric: 'checkins', quantity: 1, per: 'day' }, items, window).actual).toBe(2);
  });

  it('sums minutes inside the window only', () => {
    const items = [item({ progressMode: 'minutes', events: [
      ev('progress', '2026-08-02T10:00:00Z', { minutes: 90 }),
      ev('progress', '2026-08-04T10:00:00Z', { minutes: 25 }),
    ] })];
    expect(measureObligation({ metric: 'minutes', quantity: 20, per: 'day' }, items, window).actual).toBe(25);
  });

  it('reports no obligation as met, because nothing is owed', () => {
    expect(measureObligation(null, [], window)).toMatchObject({ met: true, target: 0, actual: 0 });
  });

  it('only counts books whose mode can supply the metric', () => {
    // A pages target cannot be met by a reference book logged with check marks;
    // saying so is the honest answer, and A4 requires the UI to surface it.
    const items = [item({ progressMode: 'check', pageCount: null, events: [ev('progress', '2026-08-05T10:00:00Z')] })];
    const measured = measureObligation({ metric: 'pages', quantity: 10, per: 'day' }, items, window);
    expect(measured.actual).toBe(0);
    expect(measured.incompatibleBooks).toEqual(['9780064400558']);
  });

  it('counts a day by the injected dayOf, not by a UTC slice', () => {
    // 9pm Pacific on Sep 2 is 04:00Z on Sep 3. Under a 4am-Pacific study day
    // it is still Sep 2, and the caller knows that; this function must not.
    const pacificDay = (iso) => {
      const ms = Date.parse(iso) - 7 * 3_600_000 - 4 * 3_600_000; // PDT, 4am boundary
      return new Date(ms).toISOString().slice(0, 10);
    };
    const items = [item({ events: [{ kind: 'progress', at: '2026-09-03T04:00:00.000Z', page: 20 }] })];
    const window = { from: '2026-09-02', to: '2026-09-02' };
    expect(measureObligation({ metric: 'pages', quantity: 10, per: 'day' }, items, window, { dayOf: pacificDay }).actual)
      .toBe(20);
    // The naive slice files it under tomorrow — the bug.
    expect(measureObligation({ metric: 'pages', quantity: 10, per: 'day' }, items, window).actual).toBe(0);
  });

  it('a backdated finish credits the finish day, not today', () => {
    // What OpenBookShelfItem writes for "I already finished it on Aug 25":
    // both events on that day. Today's window must see nothing.
    const backdated = item({ events: [
      ev('started', '2026-08-25T12:00:00.000Z'),
      ev('finished', '2026-08-25T12:00:00.000Z'),
    ] });
    const checkins = { metric: 'checkins', quantity: 1, per: 'day' };
    expect(measureObligation(checkins, [backdated], { from: '2026-09-02', to: '2026-09-02' }).actual).toBe(0);
    expect(measureObligation(checkins, [backdated], { from: '2026-08-25', to: '2026-08-25' }).actual).toBe(1);
    expect(measureObligation({ metric: 'books', quantity: 1, per: 'day' }, [backdated], { from: '2026-08-25', to: '2026-08-25' }).actual).toBe(1);
    expect(projectShelfItem(backdated).daysRead).toBe(1);
  });
});
