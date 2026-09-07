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
export const PROGRESS_KINDS = Object.freeze(['started', 'progress', 'finished', 'reopened', 'set-aside']);

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

/**
 * How far back a finish may be dated (2026-09-06).
 *
 * A finish carries a DAY the child chooses, not the instant they tapped, so
 * "I finished this on the trip last week" is an honest entry and the bound has
 * to be generous enough to hold it. It cannot be unbounded: a book started
 * today was found stamped `2026-08-19`, eighteen days earlier, which drops
 * credit into a week the gradebook has already reported on. Fourteen days keeps
 * every plausible catch-up and refuses that.
 *
 * A grown-up route is the escape hatch for anything older — deliberately, so an
 * entry that rewrites a closed period passes through someone who can see it.
 */
export const MAX_BACKDATE_DAYS = 14;

const DAY_MS = 86_400_000;

/**
 * Whole days from `from` to `to`, both `YYYY-MM-DD`. Anchored at noon UTC via
 * `noonOf` so no household timezone or DST shift can move a day boundary
 * underneath the subtraction.
 *
 * @returns {number|null} null when either key is not a real day
 */
export function daysBetween(from, to) {
  if (!isDayKey(from) || !isDayKey(to)) return null;
  return Math.round((Date.parse(noonOf(to)) - Date.parse(noonOf(from))) / DAY_MS);
}

/**
 * May a finish be dated `day`, given today's study day?
 *
 * Refuses the future for the same reason the callers already do, and the
 * distant past for the reason above. Fails closed on an unreadable day — the
 * callers validate the shape first, so reaching here with junk is a caller bug,
 * not an entry to wave through.
 *
 * @param {string} day - the chosen finish day, `YYYY-MM-DD`
 * @param {string} today - the household study day, `YYYY-MM-DD`
 * @param {{maxDaysBack?: number}} [options]
 * @returns {boolean}
 */
export function isBackdateAllowed(day, today, { maxDaysBack = MAX_BACKDATE_DAYS } = {}) {
  const delta = daysBetween(day, today);
  if (delta === null) return false;
  return delta >= 0 && delta <= maxDaysBack;
}

/**
 * The oldest day `isBackdateAllowed` will accept — the SAME rule read forwards,
 * so the floor the server enforces and the floor it advertises to the panel
 * cannot drift apart. `GetBookShelf` puts this on the shelf view and the day
 * picker draws its window from it, rather than either side hardcoding 14.
 *
 * @param {string} today - the household study day, `YYYY-MM-DD`
 * @param {{maxDaysBack?: number}} [options]
 * @returns {string|null} null when `today` is not a real day
 */
export function earliestBackdateDay(today, { maxDaysBack = MAX_BACKDATE_DAYS } = {}) {
  if (!isDayKey(today)) return null;
  return new Date(Date.parse(noonOf(today)) - maxDaysBack * DAY_MS).toISOString().slice(0, 10);
}

/**
 * How far past a book's stated length a page may still be logged.
 *
 * NOT 1. `percentFor` below deliberately keeps a page beyond `pageCount` and
 * clamps only the bar — "the 212-of-184 case" — because mispaginated metadata,
 * omnibus editions and a different printing are all real, and the page the
 * child is looking at is the true fact. A hard `page <= pageCount` would
 * reverse that decision and start refusing honest entries.
 *
 * What it will not hold is 250 of 192 followed by page 5 fifteen seconds later
 * (observed 2026-09-06), which is a keypad being mashed. Doubling the book is
 * the widest edition mismatch anyone has produced and is comfortably past every
 * real one.
 */
export const PAGE_PLAUSIBILITY_FACTOR = 2;

/**
 * Is `page` a plausible page of a book `pageCount` long?
 *
 * TRUE WHENEVER THERE IS NO DENOMINATOR, and that is the load-bearing half.
 * `pageCount` is null in measured, ordinary cases: Google Books returned 0 for
 * two of three books on 2026-09-02, an unresolved ISBN opens a minimal record
 * with none at all, and the `partway` door forces page mode with no denominator
 * on purpose. It is also snapshotted at open time and never refreshed, so an
 * item opened before metadata resolved keeps `null` forever. Treating "unknown
 * length" as "no ceiling" is therefore the common path, not the edge case —
 * inverting this would refuse a large share of legitimate logs.
 *
 * @param {number} page
 * @param {number|null|undefined} pageCount
 * @param {{factor?: number}} [options]
 * @returns {boolean}
 */
