# Reading Log Card Parity — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the printed agenda's reading-log entry a proper lesson card — one card, never two — naming the book the child is closest to finishing, and bound a lost code with a use cap instead of a shorter clock.

**Architecture:** A new pure selector in `2_domains/school/bookShelf.mjs` picks the featured book from shelf items. A new agenda-only method on `BookLogProgramLauncher` joins that selection to book titles from `bookRepository` (never `status()`, which the teacher board and DoNow also call). `receipts.mjs` builds the card through the existing `lessonAction` instead of the bare `readingLogAction`, and skips the standalone card entirely when a section already renders the shelf.

**Tech Stack:** Node ESM (`.mjs`), vitest 4, thermal-receipt document blocks (`scan_action` with `presentation: 'lesson'`).

**Design doc:** `docs/_wip/plans/2026-09-06-reading-log-card-parity-design.md` — read it before Task 1. It records four decisions that were reversed under review; do not re-derive them.

---

## Working agreements

- **Worktree:** `.worktrees/reading-card-parity`, branch `school/reading-card-parity`. Run everything from there. Do not `cd` to the main checkout.
- **Run one test file:** `npx vitest run <path>` — works from the worktree root. Do NOT use `npm test` (full sweep, ~1000 files).
- **Baseline (verified 2026-09-06, all green):**
  - `backend/src/2_domains/school/bookShelf.test.mjs` — 31 pass
  - `tests/isolated/application/school/buildAgenda.test.mjs` + `backend/src/2_domains/school/documents/receipts.agenda.test.mjs` — 55 pass
- **Commit after every task.** Small commits, conventional prefixes.
- **Do not run a second backend.** Nothing here needs a server; every test is isolated. See `CLAUDE.local.md`.

---

### Task 1: Commit the design doc

**Files:**
- Commit: `docs/_wip/plans/2026-09-06-reading-log-card-parity-design.md`, `docs/_wip/plans/2026-09-06-reading-log-card-parity-plan.md`

**Step 1: Commit**

```bash
git add docs/_wip/plans/2026-09-06-reading-log-card-parity-design.md docs/_wip/plans/2026-09-06-reading-log-card-parity-plan.md
git commit -m "docs(school): design and plan for reading-log card parity"
```

---

### Task 2: The featured-book selector (pure domain)

The card needs to know WHICH book to headline. That is arithmetic over projections and belongs beside `projectShelfItem`, testable without a launcher, a store or a clock.

**Files:**
- Modify: `backend/src/2_domains/school/bookShelf.mjs` (append after `projectShelfItem`, before `percentFor`)
- Test: `backend/src/2_domains/school/bookShelf.test.mjs` (append a new `describe`)

**Step 1: Write the failing tests**

Append to `bookShelf.test.mjs`. Note the existing file's helpers — read the top of it first and reuse whatever item factory it already has rather than adding a second one.

