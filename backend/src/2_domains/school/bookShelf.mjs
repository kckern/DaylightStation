/**
 * The shelf: what a learner is reading, derived from an append-only event log.
 *
 * ## STATE IS DERIVED, NEVER STORED
 *
 * A shelf item holds a learner, a book, and a list of progress events. Its
 * status, its furthest page, its percentage — all of it is recomputed here on
 * every read. Nothing is written twice, so nothing can disagree with itself.
 * The same discipline `ReadingSessionService` applies to its browsing MODE, for
 * the same reason: derived state cannot go stale.
 *
 * ## THE MODE IS A PROPERTY OF THE BOOK
 *
 * A novel has a page you are on. A dictionary does not, and forcing one would
 * make the app wrong about the book in a way a child can see. So each item
 * carries a `progressMode`:
 *
 *   page     a page number, drawn as a bar against the book's length
 *   minutes  a running total; audiobooks and un-paginated ebooks
 *   check    one tap, counted as days read; reference books, poetry, devotionals
 *
 * `minutes` is never INFERRED, because nothing in book metadata reliably says
 * "audiobook" — it is reached by a child or grown-up choosing it.
 *
 * ## SWITCHING MODES NEVER REWRITES HISTORY
 *
 * Every projection reads whatever each event actually holds. A book logged by
 * page for eighty pages and then switched to `check` shows both, in order,
 * rather than pretending those pages were never read.
 *
 * @module domains/school/bookShelf
 */

/** How progress is expressed for one book. */
export const PROGRESS_MODES = Object.freeze(['page', 'minutes', 'check']);

/** What an event can be. `started` and `finished` bracket; the rest are signals. */
export const PROGRESS_KINDS = Object.freeze(['started', 'progress', 'finished', 'set-aside']);

/** Default day key: the ISO date of the instant. Callers with a study-day rule inject their own. */
const isoDay = (at) => String(at ?? '').slice(0, 10);

/** Noon UTC of a study-day key: unambiguous under any household timezone and the 4am rule. */
export const noonOf = (day) => `${day}T12:00:00.000Z`;

/**
 * A real calendar day as `YYYY-MM-DD`. The regex alone accepts `2026-02-31`;
 * round-tripping through Date.parse refuses it.
 */
export function isDayKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(noonOf(value));
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

const inWindow = (at, window, dayOf) => {
  if (!window) return true;
  const day = dayOf(at);
  if (!day) return false;
  return (!window.from || day >= window.from) && (!window.to || day <= window.to);
};

const sorted = (events) => [...(events ?? [])].filter(Boolean)
  .sort((left, right) => String(left.at).localeCompare(String(right.at)));

/**
 * The mode a book gets when it joins a shelf.
 * @param {{pageCount?: number|null}} book
 * @returns {'page'|'check'}
 */
export function inferProgressMode(book) {
  return Number.isFinite(book?.pageCount) && book.pageCount > 0 ? 'page' : 'check';
}

/**
 * Everything the shelf card needs for one book.
 *
 * @param {{progressMode: string, pageCount: number|null, events: object[]}} item
 * @param {{dayOf?: (at: string) => string}} [options] - the day an instant
 *   belongs to; defaults to the ISO date, callers with a 4am rule inject theirs
 * @returns {{status: string, page: number|null, percent: number|null,
 *   minutes: number|null, daysRead: number, lastAt: string|null}}
 */
export function projectShelfItem(item, { dayOf = isoDay } = {}) {
  const events = sorted(item?.events);
  const last = events.at(-1);
  const finished = events.some((event) => event.kind === 'finished');

  // A finished book is finished, wherever the finish sorts. The "already
  // finished it" door stamps the finish on a PAST day while the open is now,
  // so the last event by time is `started` — reading that as "still reading"
  // kept a finished book on the shelf and out of history. `set-aside` stays
  // last-event-based: a child may set a book aside and pick it back up on the
  // same item, and a later progress event must be able to reopen it.
  const status = finished ? 'finished'
    : (last?.kind === 'set-aside' ? 'set-aside'
      : (events.length > 0 ? 'reading' : 'unread'));

  // The FURTHEST page, not the latest: re-reading a chapter moves the number
  // backwards, and a child who reached page 84 has reached page 84.
  const pages = events.map((event) => event.page).filter((page) => Number.isFinite(page));
  const page = pages.length ? Math.max(...pages) : null;

  const minutes = events.reduce((sum, event) => sum + (Number.isFinite(event.minutes) ? event.minutes : 0), 0);
  // The same set `measureObligation('checkins')` counts — every event but a
  // set-aside — so the tile's caption and the obligation line agree: a day
  // the child only finished the book is a day read (review m5).
  const daysRead = new Set(events.filter((e) => e.kind !== 'set-aside')
    .map((event) => dayOf(event.at)).filter(Boolean)).size;

  return {
    status,
    page,
    percent: percentFor(item, page, finished),
    minutes: item?.progressMode === 'minutes' ? minutes : (minutes || null),
    daysRead,
    lastAt: last?.at ?? null,
  };
}