export function isPlausiblePage(page, pageCount, { factor = PAGE_PLAUSIBILITY_FACTOR } = {}) {
  if (!Number.isInteger(page) || page <= 0) return false;
  if (!Number.isFinite(pageCount) || pageCount <= 0) return true;
  return page <= pageCount * factor;
}

/** Is a study day inside the window? The v2 shape asks this directly. */
const inDayWindow = (day, window) => {
  if (!window) return true;
  if (!day) return false;
  return (!window.from || day >= window.from) && (!window.to || day <= window.to);
};

/** The v1 shape must first ask what day an INSTANT belonged to. */
const inWindow = (at, window, dayOf) => inDayWindow(dayOf(at), window);

const sorted = (events) => [...(events ?? [])].filter(Boolean)
  .sort((left, right) => String(left.at).localeCompare(String(right.at)));

/**
 * Finish corrections follow APPEND order, not event time. A child may undo a
 * finish today and then choose the correct date last week; sorting those two
 * by their represented dates would put the correction after the new finish.
 */
function finishFacts(events) {
  let active = null;
  const corrected = new Set();
  for (const event of (events ?? []).filter(Boolean)) {
    if (event.kind === 'finished') active = event;
    if (event.kind === 'reopened' && active) {
      corrected.add(active);
      active = null;
    }
  }
  return { active, corrected };
}

/** Opening/setting aside is not reading; a finish canceled by reopen is not evidence. */
function readingEvents(events) {
  const facts = finishFacts(events);
  return sorted(events).filter((event) => (
    event.kind === 'progress' || (event.kind === 'finished' && !facts.corrected.has(event))
  ));
}

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
  const finish = finishFacts(item?.events).active;
  const finished = Boolean(finish);

  // A finish decision is effective wherever it sorts until a later `reopened`
  // correction supersedes it. The "already finished it" door stamps both the
  // open and finish on the chosen past day; the explicit correction is what
  // makes an accidental finish reversible without deleting evidence.
  const status = finished ? 'finished'
    : (last?.kind === 'set-aside' ? 'set-aside'
      : (events.length > 0 ? 'reading' : 'unread'));

  // The FURTHEST page, not the latest: re-reading a chapter moves the number
  // backwards, and a child who reached page 84 has reached page 84.
  const pages = events.map((event) => event.page).filter((page) => Number.isFinite(page));
  const page = pages.length ? Math.max(...pages) : null;

  const minutes = events.reduce((sum, event) => sum + (Number.isFinite(event.minutes) ? event.minutes : 0), 0);
  // The same set `measureObligation('checkins')` counts. Merely adding a book
  // emits `started`, but is not evidence that the child read that day.
  const daysRead = new Set(readingEvents(item?.events)
    .map((event) => dayOf(event.at)).filter(Boolean)).size;

  return {
    status,
    page,
    percent: percentFor(item, page, finished),
    minutes: item?.progressMode === 'minutes' ? minutes : (minutes || null),
    daysRead,
    lastAt: (finished ? finish?.at : last?.at) ?? null,
  };
}

/**
 * Is this record a v2 reading rather than a v1 shelf item?
 *
 * `entries` is the discriminator because it is the field v2 adds and v1 has no
 * name for. Every function below that must serve both shapes asks here rather
 * than being called twice from two branches — a store mid-migration hands back
 * a list, not a promise about what is in it.
 */
const isReading = (record) => Array.isArray(record?.entries);

/** The book a record is about, wherever that shape keeps it. */
const bookIdOf = (record) => (isReading(record) ? record?.book?.isbn : record?.bookId) ?? null;

/**
 * One v1 shelf item as the v2 reading it means.
 *
 * ## WHAT BECOMES A ROW, AND WHAT BECOMES A FIELD
 *
 * `started`, `set-aside` and `reopened` are STATE CHANGES, not evidence that a
 * child read that day — and treating them as rows is what let array position
 * decide a book's status. They become `openedOn` and `status`. `progress` and
 * an uncancelled `finished` are evidence and become entries; a finish a child
 * took back was never evidence under v1 either, so it does not become one now.
 * That is what keeps `daysRead` identical across the conversion.
 *
 * ## THE DAY RULE MUST BE THE HOUSEHOLD'S
 *
 * `on` is computed from `at` through the injected `dayOf`. Converting with the
 * default ISO slice under a household on a 4am boundary would move a 7pm read
 * to the next day, silently shifting real reading into a week already reported
 * on. Callers pass the same `dayOf` the launcher measures with.
 *
 * Ids are injected, not minted: the store maps a v1 file on READ and must
 * produce the same ids every time, while the migration deliberately mints
 * fresh opaque ones.
 *
 * @param {object} item - a v1 shelf item
 * @param {{learnerId?: string|null, dayOf?: (at: string) => string,
 *   readingId?: string, entryIdFor?: (event: object, index: number) => string}} [options]
 * @returns {object} a v2 reading
 */