```javascript
describe('selectFeaturedShelfItem', () => {
  // `at` values are ISO instants; `dayOf` defaults to the ISO date.
  const item = (itemId, { mode = 'page', pageCount = null, events = [] } = {}) => ({
    itemId, bookId: `isbn-${itemId}`, progressMode: mode, pageCount, events,
  });
  const read = (at, page = null) => ({ kind: 'progress', at, ...(page ? { page } : {}) });

  it('features the in-progress book nearest the end', () => {
    const near = item('a', { pageCount: 100, events: [read('2026-09-01T10:00:00Z', 90)] });
    const far = item('b', { pageCount: 100, events: [read('2026-09-05T10:00:00Z', 10)] });
    const result = selectFeaturedShelfItem([far, near]);
    expect(result.state).toBe('reading');
    expect(result.featured.item.itemId).toBe('a');
  });

  it('falls back to most recently touched when no book has a percent', () => {
    // check-mode books never have a percent (percentFor returns null)
    const older = item('a', { mode: 'check', events: [read('2026-09-01T10:00:00Z')] });
    const newer = item('b', { mode: 'check', events: [read('2026-09-05T10:00:00Z')] });
    const result = selectFeaturedShelfItem([older, newer]);
    expect(result.featured.item.itemId).toBe('b');
  });

  it('prefers a book WITH a percent over a more recent one without', () => {
    const measured = item('a', { pageCount: 100, events: [read('2026-09-01T10:00:00Z', 50)] });
    const unmeasured = item('b', { mode: 'check', events: [read('2026-09-05T10:00:00Z')] });
    expect(selectFeaturedShelfItem([unmeasured, measured]).featured.item.itemId).toBe('a');
  });

  it('breaks a tie on itemId so two prints of one day agree', () => {
    const b = item('b', { pageCount: 100, events: [read('2026-09-01T10:00:00Z', 50)] });
    const a = item('a', { pageCount: 100, events: [read('2026-09-01T10:00:00Z', 50)] });
    expect(selectFeaturedShelfItem([b, a]).featured.item.itemId).toBe('a');
  });

  it('lists the other in-progress books, newest first, capped at two', () => {
    const feature = item('a', { pageCount: 100, events: [read('2026-09-01T10:00:00Z', 90)] });
    const one = item('b', { pageCount: 100, events: [read('2026-09-05T10:00:00Z', 10)] });
    const two = item('c', { pageCount: 100, events: [read('2026-09-04T10:00:00Z', 10)] });
    const three = item('d', { pageCount: 100, events: [read('2026-09-03T10:00:00Z', 10)] });
    const result = selectFeaturedShelfItem([feature, three, one, two]);
    expect(result.alsoReading.map((entry) => entry.item.itemId)).toEqual(['b', 'c']);
  });

  it('features the most recently finished book when nothing is open', () => {
    const done = item('a', {
      pageCount: 100,
      events: [read('2026-09-01T10:00:00Z', 100), { kind: 'finished', at: '2026-09-02T10:00:00Z' }],
    });
    const result = selectFeaturedShelfItem([done]);
    expect(result.state).toBe('finished');
    expect(result.featured.item.itemId).toBe('a');
  });

  it('features a set-aside book rather than claiming the shelf is empty', () => {
    // A set-aside book is a real outcome the child chose. Reporting "start a
    // book" would be a lie about their own log.
    const aside = item('a', {
      events: [read('2026-09-01T10:00:00Z'), { kind: 'set-aside', at: '2026-09-02T10:00:00Z' }],
    });
    const result = selectFeaturedShelfItem([aside]);
    expect(result.state).toBe('set-aside');
    expect(result.featured.item.itemId).toBe('a');
  });

  it('prefers a finished book over a set-aside one', () => {
    const aside = item('a', { events: [{ kind: 'set-aside', at: '2026-09-05T10:00:00Z' }] });
    const done = item('b', { events: [{ kind: 'finished', at: '2026-09-01T10:00:00Z' }] });
    expect(selectFeaturedShelfItem([aside, done]).state).toBe('finished');
  });

  it('is empty for a learner with no items', () => {
    const result = selectFeaturedShelfItem([]);
    expect(result).toEqual({ state: 'empty', featured: null, alsoReading: [] });
  });

  it('never throws on junk', () => {
    expect(selectFeaturedShelfItem(null).state).toBe('empty');
    expect(selectFeaturedShelfItem([null, undefined, {}]).state).toBe('empty');
  });
});
```

Add `selectFeaturedShelfItem` to the file's existing import from `./bookShelf.mjs`.

**Step 2: Run to verify it fails**

```bash
npx vitest run backend/src/2_domains/school/bookShelf.test.mjs
```
Expected: FAIL — `selectFeaturedShelfItem is not a function`.

**Step 3: Implement**

Append to `bookShelf.mjs`, immediately after `projectShelfItem`:

```javascript
/** How many other in-progress books the card names. Two fits the narrow column. */
export const ALSO_READING_LIMIT = 2;

/**
 * Which book the printed card headlines, and which others it merely names.
 *
 * ## NEAREST THE END WINS, AND THE FALLBACK CARRIES REAL TRAFFIC
 *
 * The card exists to push a child toward finishing, so the in-progress book
 * with the highest `percent` is the headline. But `percent` is null for
 * minutes-mode, check-mode, and every book whose provider gave no `pageCount` —
 * the ordinary case, not an edge one. So a book WITH a denominator outranks one
 * without, and among books that share a rank the most recently touched wins.
 *
 * `itemId` breaks the last tie, so two prints of the same day are the same
 * page. Without it the order came from the store's file order, which nothing
 * guarantees.
 *
 * ## SET-ASIDE IS A STATE, NOT AN ABSENCE
 *
 * `projectShelfItem` has four statuses and a child chose three of them. Folding
 * `set-aside` into "no books" would tell a child their own log is empty.
 *
 * Pure. Never throws — a shelf that cannot be read is the caller's `unreadable`,
 * not this function's problem.
 *
 * @param {object[]} items - raw shelf items, as `IBookLogStore.listForLearner` answers
 * @param {{dayOf?: (at: string) => string, alsoReadingLimit?: number}} [options]
 * @returns {{state: 'reading'|'finished'|'set-aside'|'empty',
 *   featured: {item: object, projection: object}|null,
 *   alsoReading: Array<{item: object, projection: object}>}}
 */
export function selectFeaturedShelfItem(items, { dayOf = isoDay, alsoReadingLimit = ALSO_READING_LIMIT } = {}) {
  const projected = (Array.isArray(items) ? items : [])
    .filter((item) => item && typeof item === 'object' && typeof item.itemId === 'string')
    .map((item) => ({ item, projection: projectShelfItem(item, { dayOf }) }));

  const withStatus = (status) => projected.filter((entry) => entry.projection.status === status);

  // Newest first, then itemId — the stable order every branch below shares.
  const byRecency = (a, b) => String(b.projection.lastAt ?? '').localeCompare(String(a.projection.lastAt ?? ''))
    || String(a.item.itemId).localeCompare(String(b.item.itemId));

  const reading = withStatus('reading');
  if (reading.length) {
    const ranked = [...reading].sort((a, b) => {
      const aPct = Number.isFinite(a.projection.percent) ? a.projection.percent : -1;
      const bPct = Number.isFinite(b.projection.percent) ? b.projection.percent : -1;
      return bPct - aPct || byRecency(a, b);
    });
    const [featured, ...rest] = ranked;
    return {
      state: 'reading',
      featured,
      alsoReading: rest.sort(byRecency).slice(0, Math.max(0, alsoReadingLimit)),
    };
  }

  for (const status of ['finished', 'set-aside']) {
    const candidates = withStatus(status);
    if (candidates.length) {
      return { state: status, featured: [...candidates].sort(byRecency)[0], alsoReading: [] };
    }
  }

  return { state: 'empty', featured: null, alsoReading: [] };
}
```

**Step 4: Run to verify it passes**

```bash
npx vitest run backend/src/2_domains/school/bookShelf.test.mjs
```
Expected: PASS, 41 tests (31 existing + 10 new).

**Step 5: Commit**

```bash
git add backend/src/2_domains/school/bookShelf.mjs backend/src/2_domains/school/bookShelf.test.mjs
git commit -m "feat(school): pick the shelf book a printed card should headline"
```

---

### Task 3: `featuredBook()` on the launcher

Joins the selection to titles. **It is a separate method, not an addition to `status()`** — `status()` runs behind `collectProgramStatuses` → `PlanProjection`, which the teacher board, the status board, DoNow and the completion recompute all call. Per-book repository reads must not ride along.

**Files:**
- Modify: `backend/src/3_applications/school/BookLogProgramLauncher.mjs` (constructor ~line 77; new method after `status()`)
- Test: `backend/src/3_applications/school/BookLogProgramLauncher.test.mjs`

**Step 1: Write the failing tests**

Read the existing suite's fixtures first and reuse them. Add:

```javascript
describe('featuredBook', () => {
  it('names the book, its author and its page', async () => {
    // shelf: one page-mode book, page 84 of 184
    const launcher = makeLauncher({
      bookLog: shelfWith([bookItem('isbn1', { pageCount: 184, page: 84 })]),
      bookRepository: { async findByIsbn() { return { title: 'Hatchet', authors: ['Gary Paulsen'], pageCount: 184 }; } },
    });
    const result = await launcher.featuredBook({ userId: 'kid' });
    expect(result.state).toBe('reading');
    expect(result.book.title).toBe('Hatchet');
    expect(result.book.authors).toEqual(['Gary Paulsen']);
    expect(result.page).toBe(84);
    expect(result.percent).toBe(46);
  });

  it('answers for an UNENROLLED learner — the shelf never needed an enrollment', async () => {
    const launcher = makeLauncher({
      assignments: { async get() { return { programs: [] }; } },
      bookLog: shelfWith([bookItem('isbn1', { pageCount: 184, page: 84 })]),
      bookRepository: { async findByIsbn() { return { title: 'Hatchet', authors: [], pageCount: 184 }; } },
    });
    expect((await launcher.featuredBook({ userId: 'kid' })).state).toBe('reading');
  });

  it('degrades to a titleless card when the repository throws', async () => {
    const launcher = makeLauncher({
      bookLog: shelfWith([bookItem('isbn1', { pageCount: 184, page: 84 })]),
      bookRepository: { async findByIsbn() { throw new Error('cache cold'); } },
    });
    const result = await launcher.featuredBook({ userId: 'kid' });
    expect(result.state).toBe('reading');
    expect(result.book).toBeNull();
    expect(result.page).toBe(84);
  });

  it('degrades the same way with no repository wired at all', async () => {
    const launcher = makeLauncher({
      bookLog: shelfWith([bookItem('isbn1', { pageCount: 184, page: 84 })]),
      bookRepository: null,
    });
    expect((await launcher.featuredBook({ userId: 'kid' })).book).toBeNull();
  });

  it('reports an unreadable shelf as unreadable, never as empty', async () => {
    const launcher = makeLauncher({
      bookLog: { async listForLearner() { throw new Error('damaged yaml'); } },
    });
    expect((await launcher.featuredBook({ userId: 'kid' })).state).toBe('unreadable');
  });

  it('names up to two other in-progress books', async () => {
    // three reading items; expect two titles in alsoReading
  });
});

it('status() still does not read the book repository', async () => {
  // A repository whose findByIsbn throws must not affect status(): the teacher
  // board, DoNow and the completion recompute all call it.
  let called = false;
  const launcher = makeLauncher({
    bookRepository: { async findByIsbn() { called = true; throw new Error('nope'); } },
  });
  await launcher.status({ userId: 'kid' });
  expect(called).toBe(false);
});
```

**Step 2: Run to verify it fails**

```bash
npx vitest run backend/src/3_applications/school/BookLogProgramLauncher.test.mjs
```
Expected: FAIL — `launcher.featuredBook is not a function`.

**Step 3: Implement**

Constructor: accept `bookRepository = null` and store it. It is optional on purpose — a composition without a books API still prints the card, titleless.

```javascript
/**
 * What the printed agenda card headlines — NOT part of `status()`.
 *
 * `status()` runs inside `collectProgramStatuses`, which `PlanProjection` calls
 * for the teacher board, the status board, DoNow and the completion recompute.
 * Book titles come from a per-item repository read, and putting N of those
 * behind every one of those surfaces to decorate one printed card is a cost
 * none of them asked for. The agenda calls this; nothing else does.
 *
 * Book facts are DECORATION. A cold cache, a throwing repository, an
 * unresolved ISBN, or a composition with no books API at all degrades to
 * `book: null` and the card prints without a title — never fewer cards, and
 * never a card that claims a book it could not name.
 */
async featuredBook({ userId } = {}) {
  const learnerId = userId;
  if (typeof learnerId !== 'string' || !learnerId) throw new TypeError('BookLogProgramLauncher.featuredBook takes { userId }');
  let items;
  try {
    items = (await this.#bookLog.listForLearner(learnerId)) ?? [];
  } catch (error) {
    this.#logger.warn?.('school.book-log.shelf-unreadable', { learnerId, error: error.message });
    return { state: 'unreadable', book: null, page: null, percent: null, minutes: null, daysRead: 0, at: null, alsoReading: [] };
  }

  const dayOf = (iso) => this.dayOf(iso);
  const { state, featured, alsoReading } = selectFeaturedShelfItem(items, { dayOf });
  if (!featured) {
    return { state, book: null, page: null, percent: null, minutes: null, daysRead: 0, at: null, alsoReading: [] };
  }

  const facts = await this.#bookFacts(featured.item.bookId, learnerId);
  const others = await Promise.all(alsoReading.map((entry) => this.#bookFacts(entry.item.bookId, learnerId)));

  return {
    state,
    book: facts,
    page: featured.projection.page,
    percent: featured.projection.percent,
    minutes: featured.projection.minutes,
    daysRead: featured.projection.daysRead,
    at: featured.projection.lastAt,
    alsoReading: others.map((book) => book?.title).filter(Boolean),
  };
}

/** Null on every failure. Decoration must never cost the card. */
async #bookFacts(bookId, learnerId) {
  if (!this.#bookRepository?.findByIsbn) return null;
  try {
    const book = await this.#bookRepository.findByIsbn(bookId);
    return book ? { title: book.title ?? null, authors: book.authors ?? [], pageCount: book.pageCount ?? null } : null;
  } catch (error) {
    this.#logger.warn?.('school.book-log.book-facts-failed', { learnerId, bookId, error: error.message });
    return null;
  }
}
```