function percentFor(item, page, finished) {
  if (finished) return 100;
  if (item?.progressMode !== 'page') return null;
  const total = item?.pageCount;
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(page)) return null;
  // Clamp the BAR, keep the page. See the 212-of-184 case.
  return Math.max(0, Math.min(100, Math.round((page / total) * 100)));
}

/** Which modes can supply which metric. `checkins` works for every book. */
const METRIC_MODES = Object.freeze({
  pages: ['page'], minutes: ['minutes'], books: PROGRESS_MODES, checkins: PROGRESS_MODES,
});

/**
 * Measure one obligation against a learner's shelf over a window.
 *
 * A pure function of the log — nothing is precomputed or stored alongside the
 * enrollment, so an obligation edited today reads correctly against reading
 * done last week.
 *
 * @param {object|null} obligation - from `validateBookLogEnrollment`
 * @param {object[]} items - shelf items, each with `events`
 * @param {{from?: string, to?: string}} window - study-day keys
 * @param {{dayOf?: (at: string) => string}} [options] - the day an instant
 *   belongs to, so that the window keys and the events agree on what a day is
 * @returns {{met: boolean, actual: number, target: number, metric: string|null,
 *   incompatibleBooks: string[]}}
 */
export function measureObligation(obligation, items = [], window = null, { dayOf = isoDay } = {}) {
  if (!obligation) {
    // Nothing owed is met by definition — the shelf is a log by default.
    return { met: true, actual: 0, target: 0, metric: null, incompatibleBooks: [] };
  }

  const scoped = (items ?? []).filter(Boolean).filter((item) => (
    !obligation.scope || obligation.scope.books.includes(item.bookId)
  ));

  const allowedModes = METRIC_MODES[obligation.metric] ?? PROGRESS_MODES;
  const usable = scoped.filter((item) => allowedModes.includes(item.progressMode));
  const incompatibleBooks = scoped
    .filter((item) => !allowedModes.includes(item.progressMode))
    .map((item) => item.bookId);

  const actual = countFor(obligation.metric, usable, window, dayOf);
  return {
    met: actual >= obligation.quantity,
    actual,
    target: obligation.quantity,
    metric: obligation.metric,
    incompatibleBooks,
  };
}

function countFor(metric, items, window, dayOf) {
  if (metric === 'books') {
    return items.filter((item) => sorted(item.events)
      .some((event) => event.kind === 'finished' && inWindow(event.at, window, dayOf))).length;
  }

  if (metric === 'minutes') {
    return items.reduce((sum, item) => sum + sorted(item.events)
      .filter((event) => inWindow(event.at, window, dayOf))
      .reduce((inner, event) => inner + (Number.isFinite(event.minutes) ? event.minutes : 0), 0), 0);
  }

  if (metric === 'checkins') {
    const days = new Set();
    for (const item of items) {
      for (const event of sorted(item.events)) {
        if (event.kind === 'set-aside') continue;
        if (inWindow(event.at, window, dayOf)) days.add(dayOf(event.at));
      }
    }
    return days.size;
  }

  // pages: per book, furthest-in-window minus furthest-before-window, floored
  // at zero so a re-read cannot subtract from another book's real reading.
  return items.reduce((sum, item) => {
    const events = sorted(item.events).filter((event) => Number.isFinite(event.page));
    const before = events.filter((event) => !inWindow(event.at, window, dayOf)
      && (!window?.from || dayOf(event.at) < window.from)).map((event) => event.page);
    const inside = events.filter((event) => inWindow(event.at, window, dayOf)).map((event) => event.page);
    if (inside.length === 0) return sum;
    const start = before.length ? Math.max(...before) : 0;
    return sum + Math.max(0, Math.max(...inside) - start);
  }, 0);
}

export default projectShelfItem;