export function readingFromLegacyItem(item, {
  learnerId = null,
  dayOf = isoDay,
  readingId = null,
  entryIdFor = (event, index) => `ent_${event?.entryId ?? index}`,
} = {}) {
  const events = (Array.isArray(item?.events) ? item.events : []).filter(
    (event) => event && typeof event === 'object',
  );
  const opening = sorted(events).find((event) => event.kind === 'started') ?? null;
  const finish = finishFacts(events).active;

  return {
    id: readingId ?? item?.itemId ?? null,
    learnerId,
    book: { isbn: item?.bookId ?? null, pageCount: item?.pageCount ?? null },
    progressMode: item?.progressMode ?? 'page',
    // The normalised event list, not the raw one: a hand-edited file can hold
    // anything, and a conversion that throws is a shelf a grown-up cannot open.
    status: projectShelfItem({ ...item, events }, { dayOf }).status,
    openedOn: dayOf(item?.openedAt ?? opening?.at ?? '') || null,
    finishedOn: finish ? (dayOf(finish.at) || null) : null,
    // The client's retry key, doing ONE job now. It named the item as well as
    // deduping the open; only the deduping survives.
    idempotencyKey: opening?.entryId ?? null,
    entries: readingEvents(events).map((event, index) => ({
      id: entryIdFor(event, index),
      on: dayOf(event.at) || null,
      at: event.at ?? null,
      ...(Number.isFinite(event.page) ? { page: event.page } : {}),
      ...(Number.isFinite(event.minutes) ? { minutes: event.minutes } : {}),
      ...(event.note ? { note: String(event.note) } : {}),
      ...(Number.isFinite(event.rating) ? { rating: event.rating } : {}),
      ...(event.externalId ? { externalId: String(event.externalId) } : {}),
      source: event.source ? String(event.source) : 'panel',
      idempotencyKey: event.entryId ?? null,
    })),
    revisions: [],
  };
}

/**
 * Everything a shelf card or a teacher row needs for one v2 reading.
 *
 * ## STATUS IS READ, NOT INFERRED
 *
 * `projectShelfItem` above decides the lifecycle state from ARRAY POSITION —
 * `set-aside` counts only while it is the last event, and a finish holds only
 * until a `reopened` cancels it. That is the defect v2 exists to remove: a
 * grown-up could not SET a state, only append an event whose position implied
 * one. Here the stored `status` is taken verbatim. Nothing about the order of
 * `entries` can change it.
 *
 * ## `daysRead` MAPS NOTHING
 *
 * An entry's `on` is already the study day it happened, chosen when the row was
 * written, so there is no `dayOf` to inject and no instant to reinterpret. That
 * is the whole point of separating `on` from `at`.
 *
 * ## THE FURTHEST PAGE STILL WINS
 *
 * `Math.max`, exactly as before: a child re-reading a chapter has still reached
 * the page they reached. That rule was only ever a trap because a fat-fingered
 * 250 could not be taken back — v2 gives every entry an id, so the row can be
 * corrected or removed instead of the projection being weakened.
 *
 * @param {{status?: string, progressMode?: string, book?: {pageCount?: number|null},
 *   entries?: object[]}} reading
 * @returns {{status: string|null, page: number|null, percent: number|null,
 *   minutes: number|null, daysRead: number, lastOn: string|null, lastAt: string|null}}
 */
export function projectReading(reading) {
  const entries = Array.isArray(reading?.entries) ? reading.entries.filter(Boolean) : [];
  const status = typeof reading?.status === 'string' ? reading.status : null;
  const finished = status === 'finished';

  const pages = entries.map((entry) => entry?.page).filter((page) => Number.isFinite(page));
  const page = pages.length ? Math.max(...pages) : null;
  const minutes = entries.reduce((sum, entry) => sum + (Number.isFinite(entry?.minutes) ? entry.minutes : 0), 0);

  const days = entries.map((entry) => entry?.on).filter((day) => typeof day === 'string' && day);
  const instants = entries.map((entry) => entry?.at).filter((at) => typeof at === 'string' && at);

  return {
    status,
    page,
    percent: percentOf(reading?.progressMode, reading?.book?.pageCount, page, finished),
    minutes: reading?.progressMode === 'minutes' ? minutes : (minutes || null),
    daysRead: new Set(days).size,
    // Two different questions. "When did they last read" is a study day the
    // child lived; "when was this last touched" is an instant the system
    // recorded. A finish logged on Sunday for Friday answers them differently,
    // and the teacher view shows both.
    lastOn: days.length ? days.reduce((latest, day) => (day > latest ? day : latest)) : null,
    lastAt: instants.length ? instants.reduce((latest, at) => (at > latest ? at : latest)) : null,
  };
}