Import `selectFeaturedShelfItem` from `#domains/school/bookShelf.mjs` alongside the existing imports.

**Step 4: Run**

```bash
npx vitest run backend/src/3_applications/school/BookLogProgramLauncher.test.mjs
```
Expected: PASS.

**Step 5: Commit**

```bash
git add backend/src/3_applications/school/BookLogProgramLauncher.mjs backend/src/3_applications/school/BookLogProgramLauncher.test.mjs
git commit -m "feat(school): agenda-only featuredBook() on the book-log launcher"
```

---

### Task 4: Wire `bookRepository` into the launcher

**Files:**
- Modify: `backend/src/5_composition/modules/schoolLifecycle.mjs:630-632`

**Step 1: Implement** — add `bookRepository` to the `BookLogProgramLauncher` construction. It is already a parameter of the module (`:258`) and already in scope. `app.mjs:3864,3918` passes a real one, so this is live in production, not theoretical.

**Step 2: Verify nothing else broke**

```bash
npx vitest run backend/src/5_composition/composition-contract-registry.test.mjs
```
Expected: PASS. If this file is slow or unrelated, run `npx vitest run tests/isolated/applications/school/readingLogForEveryLearner.test.mjs` as the cheaper smoke.

**Step 3: Commit**

```bash
git add backend/src/5_composition/modules/schoolLifecycle.mjs
git commit -m "feat(school): give the book-log launcher its book repository"
```

---

### Task 5: `#unreadable()` gains a context

An unreadable shelf currently answers with no `context` (`BookLogProgramLauncher.mjs:242-247`), which `:144-145` calls "the blank-artwork case the poster route exists to refuse" — the card has nothing to take its own name from.

**Files:**
- Modify: `backend/src/3_applications/school/BookLogProgramLauncher.mjs:242`
- Test: same suite

**Step 1: Failing test**

```javascript
it('an unreadable shelf still knows its own name', async () => {
  const launcher = makeLauncher({ bookLog: { async listForLearner() { throw new Error('damaged'); } } });
  const status = await launcher.status({ userId: 'kid' });
  expect(status.error).toBe(true);
  expect(status.context?.course?.title).toBeTruthy();
});
```

**Step 2–4:** Run (fails), add `context: bookLogContext()` to `#unreadable()`, run (passes).

**Step 5: Commit**

```bash
git commit -am "fix(school): an unreadable shelf still names itself"
```

---

### Task 6: Rename the course to "Reading log"

**Files:**
- Modify: `backend/src/2_domains/school/bookLog.mjs:76` (`course.title`), plus the two comments at `:60` and `:68` that assert the old wording, and the copy of that justification at `BookLogProgramLauncher.mjs:208-209`
- Modify: `backend/src/3_applications/school/StoryTimeProgramLauncher.mjs:180` — it says `'Reading log unavailable'` for a DIFFERENT program; change it to name story time
- Modify (comment only): `backend/src/3_applications/school/usecases/BuildAgenda.mjs:603` — note that the generic `'Independent study'` fallback here means "this work has no course", which is now a different thing from the named `Reading log` program
- Test: `backend/src/3_applications/school/BookLogProgramLauncher.test.mjs:209`, `tests/isolated/applications/school/readingLogForEveryLearner.test.mjs:158,197`, `tests/isolated/applications/school/accessCodeUseCap.test.mjs:89`

