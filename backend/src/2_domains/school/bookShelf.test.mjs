import { describe, expect, it } from 'vitest';
import {
  PROGRESS_MODES, inferProgressMode, projectShelfItem, projectReading, measureObligation, isDayKey, noonOf,
  selectFeaturedShelfItem,
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

  it('undoes a mistaken finish with a later append-only reopened event', () => {
    const corrected = item({ events: [
      ev('started', '2026-08-01T10:00:00Z'),
      ev('progress', '2026-08-03T10:00:00Z', { page: 40 }),
      ev('finished', '2026-08-04T10:00:00Z'),
      ev('reopened', '2026-08-04T10:01:00Z'),
    ] });
    expect(projectShelfItem(corrected)).toMatchObject({ status: 'reading', page: 40, percent: 22 });
    expect(measureObligation(
      { metric: 'books', quantity: 1, per: 'week' }, [corrected],
      { from: '2026-08-01', to: '2026-08-09' },
    ).actual).toBe(0);
    expect(projectShelfItem(corrected).daysRead).toBe(1); // the real page log, not the canceled finish
  });

  it('a later finish after reopening is once again the effective finish', () => {
    const corrected = item({ events: [
      ev('finished', '2026-08-04T10:00:00Z'),
      ev('reopened', '2026-09-04T10:01:00Z'),
      ev('finished', '2026-08-05T10:00:00Z'),
    ] });
    expect(projectShelfItem(corrected).status).toBe('finished');
    expect(projectShelfItem(corrected).lastAt).toBe('2026-08-05T10:00:00Z');
    expect(measureObligation(
      { metric: 'books', quantity: 1, per: 'week' }, [corrected],
      { from: '2026-08-01', to: '2026-08-09' },
    ).actual).toBe(1);
  });

  it('counts a finish-only day as read but not the day the book was merely added', () => {
    const item = { progressMode: 'page', pageCount: 100, events: [
      { kind: 'started', at: '2026-09-01T18:00:00.000Z' },
      { kind: 'finished', at: '2026-09-02T18:00:00.000Z' },
    ] };
    expect(projectShelfItem(item).daysRead).toBe(1);
    expect(measureObligation({ metric: 'checkins', quantity: 1, per: 'day' }, [item], { from: '2026-09-01', to: '2026-09-02' }).actual).toBe(1);
  });

  it('neither adding nor setting aside a book is a day read', () => {
    const item = { progressMode: 'page', pageCount: 100, events: [
      { kind: 'started', at: '2026-09-01T18:00:00.000Z' },
      { kind: 'set-aside', at: '2026-09-02T18:00:00.000Z' },
    ] };
    expect(projectShelfItem(item).daysRead).toBe(0);
    expect(measureObligation({ metric: 'checkins', quantity: 1, per: 'day' }, [item], { from: '2026-09-01', to: '2026-09-02' }).actual).toBe(0);
  });

  it('does not count a corrupt at as a day read', () => {
    const projection = projectShelfItem(item({ events: [
      ev('progress', '2026-08-01T10:00:00Z', { page: 5 }),
      ev('progress', 'not-a-date', { page: 6 }),
    ] }), { dayOf: (iso) => (Number.isFinite(Date.parse(iso)) ? String(iso).slice(0, 10) : '') });
    expect(projection.daysRead).toBe(1);
  });
});