/** How many other in-progress books the card names. Two fits the narrow column. */
export const ALSO_READING_LIMIT = 2;

/**
 * Which book a printed card should headline, and which others it may name.
 *
 * The card has room for one book. This picks it from the whole shelf, with no
 * I/O, no clock and no titles — titles are joined by the caller, which is the
 * only layer that can resolve a `bookId` into words.
 *
 * ## NEAREST THE END WINS, BUT ONLY AMONG BOOKS THAT HAVE AN END
 *
 * A child is most likely to finish the book they are closest to finishing, so
 * the highest `percent` leads. What makes this more than a sort is that
 * `percent` is null in ordinary cases — minutes mode, check mode, and any book
 * whose provider gave no `pageCount`, which `isPlausiblePage` above records was
 * two of three books on one measured day. So a book WITH a denominator outranks
 * one without, and everything else falls to `lastAt`. That fallback is not the
 * edge case; on a shelf of audiobooks and reference books it is the only rule
 * that ever runs.
 *
 * ## `itemId` BREAKS THE LAST TIE SO TWO PRINTS OF ONE DAY ARE THE SAME PAGE
 *
 * Two books at the same percentage, logged in the same minute, are a real tie.
 * Without a final key the winner came from whatever order the store handed back
 * — file order, which nothing guarantees and a rewrite can change. A reprint
 * would then headline a different book than the sheet already on the fridge,
 * and a child would be right to say the page lied. `itemId` is arbitrary but
 * stable, which is exactly what a tiebreak needs to be.
 *
 * ## `set-aside` IS A STATE A CHILD CHOSE, NOT AN ABSENCE
 *
 * When nothing is open, a finished book leads, then a set-aside one. Folding
 * `set-aside` into `empty` would print "you have no books" to a child who put
 * one down on purpose and can see it on the shelf — telling them their own log
 * is empty when it is not. `empty` is reserved for a shelf that truly holds
 * nothing.
 *
 * @param {object[]|null|undefined} items - raw shelf items, each with `itemId` and `events`
 * @param {{dayOf?: (at: string) => string}} [options]
 * @returns {{state: 'reading'|'finished'|'set-aside'|'empty',
 *   featured: {item: object, projection: object}|null,
 *   alsoReading: {item: object, projection: object}[]}}
 */
export function selectFeaturedShelfItem(items, { dayOf = isoDay } = {}) {
  const projected = (Array.isArray(items) ? items : [])
    // A row with no string `itemId` cannot be one of ours: the store builds
    // `<learner>:<book>:<entry>` at open and refuses to append without it. Dropping
    // it silently is deliberate — an unreadable shelf throws in the store, one layer
    // up, so anything reaching here is a hand-edited row, and a card that prints one
    // fewer book beats a card that does not print. `unread` items land here too.
    .filter((item) => item && typeof item === 'object' && typeof item.itemId === 'string')
    .map((item) => ({ item, projection: projectShelfItem(item, { dayOf }) }));

  const withStatus = (status) => projected.filter((entry) => entry.projection.status === status);

  // Newest first, then itemId — the stable order every branch below shares.
  const byRecency = (a, b) => String(b.projection.lastAt ?? '').localeCompare(String(a.projection.lastAt ?? ''))
    || String(a.item.itemId).localeCompare(String(b.item.itemId));

  const reading = withStatus('reading');
  if (reading.length) {
    const ranked = reading.sort((a, b) => {
      // -1, not 0: a book at page 1 of 500 IS 0%, and it still has a denominator.
      // Safe because `percentFor` clamps to 0..100, so no real percent reaches -1.
      const aPct = Number.isFinite(a.projection.percent) ? a.projection.percent : -1;
      const bPct = Number.isFinite(b.projection.percent) ? b.projection.percent : -1;
      return bPct - aPct || byRecency(a, b);
    });
    const [featured, ...rest] = ranked;
    return {
      state: 'reading',
      featured,
      alsoReading: rest.sort(byRecency).slice(0, ALSO_READING_LIMIT),
    };
  }

  for (const status of ['finished', 'set-aside']) {
    const candidates = withStatus(status);
    if (candidates.length) {
      return { state: status, featured: candidates.sort(byRecency)[0], alsoReading: [] };
    }
  }

  return { state: 'empty', featured: null, alsoReading: [] };
}