**Step 1: Update the four pinned assertions to expect `Reading log`. Run them — they should fail against the current source.**

```bash
npx vitest run tests/isolated/applications/school/readingLogForEveryLearner.test.mjs tests/isolated/applications/school/accessCodeUseCap.test.mjs backend/src/3_applications/school/BookLogProgramLauncher.test.mjs
```
Expected: FAIL, expected `Reading log` received `Independent study`.

**Step 2: Make the rename. Run again.** Expected: PASS.

**Step 3: Check nothing else pinned the string**

```bash
grep -rn "Independent study" backend tests frontend --include='*.mjs' --include='*.jsx' | grep -v node_modules
```
Expected: only the three generic fallbacks (`BuildAgenda.mjs:603`, `CloseSessionOutcome.mjs:468`, `IssueCorrectedResultReceipt.mjs:24`) and their tests. Those stay.

**Step 4: Commit**

```bash
git commit -am "feat(school): the reading log is called Reading log everywhere"
```

---

### Task 7: The card becomes a lesson card

**Files:**
- Modify: `backend/src/2_domains/school/documents/receipts.mjs` — `readingLogAction` (`:210`), the push site (`:596-603`), the `agendaDocument` signature (`:411-418`), and `nothingLeft` (`:583`)
- Test: `backend/src/2_domains/school/documents/receipts.agenda.test.mjs`

**Step 1: Write the failing tests**

```javascript
it('prints the reading log as a lesson card', () => {
  const doc = agendaDocument({
    learnerId: 'kid', sections: [/* one ordinary English section */],
    readingToken: 'tok', readingAccessCode: '481902',
    readingFeature: {
      state: 'reading',
      book: { title: 'Hatchet', authors: ['Gary Paulsen'], pageCount: 184 },
      page: 84, percent: 46, alsoReading: [],
    },
    readingSubject: 'english',
  });
  const card = doc.blocks.find((b) => b.action === 'tok');
  expect(card.presentation).toBe('lesson');
  expect(card.label).toBe('Hatchet');
  expect(card.unit).toBe('Gary Paulsen');
  expect(card.icon).toBe('english');
  expect(card.taxonomy).toEqual({
    subject: 'English', course: 'Reading log', unit: 'Gary Paulsen', lesson: 'Hatchet',
  });
  expect(validateDocument(doc).errors).toEqual([]);
});

it('carries a four-string taxonomy even with no book facts', () => {
  // A two-field taxonomy fails validateDocument for the WHOLE agenda
  // (blocks.mjs:284). This is the guard for that.
  const doc = agendaDocument({
    learnerId: 'kid', sections: [/* … */],
    readingToken: 'tok', readingAccessCode: '481902',
    readingFeature: { state: 'empty', book: null, alsoReading: [] },
    readingSubject: 'english',
  });
  const card = doc.blocks.find((b) => b.action === 'tok');
  expect(Object.values(card.taxonomy).every((v) => typeof v === 'string' && v.length)).toBe(true);
  expect(validateDocument(doc).errors).toEqual([]);
});

it('says "All done today" when the only thing on the page is the reading card', () => {
  // `nothingLeft` is read at receipts.mjs:583 from blocks.length. The reading
  // card is unconditional, so a blocks.length test would make "All done today"
  // unreachable forever.
  const doc = agendaDocument({
    learnerId: 'kid',
    sections: [/* one section, served today → a done tally entry, no card */],
    readingToken: 'tok', readingAccessCode: '481902',
    readingFeature: { state: 'empty', book: null, alsoReading: [] },
    readingSubject: 'english',
  });
  const tally = doc.blocks.find((b) => b.type === 'done_summary');
  expect(tally.label).toBe('All done today');
});

it('names the other books it is not headlining', () => {
  // alsoReading: ['Frindle', 'The Hobbit'] → one sentence in the description
});

it('says so when a book is set aside rather than claiming an empty shelf', () => {
  // state: 'set-aside' → description mentions picking it back up
});
```

**Step 2: Run to verify failure**

```bash
npx vitest run backend/src/2_domains/school/documents/receipts.agenda.test.mjs
```

**Step 3: Implement**