describe('projectReading', () => {
  const reading = (overrides = {}) => ({
    id: 'rdg_one', learnerId: 'learner_a',
    book: { isbn: '9780064400558', pageCount: 184 },
    progressMode: 'page', status: 'reading',
    openedOn: '2026-08-01', finishedOn: null, entries: [], ...overrides,
  });
  const entry = (on, at, extra = {}) => ({ id: `ent_${on}`, on, at, source: 'panel', ...extra });

  it('reads status from the stored field, never from where a row sits', () => {
    for (const status of ['reading', 'finished', 'set-aside']) {
      // The evidence below says "reading" under every v1 rule; the stored
      // decision is what a teacher set, and it wins.
      expect(projectReading(reading({
        status,
        entries: [entry('2026-08-03', '2026-08-03T10:00:00.000Z', { page: 40 })],
      })).status).toBe(status);
    }
  });

  it('keeps the FURTHEST page when a later row is lower', () => {
    const projection = projectReading(reading({ entries: [
      entry('2026-08-03', '2026-08-03T10:00:00.000Z', { page: 84 }),
      entry('2026-08-04', '2026-08-04T10:00:00.000Z', { page: 12 }),
    ] }));
    expect(projection.page).toBe(84);
    expect(projection.percent).toBe(46);
  });

  it('clamps the bar but keeps the page — still the 212-of-184 case', () => {
    const projection = projectReading(reading({ entries: [
      entry('2026-08-04', '2026-08-04T10:00:00.000Z', { page: 212 }),
    ] }));
    expect(projection.page).toBe(212);
    expect(projection.percent).toBe(100);
  });

  it('is 100% when the stored status says finished, with no page ever logged', () => {
    expect(projectReading(reading({ status: 'finished', finishedOn: '2026-08-09' })).percent).toBe(100);
  });

  it('has no percentage without a denominator', () => {
    expect(projectReading(reading({
      progressMode: 'check', book: { isbn: 'x', pageCount: null },
      entries: [entry('2026-08-01', '2026-08-01T10:00:00.000Z')],
    })).percent).toBeNull();
  });

  it('totals minutes in minutes mode', () => {
    const projection = projectReading(reading({
      progressMode: 'minutes', book: { isbn: 'x', pageCount: null },
      entries: [
        entry('2026-08-01', '2026-08-01T10:00:00.000Z', { minutes: 20 }),
        entry('2026-08-02', '2026-08-02T10:00:00.000Z', { minutes: 25 }),
      ],
    }));
    expect(projection.minutes).toBe(45);
  });

  it('counts DAYS, not rows: `on` is already a study day, so nothing maps it', () => {
    const projection = projectReading(reading({ entries: [
      entry('2026-08-03', '2026-08-03T10:00:00.000Z', { page: 20 }),
      { id: 'ent_b', on: '2026-08-03', at: '2026-08-03T21:00:00.000Z', page: 30 },
      entry('2026-08-04', '2026-08-04T10:00:00.000Z', { page: 40 }),
    ] }));
    expect(projection.daysRead).toBe(2);
  });

  it('answers BOTH questions: the day they last read and the instant it was touched', () => {
    // A finish logged today for a day last week. "When did they last read" is
    // that day; "when was this last touched" is now, and the teacher sees both.
    const projection = projectReading(reading({
      status: 'finished', finishedOn: '2026-08-28',
      entries: [
        entry('2026-09-02', '2026-09-02T10:00:00.000Z', { page: 40 }),
        { id: 'ent_late', on: '2026-08-28', at: '2026-09-06T18:00:00.000Z' },
      ],
    }));
    expect(projection.lastOn).toBe('2026-09-02');
    expect(projection.lastAt).toBe('2026-09-06T18:00:00.000Z');
  });

  it('projects a reading with no entries at all', () => {
    expect(projectReading(reading())).toMatchObject({
      status: 'reading', page: null, percent: null, minutes: null, daysRead: 0, lastOn: null, lastAt: null,
    });
  });

  it('never throws on junk — a damaged reading must not stop the page drawing', () => {
    for (const junk of [null, undefined, {}, { entries: 'nope' }, { entries: [null, 7, { on: 5 }] }]) {
      expect(() => projectReading(junk)).not.toThrow();
    }
    expect(projectReading({ entries: [null, { page: 'x' }] }).page).toBeNull();
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

describe('selectFeaturedShelfItem', () => {
  const reading = (itemId, at, page, overrides = {}) => item({
    itemId, events: [ev('progress', at, { page })], ...overrides,
  });

  it('features the in-progress book nearest the end', () => {
    const selection = selectFeaturedShelfItem([
      reading('a', '2026-09-05T10:00:00Z', 40),   // 22%, and the most recent
      reading('b', '2026-09-01T10:00:00Z', 170),  // 92%, and the oldest
      reading('c', '2026-09-03T10:00:00Z', 90),   // 49%
    ]);
    expect(selection.state).toBe('reading');
    expect(selection.featured.item.itemId).toBe('b');
    expect(selection.featured.projection.percent).toBe(92);
  });

  it('falls back to the most recently touched book when none has a percent', () => {
    // Check mode has no denominator, so every percent here is null — the
    // ordinary case, not a corner one.
    const check = (itemId, at) => item({
      itemId, progressMode: 'check', pageCount: null, events: [ev('progress', at)],
    });
    const selection = selectFeaturedShelfItem([
      check('a', '2026-09-01T10:00:00Z'),
      check('b', '2026-09-04T10:00:00Z'),
      check('c', '2026-09-02T10:00:00Z'),
    ]);
    expect(selection.featured.projection.percent).toBeNull();
    expect(selection.featured.item.itemId).toBe('b');
  });

  it('prefers a book with a percent over a more recent one without', () => {
    const selection = selectFeaturedShelfItem([
      item({ itemId: 'audiobook', progressMode: 'minutes', pageCount: null,
        events: [ev('progress', '2026-09-05T10:00:00Z', { minutes: 40 })] }),
      reading('paged', '2026-09-01T10:00:00Z', 10), // 5% — barely started, but measurable
    ]);
    expect(selection.featured.item.itemId).toBe('paged');
  });

  it('ranks a book at 0% above one with no denominator at all', () => {
    const selection = selectFeaturedShelfItem([
      item({ itemId: 'audiobook', progressMode: 'minutes', pageCount: null,
        events: [ev('progress', '2026-09-05T10:00:00.000Z', { minutes: 90 })] }),
      reading('barely', '2026-09-01T10:00:00.000Z', 1, { pageCount: 500 }), // 0%, but measurable
    ]);
    expect(selection.featured.projection.percent).toBe(0);
    expect(selection.featured.item.itemId).toBe('barely');
  });

  it('threads the household day rule through to the projection', () => {
    const at = (t) => ev('progress', t, { page: 40 });
    // 11pm and 1am are one study day under the 4am rule, two under ISO midnight.
    const selection = selectFeaturedShelfItem(
      [reading('a', '2026-09-04T23:00:00.000Z', 40, {
        events: [at('2026-09-04T23:00:00.000Z'), at('2026-09-05T01:00:00.000Z')] })],
      { dayOf: (t) => new Date(Date.parse(t) - 4 * 3600_000).toISOString().slice(0, 10) },
    );
    expect(selection.featured.projection.daysRead).toBe(1);
  });

  it('breaks a tie on itemId, so two prints of one day agree', () => {
    const same = ['b', 'a'].map((itemId) => reading(itemId, '2026-09-04T10:00:00Z', 40));
    expect(selectFeaturedShelfItem(same).featured.item.itemId).toBe('a');
    expect(selectFeaturedShelfItem([...same].reverse()).featured.item.itemId).toBe('a');
  });

  it('lists the other in-progress books newest first, capped at two', () => {
    const selection = selectFeaturedShelfItem([
      reading('a', '2026-09-01T10:00:00Z', 180), // 98% — the headline
      reading('b', '2026-09-05T10:00:00Z', 10),
      reading('c', '2026-09-04T10:00:00Z', 100),
      reading('d', '2026-09-03T10:00:00Z', 50),
    ]);
    expect(selection.featured.item.itemId).toBe('a');
    // Recency, not percentage: by percent this would read c, d, b.
    expect(selection.alsoReading.map((entry) => entry.item.itemId)).toEqual(['b', 'c']);
  });

  it('features the most recently finished book when nothing is open', () => {
    const finished = (itemId, at) => item({ itemId, events: [ev('finished', at)] });
    const selection = selectFeaturedShelfItem([
      finished('a', '2026-08-20T10:00:00Z'),
      finished('b', '2026-09-02T10:00:00Z'),
    ]);
    expect(selection.state).toBe('finished');
    expect(selection.featured.item.itemId).toBe('b');
    expect(selection.alsoReading).toEqual([]);
  });

  it('features a set-aside book rather than claiming the shelf is empty', () => {
    const selection = selectFeaturedShelfItem([item({ itemId: 'a', events: [
      ev('started', '2026-08-01T10:00:00Z'), ev('set-aside', '2026-08-05T10:00:00Z'),
    ] })]);
    expect(selection.state).toBe('set-aside');
    expect(selection.featured.item.itemId).toBe('a');
  });

  it('prefers a finished book over a set-aside one, however recent the shelving', () => {
    const selection = selectFeaturedShelfItem([
      item({ itemId: 'shelved', events: [
        ev('started', '2026-08-01T10:00:00Z'), ev('set-aside', '2026-09-05T10:00:00Z'),
      ] }),
      item({ itemId: 'done', events: [ev('finished', '2026-08-10T10:00:00Z')] }),
    ]);
    expect(selection.state).toBe('finished');
    expect(selection.featured.item.itemId).toBe('done');
  });

  it('reports an empty shelf as empty', () => {
    expect(selectFeaturedShelfItem([])).toEqual({ state: 'empty', featured: null, alsoReading: [] });
  });

  it('never throws on junk — a damaged log must not stop the page printing', () => {
    expect(selectFeaturedShelfItem(null)).toEqual({ state: 'empty', featured: null, alsoReading: [] });
    expect(selectFeaturedShelfItem([null, undefined, {}]))
      .toEqual({ state: 'empty', featured: null, alsoReading: [] });
  });
});