function percentFor(item, page, finished) {
  return percentOf(item?.progressMode, item?.pageCount, page, finished);
}

/**
 * The one percentage rule, so a v1 item and the v2 reading it converts into
 * cannot draw two different bars. Where the length lives differs between the
 * shapes — `item.pageCount`, `reading.book.pageCount` — and that is all.
 */
function percentOf(progressMode, pageCount, page, finished) {
  if (finished) return 100;
  if (progressMode !== 'page') return null;
  if (!Number.isFinite(pageCount) || pageCount <= 0 || !Number.isFinite(page)) return null;
  // Clamp the BAR, keep the page. See the 212-of-184 case.
  return Math.max(0, Math.min(100, Math.round((page / pageCount) * 100)));
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

  const scoped = (items ?? []).filter(Boolean).filter((record) => (
    !obligation.scope || obligation.scope.books.includes(bookIdOf(record))
  ));

  const allowedModes = METRIC_MODES[obligation.metric] ?? PROGRESS_MODES;
  const usable = scoped.filter((record) => allowedModes.includes(record.progressMode));
  const incompatibleBooks = scoped
    .filter((record) => !allowedModes.includes(record.progressMode))
    .map((record) => bookIdOf(record));

  const actual = countFor(obligation.metric, usable, window, dayOf);
  return {
    met: actual >= obligation.quantity,
    actual,
    target: obligation.quantity,
    metric: obligation.metric,
    incompatibleBooks,
  };
}

function countFor(metric, records, window, dayOf) {
  if (metric === 'books') {
    return records.filter((record) => finishedInWindow(record, window, dayOf)).length;
  }

  if (metric === 'minutes') {
    return records.reduce((sum, record) => sum + evidenceOf(record, dayOf)
      .filter((row) => inDayWindow(row.on, window))
      .reduce((inner, row) => inner + (Number.isFinite(row.minutes) ? row.minutes : 0), 0), 0);
  }

  if (metric === 'checkins') {
    const days = new Set();
    for (const record of records) {
      for (const row of evidenceOf(record, dayOf)) {
        if (row.on && inDayWindow(row.on, window)) days.add(row.on);
      }
    }
    return days.size;
  }

  // pages: per book, furthest-in-window minus furthest-before-window, floored
  // at zero so a re-read cannot subtract from another book's real reading.
  return records.reduce((sum, record) => {
    const rows = evidenceOf(record, dayOf).filter((row) => Number.isFinite(row.page));
    const before = rows.filter((row) => !inDayWindow(row.on, window)
      && (!window?.from || row.on < window.from)).map((row) => row.page);
    const inside = rows.filter((row) => inDayWindow(row.on, window)).map((row) => row.page);
    if (inside.length === 0) return sum;
    const start = before.length ? Math.max(...before) : 0;
    return sum + Math.max(0, Math.max(...inside) - start);
  }, 0);
}

/**
 * One record's dated evidence as `{ on, page, minutes }`, whichever shape it is.
 *
 * The v2 half is the whole point of the redesign: an entry already knows the
 * study day it belongs to, so nothing reinterprets an instant. The v1 half
 * still has to ask `dayOf`, and still has to exclude the events that were only
 * ever state changes — the two together are why v1 could not be edited.
 */
function evidenceOf(record, dayOf) {
  if (isReading(record)) {
    return (record.entries ?? []).filter(Boolean).map((entry) => ({
      on: typeof entry.on === 'string' ? entry.on : null,
      page: entry.page,
      minutes: entry.minutes,
    }));
  }
  return readingEvents(record?.events).map((event) => ({
    on: dayOf(event.at) || null, page: event.page, minutes: event.minutes,
  }));
}

/**
 * Did this record finish inside the window?
 *
 * v2 answers from the STORED decision and its `finishedOn`. v1 has to scan for
 * a `finished` that no later `reopened` cancels — the correction-event pattern
 * arriving through the back door, and the reason a grown-up could never simply
 * mark a book done.
 */
function finishedInWindow(record, window, dayOf) {
  if (isReading(record)) {
    return record.status === 'finished' && inDayWindow(record.finishedOn, window);
  }
  const finish = finishFacts(record?.events).active;
  return Boolean(finish) && inWindow(finish.at, window, dayOf);
}

export default projectShelfItem;