Replace `readingLogAction` with a builder that returns `lessonAction(...)`. Its docblock must be rewritten: the old one argues the card is separate *because riding on the English lesson card would make it vanish on served days* — that reasoning still holds and is why the standalone card survives; what changed is only its presentation, plus Task 8's rule that it is not printed twice.

Copy rules by state (keep every sentence a child can read):

| state | label | unit | description | meta |
|---|---|---|---|---|
| `reading` | book title, else `Reading log` | first author, else `Books` | "Page 84 of 184 — nearly there. Save tonight's page, or say you finished it." Drop the page clause when `page` is null; use minutes/days for those modes. | `UPDATE ON THE PANEL` |
| `finished` | book title | author | "You finished it. Add the next one: type the number off the back." | `ADD A BOOK ON THE PANEL` |
| `set-aside` | book title | author | "Set aside. Pick it back up, or start something new." | `ADD A BOOK ON THE PANEL` |
| `empty` | `Start a book` | `Books` | "Type the number off the back of any book to put it on your shelf." | `ADD A BOOK ON THE PANEL` |
| `unreadable` | `Reading log` | `Books` | "Open your shelf on the panel." — no counts, no bars | `OPEN ON THE PANEL` |

`alsoReading` appends `Also reading: A and B.` to the description; skip it when the description is already long.

Progress rows: the book row only when `percent` is a finite number (`usableProgressRows` drops rows without an integer total anyway, `progressBar.mjs:61-64`); the obligation row from the caller's existing obligation data.

`nothingLeft` (`:583`): compute it from the section loop's own output before the reading card is considered. The simplest correct change is to capture `const curriculumBlocks = blocks.length;` right where `nothingLeft` is read today and keep reading THAT, with a comment naming this plan.

**Step 4: Run** — expect PASS, including the pre-existing 55.

**Step 5: Commit**

```bash
git add backend/src/2_domains/school/documents/receipts.mjs backend/src/2_domains/school/documents/receipts.agenda.test.mjs
git commit -m "feat(school): print the reading log as a lesson card"
```

---

### Task 8: One card, never two

On a day the obligation is unmet, the shelf is already `section.next` (`agenda.mjs:298-311`) and already renders through `lessonAction` (`BuildAgenda.mjs:594-601`). The standalone card must not also print.

**Files:**
- Modify: `backend/src/2_domains/school/documents/receipts.mjs` — the reading push site
- Test: `backend/src/2_domains/school/documents/receipts.agenda.test.mjs`, `tests/isolated/application/school/buildAgenda.test.mjs`

**Step 1: Failing test**

```javascript
it('prints ONE reading card when the shelf is already the section card', () => {
  const doc = agendaDocument({
    learnerId: 'kid',
    // an English section whose `next` IS the book-log program entry
    sections: [englishSectionWhoseNextIsTheShelf()],
    tokensBySubject: { english: 'section-tok' },
    accessCodesByToken: { 'section-tok': '111111' },
    readingToken: 'reading-tok', readingAccessCode: '481902',
    readingFeature: { state: 'reading', book: { title: 'Hatchet', authors: ['Gary Paulsen'] }, page: 84, alsoReading: [] },
    readingSubject: 'english',
  });
  const readingCards = doc.blocks.filter(
    (b) => b.type === 'scan_action' && b.taxonomy?.course === 'Reading log',
  );
  expect(readingCards).toHaveLength(1);
});
```

**Step 2: Run** — expect FAIL with 2.

**Step 3: Implement.** In the section loop, record whether any section's `next.program === 'book-log'` rendered a card; skip the standalone push when it did. The section card is the better one — it carries the obligation the standalone one only describes.

**Step 4: Run.** PASS.

**Step 5: Commit**

```bash
git commit -am "fix(school): never print two reading cards on one agenda"
```

---

### Task 9: Thread the feature through BuildAgenda, and cap the code

**Files:**
- Modify: `backend/src/3_applications/school/usecases/BuildAgenda.mjs` — the reading mint (`:517-560`), the `agendaDocument` call (`:657-662`), and the program taxonomy branch (`:594-601`)
- Test: `tests/isolated/application/school/buildAgenda.test.mjs`

**Step 1: Failing tests**

```javascript
it('caps the reading code at 12 uses', () => {
  // Subject codes are spent after 3 (DEFAULT_ACCESS_CODE_MAX_USES). A log is
  // repeatable, so the reading cap is far looser — but it is not absent, or a
  // slip on the counter is worth unlimited opens. See accessCode.mjs:11-22:
  // one code was typed thirteen times in five hours.
  expect(reading.maxUses).toBe(12);
});

it('still dies at the study-day rollover, with the token keeping its week', () => {
  // UNCHANGED from the existing assertion at :744 — tokens.mjs:269-283 argues
  // the two clocks deliberately and says "Do not align them."
  expect(reading.accessCodeExpiresAt).toBe(rollover());
});

it('gives the section card the featured book when the shelf IS the section', () => {
  // taxonomy.unit must be the author, not the literal 'Unit'
});
```

Update the existing `:754` assertion: `card.label` is now the book title, so the handle for "this is the reading card" becomes `card.taxonomy.course === 'Reading log'`. Leave a comment saying why it moved.

**Step 2: Run** — FAIL.

**Step 3: Implement**
- `maxUses: READING_CODE_MAX_USES` (a named constant, `12`) on the reading `mintToken`. Rewrite the "NO `maxUses`, deliberately" comment at `:547` rather than deleting it: frequency was never a proxy for attribution, and a cap this high bounds abuse without bounding honest logging.
- `await launchers.get(BOOK_LOG_PROGRAM_ID)?.featuredBook({ userId: learnerId })` once, guarded so a throw yields `null` and the card falls back to its plain form.
- Pass `readingFeature` and `readingSubject` into `agendaDocument`.
- In the program-taxonomy branch, when `entry.program === 'book-log'`, override `unit` with the author (falling back to `Books`, never the literal `'Unit'`).

**Step 4: Run**

```bash
npx vitest run tests/isolated/application/school/buildAgenda.test.mjs
```
Expected: PASS.

**Step 5: Commit**

```bash
git commit -am "feat(school): featured book on the agenda card, and a use cap on its code"
```

---

### Task 10: The ESC/POS transcript

`DocumentEscPosRenderer.mjs:233-241` prints `Course · / Unit · / Lesson ·` from the **taxonomy** and never reads `block.unit`, `block.rail` or `block.progress`. It is live: `schoolLifecycle.mjs:339-345` runs it to harvest the operator transcript and it is the sole renderer if the canvas one fails to build.

**Files:**
- Test: `backend/src/1_rendering/school/documents/` — add to the nearest existing ESC/POS suite

**Step 1: Write the test** — a reading card renders `Course · Reading log`, `Unit · Gary Paulsen`, `Lesson · Hatchet`.

**Step 2–4:** Run; if it fails, the taxonomy from Task 7 is wrong — fix the taxonomy, not the renderer.

**Step 5: Commit**

```bash
git commit -am "test(school): the reading card reads correctly in the ESC/POS transcript"
```

---

### Task 11: Look at a real page

**Step 1: Render a captured agenda through the new renderer**

```bash
node cli/school/agenda.mjs list | head
node cli/school/agenda.mjs render --from <artifact-id> --out /tmp/reading-card.png
```

**Step 2: Read the PNG** with the Read tool and check: one reading card, the breadcrumb reads `English › Reading log`, the author sits above the title, both bars draw, the footer verb is right, and the card is not absurdly tall. Card height has no cap in the receipt path (`DocumentReceiptRenderer.mjs:472-500`) — if the "also reading" line is what pushes it over, drop that line's cap from two titles to one.

**Step 3: Full suite for the touched areas**

```bash
npx vitest run backend/src/2_domains/school backend/src/3_applications/school tests/isolated/application/school tests/isolated/applications/school
```
Expected: all pass.

**Step 4: Commit any fix, then update the design doc's §12 with the measured height.**

---

## Definition of done

- [ ] One reading card on every agenda, in every state, enrolled or not
- [ ] `validateDocument` clean — a four-string taxonomy on every reading card
- [ ] `All done today` still reachable
- [ ] `status()` makes no repository reads
- [ ] Reading code: `maxUses: 12`, rollover expiry unchanged, token TTL unchanged
- [ ] `Reading log` everywhere; story time no longer claims the name
- [x] A real rendered page looked at with human eyes (2026-09-06: 580x1049, card ~400px, "also reading" costs one line)
