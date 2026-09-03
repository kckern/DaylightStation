# Reading Shelf Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task.

**Goal:** Make the reading shelf reachable from the wall panel, secure its writes with a launch grant, fix the four review blockers in the backend, and build the child-facing UI (shelf → update → add → day picker).

**Architecture:** The backend books domain, adapters, launcher and store already exist (201 tests). This plan first corrects four backend defects found in adversarial review (`docs/_wip/plans/2026-09-02-book-shelf-ui-design.md` review, 2026-09-02): the launcher's `doneToday` semantics, study-day alignment of event timestamps, a signed launch grant for identity, and the store's `itemId`/`entryId` collisions. It then composes everything into the app, adds four HTTP routes, and builds the frontend as a new `program: 'book-log'` branch in `SchoolApp.onPortalLaunch`, reusing the panel's SCSS system but with a purpose-built `NumberPad` (the existing `Keypad` auto-submits at a fixed length and empties on submit, which breaks both page entry and ISBN retry).

**Tech Stack:** Node ESM (`.mjs`), vitest, Express, js-yaml, React 18 (`.jsx`), SCSS, Playwright. Path aliases: `#domains/*`, `#apps/*`, `#adapters/*`, `#system/*`, `#api/*`.

**Design docs to read first:**
- `docs/_wip/plans/2026-09-02-book-shelf-ui-design.md` — the UX (§3–5 are the screens; treat mockups as spec, except where a task below corrects them)
- `docs/_wip/plans/2026-09-02-books-domain-prd.md` §5.3, §5.3b, §6b — the domain contracts

**House rules that apply to every task:**
- TDD: failing test first, watch it fail, minimal code, watch it pass. Run vitest directly: `npx vitest run <file>` — never through `npm run test:isolated --only=domain` (it misroutes vitest files to Jest).
- Never `console.*` for diagnostics; inject `logger` and emit dotted events (`school.book-shelf.*`, `books.*`).
- Frontend logging via a facade (see `frontend/src/modules/Feed/Scroll/feedLog.js` pattern; School has `frontend/src/modules/School/schoolLog.js`).
- Never start a second backend (`node backend/index.js`) — it is a live household controller.
- Commit after each task on the feature branch. Message style: `feat(books): …`, `fix(school): …`. End every commit message with:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01CCgjP35PPBGYjLnxiMPNdM
  ```

---

## Task 0: Worktree + commit the existing backend work

The books backend is uncommitted on `main`. Isolate it before anything else.

**Steps:**

```bash
cd <repo root>
git stash push -u -- backend/src/1_adapters/books backend/src/1_adapters/persistence/yaml/YamlBookLogStore.mjs backend/src/1_adapters/persistence/yaml/YamlBookLogStore.test.mjs backend/src/2_domains/books backend/src/2_domains/school/bookLog.mjs backend/src/2_domains/school/bookLog.test.mjs backend/src/2_domains/school/bookShelf.mjs backend/src/2_domains/school/bookShelf.test.mjs backend/src/3_applications/books backend/src/3_applications/school/BookLogProgramLauncher.mjs backend/src/3_applications/school/BookLogProgramLauncher.test.mjs backend/src/3_applications/school/ports/IBookLogStore.mjs backend/src/3_applications/school/SchoolProgramEnrollmentValidators.mjs docs/_wip/plans/2026-09-02-book-shelf-ui-design.md docs/_wip/plans/2026-09-02-books-domain-prd.md docs/_wip/plans/2026-09-02-book-shelf-implementation.md
git worktree add .claude/worktrees/books-shelf -b books/shelf main
cd .claude/worktrees/books-shelf
git stash pop
ln -s ../../../node_modules node_modules 2>/dev/null || true
ln -s ../../../frontend/node_modules frontend/node_modules 2>/dev/null || true
npx vitest run backend/src/2_domains/books backend/src/1_adapters/books backend/src/3_applications/books backend/src/2_domains/school/bookLog.test.mjs backend/src/2_domains/school/bookShelf.test.mjs backend/src/3_applications/school/BookLogProgramLauncher.test.mjs backend/src/1_adapters/persistence/yaml/YamlBookLogStore.test.mjs
```
Expected: `Tests  201 passed`.

```bash
git add -A backend docs/_wip/plans/2026-09-02-book*.md
git commit -m "feat(books): books domain, adapters, resolve chain, school book-log program

ISBN identity + canonical BookRecord + measured per-field merge policy;
OpenLibrary and Google Books adapters behind IBookMetadataGateway;
ResolveBook with four distinguishable outcomes; book-log enrollment
grammar registered in School; shelf projections; launcher; YAML store.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CCgjP35PPBGYjLnxiMPNdM"
```

Do NOT include `docs/_wip/bugs/2026-09-02-piano-kiosk-*` or `docs/_wip/plans/2026-09-02-piano-kiosk-*` — unrelated parallel work. Leave them in the main checkout.

All later tasks run inside `.claude/worktrees/books-shelf`.

---

## Task 1: Launcher — `doneToday: null` without an obligation (review B1)

**Why:** `agenda.mjs:259` marks a subject served when any status has `doneToday === true`. A no-obligation shelf reported `true`, which made the reading code answer "All done" and never mount the shelf, and suppressed every other English unit. `null` is neither served nor owed (agenda checks strictly `=== true` at lines 259 and 325).

**Files:**
- Modify: `backend/src/3_applications/school/BookLogProgramLauncher.mjs`
- Test: `backend/src/3_applications/school/BookLogProgramLauncher.test.mjs`

**Step 1: Change the failing expectation**

In the test, find `it('is done today and never terminal'` under `with no obligation, nothing is ever owed` and replace it with:

```js
    it('is neither done nor owed — null keeps the subject unserved AND unnagged', async () => {
      // agenda.mjs:259 `programDone = statuses.some(s => s.doneToday === true)`
      // A `true` here marked English served for the day and made the reading
      // code answer "All done" instead of mounting the shelf.
      expect(await launcher(enrolled(), [item()]).status('kid'))
        .toMatchObject({ enrolled: true, error: false, doneToday: null, terminal: false });
    });
```

**Step 2: Run to verify it fails**

```bash
npx vitest run backend/src/3_applications/school/BookLogProgramLauncher.test.mjs
```
Expected: 1 failed — `expected true to be null`.

**Step 3: Implement**

In `BookLogProgramLauncher.mjs`, in `status()`, replace `doneToday: measured.met,` with:

```js
      // `null`, not `true`, when nothing is owed. The agenda treats `true` as
      // "subject served" (agenda.mjs:259), which closed the shelf to a child
      // with no target and hid every other English unit behind it.
      doneToday: obligation ? measured.met : null,
```

**Step 4: Run to verify it passes**

```bash
npx vitest run backend/src/3_applications/school/BookLogProgramLauncher.test.mjs
```
Expected: 15 passed.

**Step 5: Commit**

```bash
git add backend/src/3_applications/school/BookLogProgramLauncher.mjs backend/src/3_applications/school/BookLogProgramLauncher.test.mjs
git commit -m "fix(school): book-log without an obligation reports doneToday null, not true

A true marked the whole subject served (agenda.mjs:259), so the reading
code answered 'All done' and never mounted the shelf.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CCgjP35PPBGYjLnxiMPNdM"
```

---

## Task 2: Study-day alignment for event timestamps (review B3)

**Why:** `bookShelf.mjs` derives a day with `String(at).slice(0,10)` — a UTC slice — but the launcher's window is a 4am-Pacific study day. A page logged at 9pm PT counted toward tomorrow. Inject a `dayOf` function; the launcher passes one built on `studyDayForInstant`.

**Files:**
- Modify: `backend/src/2_domains/school/bookShelf.mjs`
- Modify: `backend/src/3_applications/school/BookLogProgramLauncher.mjs`
- Test: `backend/src/2_domains/school/bookShelf.test.mjs`
- Test: `backend/src/3_applications/school/BookLogProgramLauncher.test.mjs`

**Step 1: Failing domain test**

Append inside `describe('measureObligation'` in `bookShelf.test.mjs`:

```js
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
```

**Step 2: Run to verify it fails**

```bash
npx vitest run backend/src/2_domains/school/bookShelf.test.mjs
```
Expected: 1 failed — `expected 0 to be 20`.

**Step 3: Implement in `bookShelf.mjs`**

Replace the module-level `dayOf` and `inWindow`:

```js
/** Default day key: the ISO date of the instant. Callers with a study-day rule inject their own. */
const isoDay = (at) => String(at ?? '').slice(0, 10);

const inWindow = (at, window, dayOf) => {
  if (!window) return true;
  const day = dayOf(at);
  if (!day) return false;
  return (!window.from || day >= window.from) && (!window.to || day <= window.to);
};
```

Change the signature and thread `dayOf` through:

```js
export function measureObligation(obligation, items = [], window = null, { dayOf = isoDay } = {}) {
```
- In `measureObligation`, call `countFor(obligation.metric, usable, window, dayOf)`.
- Change `function countFor(metric, items, window, dayOf)` and replace every `inWindow(x, window)` with `inWindow(x, window, dayOf)` and every `dayOf(event.at)` (checkins, pages `before` filter) to use the parameter. In the `pages` branch, `dayOf(event.at) < window.from` uses the parameter too.
- In `projectShelfItem`, `daysRead` should also accept it: add a second parameter `{ dayOf = isoDay } = {}` and use it in the `new Set(...)`.

**Step 4: Run to verify it passes**

```bash
npx vitest run backend/src/2_domains/school/bookShelf.test.mjs
```
Expected: 21 passed.

**Step 5: Failing launcher test**

Append to `BookLogProgramLauncher.test.mjs` (top-level `describe`):

```js
  it('counts a 9pm Pacific read toward TODAY, not tomorrow', async () => {
    // Clock is 2026-08-09T18:00Z = 11am PDT Sunday. An event at 2026-08-10T04:30Z
    // is 9:30pm PDT Sunday — still study-day 2026-08-09 under the 4am rule.
    const status = await launcher(enrolled({ metric: 'pages', quantity: 10, per: 'day', scope: null }), [
      item({ events: [{ kind: 'progress', at: '2026-08-10T04:30:00.000Z', page: 40 }] }),
    ], { clock: () => new Date('2026-08-10T05:00:00Z') }).status('kid');
    expect(status.obligationProgress.actual).toBe(40);
    expect(status.doneToday).toBe(true);
  });
```

**Step 6: Run to verify it fails**

```bash
npx vitest run backend/src/3_applications/school/BookLogProgramLauncher.test.mjs
```
Expected: 1 failed — `expected 0 to be 40`.

**Step 7: Implement in the launcher**

In `status()`, before `measureObligation`:

```js
    // The ONE place the household's 4am boundary is applied to an event.
    const dayOf = (iso) => {
      const ms = Date.parse(iso);
      return Number.isFinite(ms) ? studyDayForInstant(ms, { timezone: this.#timezone }) : '';
    };
    const measured = measureObligation(obligation, items, window, { dayOf });
    const projections = items.map((entry) => projectShelfItem(entry, { dayOf }));
```
(Remove the earlier `measured`/`projections` lines.)

**Step 8: Run to verify it passes**

```bash
npx vitest run backend/src/3_applications/school/BookLogProgramLauncher.test.mjs backend/src/2_domains/school/bookShelf.test.mjs
```
Expected: 37 passed.

**Step 9: Commit**

```bash
git add backend/src/2_domains/school/bookShelf.mjs backend/src/2_domains/school/bookShelf.test.mjs backend/src/3_applications/school/BookLogProgramLauncher.mjs backend/src/3_applications/school/BookLogProgramLauncher.test.mjs
git commit -m "fix(school): shelf metrics use the household study day, not a UTC slice

A 9pm Pacific read was filed under tomorrow. dayOf is injected; the
launcher supplies studyDayForInstant with the household timezone.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CCgjP35PPBGYjLnxiMPNdM"
```

---

## Task 3: Store — `itemId` from the started `entryId`; a mode-switch method (review M1, M2, M5)

**Why:** `itemId` was `${learnerId}:${bookId}:${openedAt}`; two adds with the same `openedAt` collided. `entryId` was shared between `openItem`'s `started` event and the first `appendEvent`, which deduped the latter away. There was no way to change `progressMode`.

**Files:**
- Modify: `backend/src/3_applications/school/ports/IBookLogStore.mjs`
- Modify: `backend/src/1_adapters/persistence/yaml/YamlBookLogStore.mjs`
- Test: `backend/src/1_adapters/persistence/yaml/YamlBookLogStore.test.mjs`

**Step 1: Failing tests** — append inside `describe('YamlBookLogStore'`:

```js
  it('gives two opens of the same book on the same day different itemIds', async () => {
    const subject = store();
    const a = await subject.openItem(opened({ entryId: 'e1', openedAt: '2026-08-25T10:00:00.000Z' }));
    await subject.appendEvent({ itemId: a.itemId, kind: 'finished', at: '2026-08-25T11:00:00.000Z', entryId: 'f1' });
    const b = await subject.openItem(opened({ entryId: 'e2', openedAt: '2026-08-25T10:00:00.000Z' }));
    expect(b.itemId).not.toBe(a.itemId);
    const items = await subject.listForLearner('kid');
    expect(items.map((i) => i.events.map((e) => e.kind))).toEqual([['started', 'finished'], ['started']]);
  });

  it('itemId is derived from the started entryId, so it never depends on openedAt', async () => {
    const item = await store().openItem(opened({ entryId: 'e-abc' }));
    expect(item.itemId).toBe('kid:9780064400558:e-abc');
  });

  it('switches progressMode without touching a single event', async () => {
    const subject = store();
    const item = await subject.openItem(opened());
    await subject.appendEvent({ itemId: item.itemId, kind: 'progress', at: '2026-08-03T10:00:00.000Z', page: 40, entryId: 'p1' });
    const updated = await subject.setProgressMode({ itemId: item.itemId, progressMode: 'check' });
    expect(updated.progressMode).toBe('check');
    const [stored] = await subject.listForLearner('kid');
    expect(stored.progressMode).toBe('check');
    expect(stored.events.map((e) => e.page)).toEqual([undefined, 40]);
  });

  it('refuses an unknown progressMode', async () => {
    const subject = store();
    const item = await subject.openItem(opened());
    await expect(subject.setProgressMode({ itemId: item.itemId, progressMode: 'chapters' })).rejects.toThrow(/progressMode/);
  });
```

**Step 2: Run to verify they fail**

```bash
npx vitest run backend/src/1_adapters/persistence/yaml/YamlBookLogStore.test.mjs
```
Expected: 4 failed (first two on itemId shape; last two on missing `setProgressMode`).

**Step 3: Implement**

In `IBookLogStore.mjs` add after `appendEvent`:

```js
  /**
   * Change how progress is expressed for one item. Never rewrites events —
   * a book logged by page and then switched to `check` keeps its pages (S6c).
   * @param {{itemId: string, progressMode: 'page'|'minutes'|'check'}} change
   * @returns {Promise<object>} the updated shelf item
   */
  async setProgressMode() { throw new Error('IBookLogStore.setProgressMode not implemented'); }
```
Update the `openItem` doc: "implementations key items by the `started` event's `entryId`, so `itemId` never depends on `openedAt`."

In `YamlBookLogStore.mjs`:
- `openItem`: require `entryId`: after the `bookId` check add
  ```js
  if (typeof entryId !== 'string' || !entryId.trim()) throw new Error('YamlBookLogStore: entryId is required to open an item');
  ```
  and change `itemId: \`${learnerId}:${bookId}:${at}\`` to `itemId: \`${learnerId}:${bookId}:${entryId}\``. Update the comment: the id is the learner + book + the `started` entryId, unique per open, independent of `openedAt`.
- Add:
  ```js
  const PROGRESS_MODES = new Set(['page', 'minutes', 'check']);

  async setProgressMode({ itemId, progressMode } = {}) {
    if (typeof itemId !== 'string' || !itemId) throw new Error('YamlBookLogStore: itemId is required');
    if (!PROGRESS_MODES.has(progressMode)) throw new Error(`YamlBookLogStore: unknown progressMode: ${progressMode}`);
    const learnerId = this.#assertLearner(learnerFromItemId(itemId));
    return this.#enqueue(() => {
      const loaded = this.#load(learnerId);
      const items = loaded.items.map((entry) => ({ ...entry, events: [...(entry.events ?? [])] }));
      const target = items.find((entry) => entry.itemId === itemId);
      if (!target) throw new Error(`YamlBookLogStore: no shelf item for itemId ${itemId}`);
      target.progressMode = progressMode;
      this.#persist(learnerId, loaded, items);
      this.#logger.info?.('school.book-log.mode-switched', { learnerId, itemId, progressMode });
      return target;
    });
  }
  ```

**Step 4: Run to verify they pass**

```bash
npx vitest run backend/src/1_adapters/persistence/yaml/YamlBookLogStore.test.mjs
```
Expected: 17 passed. (If an older test asserted the `bookId:openedAt` shape, update it to the new shape.)

**Step 5: Commit**

```bash
git add backend/src/3_applications/school/ports/IBookLogStore.mjs backend/src/1_adapters/persistence/yaml/YamlBookLogStore.mjs backend/src/1_adapters/persistence/yaml/YamlBookLogStore.test.mjs
git commit -m "fix(school): shelf itemId keyed on the started entryId; add setProgressMode

Two adds on the same day no longer collide, openedAt can stay an honest
instant, and a book can change mode without rewriting history.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CCgjP35PPBGYjLnxiMPNdM"
```

---

## Task 4: Use cases — `OpenBookShelfItem` and `RecordBookProgress`

**Why:** Validation (kinds, mode/field match, `at` as a real instant, two entryIds) lives once, off the router.

**Files:**
- Create: `backend/src/3_applications/school/usecases/OpenBookShelfItem.mjs`
- Create: `backend/src/3_applications/school/usecases/RecordBookProgress.mjs`
- Test: `backend/src/3_applications/school/usecases/OpenBookShelfItem.test.mjs`
- Test: `backend/src/3_applications/school/usecases/RecordBookProgress.test.mjs`

**Step 1: Failing tests**

`OpenBookShelfItem.test.mjs`:
```js
import { describe, expect, it } from 'vitest';
import { OpenBookShelfItem } from './OpenBookShelfItem.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const CLOCK = () => new Date('2026-09-02T20:00:00.000Z');

function makeStore() {
  return {
    opened: [], events: [],
    async openItem(item) { this.opened.push(item); return { itemId: `kid:${item.bookId}:${item.entryId}`, ...item, events: [] }; },
    async appendEvent(event) { this.events.push(event); return event; },
    async listForLearner() { return []; },
  };
}
const resolveBook = { async execute(id) {
  return id === '9780064400558'
    ? { status: 'ok', book: { isbn13: '9780064400558', title: "Charlotte's Web", pageCount: 184 } }
    : { status: 'not-found' };
} };
const useCase = (store = makeStore()) => [new OpenBookShelfItem({ bookLog: store, resolveBook, clock: CLOCK, logger: silent }), store];

describe('OpenBookShelfItem', () => {
  it('opens a page-mode item for a book with a page count, as "starting"', async () => {
    const [uc, store] = useCase();
    const out = await uc.execute({ learnerId: 'kid', bookId: '9780064400558', entryId: 'e1', where: 'starting' });
    expect(out.item.progressMode).toBe('page');
    expect(store.opened[0]).toMatchObject({ learnerId: 'kid', pageCount: 184, entryId: 'e1', openedAt: '2026-09-02T20:00:00.000Z' });
    expect(store.events).toEqual([]);
  });

  it('partway: appends a progress event with its OWN entryId', async () => {
    const [uc, store] = useCase();
    await uc.execute({ learnerId: 'kid', bookId: '9780064400558', entryId: 'e1', where: 'partway', page: 84, progressEntryId: 'p1' });
    expect(store.events[0]).toMatchObject({ kind: 'progress', page: 84, entryId: 'p1', at: '2026-09-02T20:00:00.000Z' });
  });

  it('finished: appends a finished event stamped on the chosen study day, openedAt untouched', async () => {
    const [uc, store] = useCase();
    await uc.execute({ learnerId: 'kid', bookId: '9780064400558', entryId: 'e1', where: 'finished', finishedOn: '2026-08-25', progressEntryId: 'f1' });
    expect(store.events[0]).toMatchObject({ kind: 'finished', entryId: 'f1' });
    // Noon on the chosen day, in UTC — unambiguous under any household timezone and 4am rule.
    expect(store.events[0].at).toBe('2026-08-25T12:00:00.000Z');
    expect(store.opened[0].openedAt).toBe('2026-09-02T20:00:00.000Z');
  });

  it('refuses a finish in the future', async () => {
    const [uc] = useCase();
    await expect(uc.execute({ learnerId: 'kid', bookId: '9780064400558', entryId: 'e1', where: 'finished', finishedOn: '2027-01-01', progressEntryId: 'f1' }))
      .rejects.toThrow(/future/);
  });

  it('refuses partway without a page, and a second entryId shared with the first', async () => {
    const [uc] = useCase();
    await expect(uc.execute({ learnerId: 'kid', bookId: '9780064400558', entryId: 'e1', where: 'partway', progressEntryId: 'p1' })).rejects.toThrow(/page/);
    await expect(uc.execute({ learnerId: 'kid', bookId: '9780064400558', entryId: 'e1', where: 'partway', page: 3, progressEntryId: 'e1' })).rejects.toThrow(/entryId/);
  });

  it('refuses a book the resolver does not know, before touching the store', async () => {
    const [uc, store] = useCase();
    await expect(uc.execute({ learnerId: 'kid', bookId: '9780000000000', entryId: 'e1', where: 'starting' })).rejects.toThrow(/not-found/);
    expect(store.opened).toEqual([]);
  });

  it('infers check mode when the book has no page count', async () => {
    const resolver = { async execute() { return { status: 'ok', book: { isbn13: '9780027746723', title: 'x', pageCount: null } }; } };
    const store = makeStore();
    const uc = new OpenBookShelfItem({ bookLog: store, resolveBook: resolver, clock: CLOCK, logger: silent });
    const out = await uc.execute({ learnerId: 'kid', bookId: '9780027746723', entryId: 'e1', where: 'starting' });
    expect(out.item.progressMode).toBe('check');
  });
});
```

`RecordBookProgress.test.mjs`:
```js
import { describe, expect, it } from 'vitest';
import { RecordBookProgress } from './RecordBookProgress.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const CLOCK = () => new Date('2026-09-02T20:00:00.000Z');
const shelf = (mode = 'page') => [{ itemId: 'kid:b:e1', bookId: 'b', progressMode: mode, pageCount: 184, events: [{ kind: 'started', at: '2026-09-01T10:00:00.000Z' }] }];

function makeStore(items = shelf()) {
  return {
    events: [], modes: [],
    async listForLearner() { return items; },
    async appendEvent(event) { this.events.push(event); return event; },
    async setProgressMode(change) { this.modes.push(change); return { ...items[0], progressMode: change.progressMode }; },
  };
}
const useCase = (store = makeStore()) => [new RecordBookProgress({ bookLog: store, clock: CLOCK, logger: silent }), store];

describe('RecordBookProgress', () => {
  it('records a page for a page-mode book, stamped now', async () => {
    const [uc, store] = useCase();
    await uc.execute({ learnerId: 'kid', itemId: 'kid:b:e1', kind: 'progress', page: 84, entryId: 'p1' });
    expect(store.events[0]).toMatchObject({ itemId: 'kid:b:e1', kind: 'progress', page: 84, entryId: 'p1', at: '2026-09-02T20:00:00.000Z' });
  });

  it('records minutes for a minutes-mode book', async () => {
    const [uc, store] = useCase(makeStore(shelf('minutes')));
    await uc.execute({ learnerId: 'kid', itemId: 'kid:b:e1', kind: 'progress', minutes: 25, entryId: 'm1' });
    expect(store.events[0]).toMatchObject({ minutes: 25 });
  });

  it('records a bare check-in for a check-mode book', async () => {
    const [uc, store] = useCase(makeStore(shelf('check')));
    await uc.execute({ learnerId: 'kid', itemId: 'kid:b:e1', kind: 'progress', entryId: 'c1' });
    expect(store.events[0]).toMatchObject({ kind: 'progress', entryId: 'c1' });
    expect(store.events[0].page).toBeUndefined();
  });

  it('refuses a page on a check-mode book and minutes on a page-mode book', async () => {
    const [uc] = useCase(makeStore(shelf('check')));
    await expect(uc.execute({ learnerId: 'kid', itemId: 'kid:b:e1', kind: 'progress', page: 3, entryId: 'x' })).rejects.toThrow(/mode/);
    const [uc2] = useCase();
    await expect(uc2.execute({ learnerId: 'kid', itemId: 'kid:b:e1', kind: 'progress', minutes: 3, entryId: 'x' })).rejects.toThrow(/mode/);
  });

  it('accepts a page beyond the known total — editions differ', async () => {
    const [uc, store] = useCase();
    await uc.execute({ learnerId: 'kid', itemId: 'kid:b:e1', kind: 'progress', page: 212, entryId: 'p1' });
    expect(store.events[0].page).toBe(212);
  });

  it('finished on a chosen day lands at noon UTC of that day', async () => {
    const [uc, store] = useCase();
    await uc.execute({ learnerId: 'kid', itemId: 'kid:b:e1', kind: 'finished', finishedOn: '2026-08-30', entryId: 'f1' });
    expect(store.events[0].at).toBe('2026-08-30T12:00:00.000Z');
  });

  it('refuses an item that is not on this learner\'s shelf', async () => {
    const [uc] = useCase();
    await expect(uc.execute({ learnerId: 'kid', itemId: 'kid:other:e9', kind: 'progress', page: 1, entryId: 'p' })).rejects.toThrow(/shelf/);
  });

  it('refuses an unknown kind and a missing entryId', async () => {
    const [uc] = useCase();
    await expect(uc.execute({ learnerId: 'kid', itemId: 'kid:b:e1', kind: 'paused', entryId: 'p' })).rejects.toThrow(/kind/);
    await expect(uc.execute({ learnerId: 'kid', itemId: 'kid:b:e1', kind: 'progress', page: 1 })).rejects.toThrow(/entryId/);
  });

  it('switches mode through the store', async () => {
    const [uc, store] = useCase();
    const out = await uc.setMode({ learnerId: 'kid', itemId: 'kid:b:e1', progressMode: 'check' });
    expect(store.modes[0]).toEqual({ itemId: 'kid:b:e1', progressMode: 'check' });
    expect(out.progressMode).toBe('check');
  });
});
```

**Step 2: Run to verify they fail**

```bash
npx vitest run backend/src/3_applications/school/usecases/OpenBookShelfItem.test.mjs backend/src/3_applications/school/usecases/RecordBookProgress.test.mjs
```
Expected: both suites fail on `Cannot find module`.

**Step 3: Implement**

`OpenBookShelfItem.mjs`:
```js
import { ValidationError } from '#domains/core/errors/index.mjs';
import { inferProgressMode } from '#domains/school/bookShelf.mjs';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const WHERE = new Set(['starting', 'partway', 'finished']);

/** Noon UTC of a study-day key: unambiguous under any household timezone and the 4am rule. */
const noonOf = (day) => `${day}T12:00:00.000Z`;

/**
 * OpenBookShelfItem — a confirmed book joins a learner's shelf.
 *
 * The three doors of the add flow (design §5 step 3) each need exactly one
 * thing: `starting` needs nothing, `partway` needs a page, `finished` needs a
 * day. Two entryIds travel with the request — one for the `started` event the
 * store writes on open, one for the optional first event — because the store
 * dedupes on entryId per item and a shared id drops the second event (review M1).
 *
 * `openedAt` is always NOW. A backdated finish is expressed by the `finished`
 * event's own timestamp, never by pretending the book was opened in the past.
 */
export class OpenBookShelfItem {
  #bookLog; #resolveBook; #clock; #logger;
  constructor({ bookLog, resolveBook, clock = () => new Date(), logger = console } = {}) {
    if (!bookLog) throw new Error('OpenBookShelfItem requires a bookLog');
    if (!resolveBook) throw new Error('OpenBookShelfItem requires resolveBook');
    this.#bookLog = bookLog; this.#resolveBook = resolveBook; this.#clock = clock; this.#logger = logger;
  }

  async execute({ learnerId, bookId, entryId, where = 'starting', page = null, finishedOn = null, progressEntryId = null } = {}) {
    if (typeof learnerId !== 'string' || !learnerId) throw new ValidationError('learnerId is required');
    if (typeof bookId !== 'string' || !bookId) throw new ValidationError('bookId is required');
    if (typeof entryId !== 'string' || !entryId) throw new ValidationError('entryId is required');
    if (!WHERE.has(where)) throw new ValidationError(`where must be starting|partway|finished, got: ${where}`);

    if (where !== 'starting') {
      if (typeof progressEntryId !== 'string' || !progressEntryId) throw new ValidationError('progressEntryId is required for partway/finished');
      if (progressEntryId === entryId) throw new ValidationError('progressEntryId must differ from entryId');
    }
    if (where === 'partway' && !(Number.isInteger(page) && page > 0)) throw new ValidationError('partway requires a positive page');

    const today = this.#clock().toISOString().slice(0, 10);
    if (where === 'finished') {
      if (!DAY.test(finishedOn ?? '')) throw new ValidationError('finished requires finishedOn as YYYY-MM-DD');
      if (finishedOn > today) throw new ValidationError('finishedOn cannot be in the future');
    }

    const resolved = await this.#resolveBook.execute(bookId);
    if (resolved.status !== 'ok') throw new ValidationError(`book ${bookId} did not resolve: ${resolved.status}`);
    const { book } = resolved;

    const openedAt = this.#clock().toISOString();
    const item = await this.#bookLog.openItem({
      learnerId, bookId: book.isbn13 ?? bookId, entryId, openedAt,
      progressMode: inferProgressMode(book), pageCount: book.pageCount ?? null,
    });

    let event = null;
    if (where === 'partway') {
      event = await this.#bookLog.appendEvent({ itemId: item.itemId, kind: 'progress', at: openedAt, page, entryId: progressEntryId });
    } else if (where === 'finished') {
      event = await this.#bookLog.appendEvent({ itemId: item.itemId, kind: 'finished', at: noonOf(finishedOn), entryId: progressEntryId });
    }

    this.#logger.info?.('school.book-shelf.item-opened', { learnerId, bookId: item.bookId, where, progressMode: item.progressMode });
    return { item, event, book };
  }
}
export default OpenBookShelfItem;
```

`RecordBookProgress.mjs`:
```js
import { ValidationError } from '#domains/core/errors/index.mjs';
import { PROGRESS_MODES } from '#domains/school/bookShelf.mjs';

const KINDS = new Set(['progress', 'finished', 'set-aside']);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const noonOf = (day) => `${day}T12:00:00.000Z`;

/**
 * RecordBookProgress — one event on a book already on the shelf.
 *
 * The field a child may supply is decided by the item's `progressMode`:
 * `page` takes a page, `minutes` takes minutes, `check` takes nothing. A
 * mismatch is refused rather than dropped, because a page on a check-mode book
 * would count toward nothing and nobody would know (PRD A4).
 */
export class RecordBookProgress {
  #bookLog; #clock; #logger;
  constructor({ bookLog, clock = () => new Date(), logger = console } = {}) {
    if (!bookLog) throw new Error('RecordBookProgress requires a bookLog');
    this.#bookLog = bookLog; this.#clock = clock; this.#logger = logger;
  }

  async #owned(learnerId, itemId) {
    if (typeof learnerId !== 'string' || !learnerId) throw new ValidationError('learnerId is required');
    if (typeof itemId !== 'string' || !itemId) throw new ValidationError('itemId is required');
    const items = await this.#bookLog.listForLearner(learnerId);
    const item = items.find((entry) => entry.itemId === itemId);
    if (!item) throw new ValidationError(`item ${itemId} is not on this learner's shelf`);
    return item;
  }

  async execute({ learnerId, itemId, kind, page = null, minutes = null, finishedOn = null, note = null, rating = null, entryId } = {}) {
    if (!KINDS.has(kind)) throw new ValidationError(`kind must be progress|finished|set-aside, got: ${kind}`);
    if (typeof entryId !== 'string' || !entryId) throw new ValidationError('entryId is required');
    const item = await this.#owned(learnerId, itemId);

    if (page !== null && item.progressMode !== 'page') throw new ValidationError(`page is not accepted in ${item.progressMode} mode`);
    if (minutes !== null && item.progressMode !== 'minutes') throw new ValidationError(`minutes is not accepted in ${item.progressMode} mode`);
    if (page !== null && !(Number.isInteger(page) && page > 0)) throw new ValidationError('page must be a positive integer');
    if (minutes !== null && !(Number.isInteger(minutes) && minutes > 0)) throw new ValidationError('minutes must be a positive integer');

    let at = this.#clock().toISOString();
    if (kind === 'finished' && finishedOn !== null) {
      if (!DAY.test(finishedOn)) throw new ValidationError('finishedOn must be YYYY-MM-DD');
      if (finishedOn > at.slice(0, 10)) throw new ValidationError('finishedOn cannot be in the future');
      at = noonOf(finishedOn);
    }

    const event = await this.#bookLog.appendEvent({ itemId, kind, at, page, minutes, note, rating, entryId });
    this.#logger.info?.('school.book-shelf.progress', { learnerId, itemId, kind, mode: item.progressMode });
    return { item, event };
  }

  async setMode({ learnerId, itemId, progressMode } = {}) {
    if (!PROGRESS_MODES.includes(progressMode)) throw new ValidationError(`progressMode must be one of ${PROGRESS_MODES.join('|')}`);
    await this.#owned(learnerId, itemId);
    const item = await this.#bookLog.setProgressMode({ itemId, progressMode });
    this.#logger.info?.('school.book-shelf.mode-switched', { learnerId, itemId, progressMode });
    return item;
  }
}
export default RecordBookProgress;
```

**Step 4: Run to verify they pass**

```bash
npx vitest run backend/src/3_applications/school/usecases/OpenBookShelfItem.test.mjs backend/src/3_applications/school/usecases/RecordBookProgress.test.mjs
```
Expected: 16 passed.

**Step 5: Commit**

```bash
git add backend/src/3_applications/school/usecases/OpenBookShelfItem.mjs backend/src/3_applications/school/usecases/OpenBookShelfItem.test.mjs backend/src/3_applications/school/usecases/RecordBookProgress.mjs backend/src/3_applications/school/usecases/RecordBookProgress.test.mjs
git commit -m "feat(school): OpenBookShelfItem and RecordBookProgress use cases

Validation lives once: three add doors, mode/field match, finishedOn as a
study day stamped at noon UTC, two entryIds so the first event survives.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CCgjP35PPBGYjLnxiMPNdM"
```

---

## Task 4b (DONE — `708962cda`): a backdated finish projects as `finished`

`projectShelfItem` derived status from the last event by time; the "already finished it"
door stamps the finish on a past day while the open is now, so it read as `reading` with
`percent: 100`. Any `finished` event now decides status; `set-aside` stays last-event-based.

## Task 4c (DONE — `7920174e7`): Review hygiene across the use cases, the domain, and the store

**Why:** The Task 3/4 reviews approved with these carried items. They cut across three
settled files, so they land as one task.

**Files:**
- Modify: `backend/src/2_domains/school/bookShelf.mjs`, `bookShelf.test.mjs`
- Modify: `backend/src/3_applications/school/usecases/OpenBookShelfItem.mjs`, `RecordBookProgress.mjs` + their tests
- Modify: `backend/src/1_adapters/persistence/yaml/YamlBookLogStore.mjs`, `YamlBookLogStore.test.mjs`

**Steps (TDD each):**
1. `bookShelf.mjs`: export `isDayKey(value)` (matches `YYYY-MM-DD` **and** round-trips through `Date.parse(\`${value}T12:00:00.000Z\`)`, so `2026-02-31` is refused) and `noonOf(day)` (`\`${day}T12:00:00.000Z\``). In `projectShelfItem`, `daysRead` drops falsy keys (`.map(...).filter(Boolean)`). Tests: `isDayKey('2026-02-31') === false`, `isDayKey('2026-09-02') === true`, `noonOf` shape, and a corrupt-`at` event adds no phantom day.
2. Both use cases import `isDayKey`/`noonOf` from `#domains/school/bookShelf.mjs` and delete their local `DAY`/`noonOf`. `OpenBookShelfItem` reads the clock **once** (`const now = ...; const today = now.slice(0,10)`) and uses `now` for `openedAt`. Test: a `finishedOn` of `2026-02-31` is refused with a message mentioning "day".
3. Refuse-not-drop: `RecordBookProgress.execute` throws `ValidationError('finishedOn only applies to a finished event')` when `finishedOn !== null && kind !== 'finished'`; `OpenBookShelfItem` throws when `page !== null && where !== 'partway'` or `finishedOn !== null && where !== 'finished'`. `rating`, when present, must be an integer 1–5. Tests for each.
4. Error-class assertions: in each use-case test file add one `await expect(...).rejects.toBeInstanceOf(ValidationError)` (import it from `#domains/core/errors/index.mjs`) on an existing refusal case.
5. Store: in `openItem`, when the `entryId` dedupe finds an existing item whose `bookId !== bookId`, **throw** `YamlBookLogStore: entryId <id> already opened a different book` instead of returning it. Also drop the now-dead `entryId &&` guard and `entryId ?? null` (entryId is required). Test: reusing an entryId for a second book rejects; the same-book retry still returns the existing item.
6. Run: `npx vitest run backend/src/2_domains/school/bookShelf.test.mjs backend/src/3_applications/school/usecases backend/src/1_adapters/persistence/yaml/YamlBookLogStore.test.mjs backend/src/3_applications/school/BookLogProgramLauncher.test.mjs` — all green.
7. Commit: `fix(school): shelf hygiene — day-key validation, refuse-not-drop, error-class tests, dedupe guard`.

## Task 5 (DONE — `8f2096bda`): Launch grant — `issueLaunchTarget` on the launcher (review B4)

**Why:** `/act` calls `toLock()` before the runner mounts, so there is no session for the routes to read. The house pattern is a signed grant: see `RubiksCubeProgramLauncher.issueLaunchTarget` and `HmacSchoolCubeGrantIssuer`. `RunSelfServiceAction.mjs:652-668` already calls `issueLaunchTarget` when present and spreads its result into the mount `effect`.

**Files:**
- Read first: `backend/src/1_adapters/school/actions/HmacSchoolCubeGrantIssuer.mjs` (copy its shape; do not couple to cube constants)
- Create: `backend/src/1_adapters/school/actions/HmacSchoolBookGrantIssuer.mjs`
- Modify: `backend/src/3_applications/school/BookLogProgramLauncher.mjs`
- Test: `backend/src/1_adapters/school/actions/HmacSchoolBookGrantIssuer.test.mjs`
- Test: `backend/src/3_applications/school/BookLogProgramLauncher.test.mjs`

**Also in this task (review fold, Tasks 1–2):** hoist the launcher's inline `dayOf` closure
to a public method `dayOf(iso)` beside `studyDay()` — `status()` calls `this.dayOf` — so the
shelf route (Task 6) reads days by the SAME function and the agenda and the card cannot
disagree. Test: `launcher.dayOf('2026-08-10T04:30:00Z')` is `'2026-08-09'` under
`America/Los_Angeles`; `dayOf('garbage')` is `''`.

**Issuer shape (measured):** `HmacSchoolCubeGrantIssuer` is `constructor({ key, clock = () =>
Date.now(), ttlMs })` — `key` not `secret`, a NUMBER clock, `ttlMs` not `ttlSeconds`, and
`verify` returns `{ok, reason?, payload?}`. The book issuer must match that shape exactly;
the tests below are written to it.

**Step 1: Failing tests**

`HmacSchoolBookGrantIssuer.test.mjs`:
```js
import { describe, expect, it } from 'vitest';
import { HmacSchoolBookGrantIssuer } from './HmacSchoolBookGrantIssuer.mjs';

const T0 = Date.parse('2026-09-02T20:00:00Z');
const issuer = (now = T0) => new HmacSchoolBookGrantIssuer({ key: 'test-secret', clock: () => now, ttlMs: 3_600_000 });

describe('HmacSchoolBookGrantIssuer', () => {
  it('issues a grant that verifies for the same learner', () => {
    const grant = issuer().issue({ learnerId: 'kid' });
    const result = issuer().verify(grant, { learnerId: 'kid' });
    expect(result.ok).toBe(true);
    expect(result.payload.learnerId).toBe('kid');
  });
  it('refuses a grant for a different learner', () => {
    expect(issuer().verify(issuer().issue({ learnerId: 'kid' }), { learnerId: 'sibling' }).ok).toBe(false);
  });
  it('refuses a tampered grant', () => {
    const grant = issuer().issue({ learnerId: 'kid' });
    expect(issuer().verify(`${grant.slice(0, -2)}xx`, { learnerId: 'kid' }).ok).toBe(false);
  });
  it('refuses an expired grant', () => {
    const grant = issuer().issue({ learnerId: 'kid' });
    expect(issuer(T0 + 86_400_000).verify(grant, { learnerId: 'kid' }).ok).toBe(false);
  });
  it('refuses garbage without throwing', () => {
    expect(issuer().verify(undefined, { learnerId: 'kid' }).ok).toBe(false);
    expect(issuer().verify('not.a.grant', { learnerId: 'kid' }).ok).toBe(false);
  });
});
```

Append to `BookLogProgramLauncher.test.mjs`:
```js
  it('issues a launch target carrying a grant for the learner', () => {
    const grants = { issue: ({ learnerId }) => `grant-for-${learnerId}` };
    const instance = launcher(enrolled(), [], { grants });
    expect(instance.issueLaunchTarget({ userId: 'kid' }))
      .toEqual({ kind: 'program', program: 'book-log', learnerId: 'kid', bookGrant: 'grant-for-kid' });
  });

  it('refuses to issue a target without a grants issuer', () => {
    expect(() => launcher(enrolled()).issueLaunchTarget({ userId: 'kid' })).toThrow(/grant/);
  });
```

**Step 2: Run to verify they fail**

```bash
npx vitest run backend/src/1_adapters/school/actions/HmacSchoolBookGrantIssuer.test.mjs backend/src/3_applications/school/BookLogProgramLauncher.test.mjs
```
Expected: issuer suite fails on missing module; launcher suite 2 failed (`issueLaunchTarget is not a function`).

**Step 3: Implement**

`HmacSchoolBookGrantIssuer.mjs` — copy `HmacSchoolCubeGrantIssuer.mjs` verbatim (same key derivation with its own `CONTEXT` string, same HMAC, same `#sign`, same `verify` shape) with these differences only: `PURPOSE = 'book-shelf'`; constructor `{ key, clock = () => Date.now(), ttlMs = 8 * 60 * 60 * 1000 }`; `issue({ learnerId })` payload `{ purpose, learnerId, exp, jti }`; `verify(token, { learnerId })` checks purpose, expiry, and `learnerId` only. Do not invent a new scheme.

In `BookLogProgramLauncher.mjs`:
- constructor: accept `grants = null`, store `this.#grants = grants`.
- add:
  ```js
  /**
   * The signed handoff the panel mounts the shelf with (`RunSelfServiceAction`
   * spreads this into the mount effect). Routes verify `bookGrant` per request
   * and take the learner from it — never from the client (design §2). Same
   * pattern as `RubiksCubeProgramLauncher.issueLaunchTarget`.
   */
  issueLaunchTarget({ userId } = {}) {
    if (!this.#grants) throw new Error('BookLogProgramLauncher cannot issue a launch target without a grants issuer');
    return { kind: 'program', program: this.id, learnerId: userId, bookGrant: this.#grants.issue({ learnerId: userId }) };
  }
  ```

**Step 4: Run to verify they pass**

```bash
npx vitest run backend/src/1_adapters/school/actions/HmacSchoolBookGrantIssuer.test.mjs backend/src/3_applications/school/BookLogProgramLauncher.test.mjs
```
Expected: 5 + 18 passed.

**Step 5: Commit**

```bash
git add backend/src/1_adapters/school/actions/HmacSchoolBookGrantIssuer.mjs backend/src/1_adapters/school/actions/HmacSchoolBookGrantIssuer.test.mjs backend/src/3_applications/school/BookLogProgramLauncher.mjs backend/src/3_applications/school/BookLogProgramLauncher.test.mjs
git commit -m "feat(school): book-shelf launch grant, issued by the launcher, verified per request

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CCgjP35PPBGYjLnxiMPNdM"
```

---

## Task 5b (DONE — `c1c7ee4ca`): a backdated finish credits the finish day, never today

User decision 2026-09-02. The "already finished it" door opened the item NOW, so the
`started` event handed today a check-in for a book read last week. `openedAt` now carries
the chosen day for that door (`started` and `finished` both at noon of `finishedOn`);
`starting`/`partway` still open now. Restores design §5 step 3, safe since `itemId` no
longer derives from `openedAt`. Domain pin: `checkins` for today's window is 0, for the
finish day 1.

## Task 6 (DONE — `294c6e89b`, revised): `GetBookShelf` + routes

**As built (differs from the sketch below, which is kept for the test text):** the layer
audit forbids `#domains`/`#apps` imports and `res.status(500)` under `4_api/`, so the
projection lives in a new `GetBookShelf` use case (`3_applications/school/usecases/`) that
takes `bookLog`, `bookRepository`, `bookLogLauncher` and counts days with the launcher's
`dayOf`; both routers receive everything by injection, wrap handlers in `asyncHandler`, and
throw rather than translate — the app's `errorHandlerMiddleware` maps `ValidationError`
by name to 400. The school router acts for `result.payload.learnerId`. Express 5 captures
the colon-bearing `itemId` intact (probed).

## Task 6b (DONE — `20c40cf35`): error-shape uniformity and test hardening (review carry from Task 6)

**Why:** the production error middleware answers `{ ok:false, error:{ type, message, code }, traceId }`
but the router's own 403 answers `{ error: 'string' }`, and the router tests mount a stand-in
that matches neither. One shape, asserted against the real handler.

**Files:** `backend/src/4_api/v1/routers/schoolBooks.mjs` + test; `backend/src/4_api/v1/routers/books.mjs` + test; `backend/src/3_applications/school/usecases/GetBookShelf.test.mjs`.

1. `schoolBooks.mjs`: `learnerFromGrant` no longer responds; on `!ok` it **throws** an `Error('A current reading launch is required')` with `err.status = 403` and `err.name = 'AuthorizationError'` (the middleware honours `status`). Routes drop their `if (!learnerId) return;`.
2. `books.mjs`: the empty-id 400 stays a direct JSON reply (it is a resolver outcome shape, `{status:'invalid', reason:'empty'}`, not an error) — leave it.
3. Both router tests mount the REAL handler: `import { errorHandlerMiddleware } from '#system/http/middleware/index.mjs'` and `a.use(errorHandlerMiddleware())`; assertions read `res.body.error.message`. Note the 403 body becomes `{ ok:false, error:{...}, traceId }`.
4. Test hardening: after the 403 loop assert no use case was called; add an `unread` (events-less) item and assert it sorts last; make the `dayOf` test inject a day-SHIFTING function (fold `2026-09-02T10:00Z` onto `2026-09-01`) and assert `daysRead === 1`; add a whitespace-only `?id=%20` case to `books.test.mjs`.
5. Run the three suites + `npm run audit:layers | grep -E "api-"`; commit `fix(api): shelf routes throw 403 through the app error handler; tests use the real middleware`.

## Task 6 (original sketch — superseded by the DONE block above; test text still applies)

**Files:**
- Create: `backend/src/4_api/v1/routers/books.mjs`
- Create: `backend/src/4_api/v1/routers/schoolBooks.mjs`
- Test: `backend/src/4_api/v1/routers/books.test.mjs`
- Test: `backend/src/4_api/v1/routers/schoolBooks.test.mjs`

Model on `backend/src/4_api/v1/routers/rubiksCube.mjs` (grant header → `authorized(req,res)` → `403` on failure) and its test `rubiksCube.test.mjs` (`supertest ^6.3.4` is installed; copy that harness).

**Identity rule (review carry from Task 5):** `grants.verify(token, { learnerId: req.params.learnerId })` proves the grant was issued for the URL's learner; the handler then uses **`result.payload.learnerId`** — never `req.params` or the body — as the learner it acts for. A passing `verify` with no `expected.learnerId` accepts any learner, so the `expected` argument is not optional here.

**Step 1: Failing tests**

`books.test.mjs`:
```js
import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createBooksRouter } from './books.mjs';

const app = (resolveBook) => { const a = express(); a.use('/books', createBooksRouter({ resolveBook })); return a; };

describe('GET /books/resolve', () => {
  it('returns the resolver outcome verbatim', async () => {
    const resolveBook = { async execute(id) { return { status: 'ok', book: { isbn13: id, title: 'x' } }; } };
    const res = await request(app(resolveBook)).get('/books/resolve?id=9780064400558');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', book: { title: 'x' } });
  });
  it('answers 400 with the invalid reason, and never calls the resolver for an empty id', async () => {
    let called = false;
    const resolveBook = { async execute() { called = true; return { status: 'ok' }; } };
    const res = await request(app(resolveBook)).get('/books/resolve');
    expect(res.status).toBe(400);
    expect(called).toBe(false);
  });
  it('maps not-found to 404 and unavailable to 503', async () => {
    expect((await request(app({ async execute() { return { status: 'not-found' }; } })).get('/books/resolve?id=9780064400558')).status).toBe(404);
    expect((await request(app({ async execute() { return { status: 'unavailable', failures: [] }; } })).get('/books/resolve?id=9780064400558')).status).toBe(503);
  });
});
```

`schoolBooks.test.mjs`:
```js
import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSchoolBooksRouter } from './schoolBooks.mjs';

const grants = { verify: (token, { learnerId }) => (token === `ok-${learnerId}` ? { ok: true, payload: { learnerId } } : { ok: false }) };
const item = { itemId: 'kid:b:e1', bookId: 'b', progressMode: 'page', pageCount: 184, events: [{ kind: 'progress', at: '2026-09-01T10:00:00.000Z', page: 84 }] };

function deps() {
  return {
    grants,
    bookLog: { async listForLearner() { return [item]; } },
    openBookShelfItem: { calls: [], async execute(input) { this.calls.push(input); return { item: { ...item, itemId: 'kid:b:new' }, event: null, book: {} }; } },
    recordBookProgress: { calls: [], modes: [], async execute(input) { this.calls.push(input); return { item, event: { kind: input.kind } }; }, async setMode(input) { this.modes.push(input); return { ...item, progressMode: input.progressMode }; } },
    bookLogLauncher: {
      async status() { return { enrolled: true, progressLabel: '14 of 20 pages', obligationProgress: { actual: 14, target: 20, metric: 'pages', per: 'day', incompatibleBooks: [] } }; },
      dayOf: (iso) => String(iso).slice(0, 10),
    },
    bookRepository: { async findByIsbn() { return { isbn13: 'b', title: 'Hatchet', coverUrl: 'https://c/x.jpg' }; } },
  };
}
const app = (d = deps()) => { const a = express(); a.use('/school/books', createSchoolBooksRouter(d)); return [a, d]; };

describe('school books routes', () => {
  it('refuses every route without a valid grant', async () => {
    const [a] = app();
    for (const [method, path] of [['get', '/school/books/kid/shelf'], ['post', '/school/books/kid/shelf'], ['post', '/school/books/kid/shelf/kid:b:e1/progress'], ['post', '/school/books/kid/shelf/kid:b:e1/mode']]) {
      const res = await request(a)[method](path).set('X-School-Book-Grant', 'ok-sibling').send({});
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });

  it('GET shelf returns items with projections, book facts, and the obligation line', async () => {
    const [a] = app();
    const res = await request(a).get('/school/books/kid/shelf').set('X-School-Book-Grant', 'ok-kid');
    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({ itemId: 'kid:b:e1', title: 'Hatchet', coverUrl: 'https://c/x.jpg', projection: { status: 'reading', page: 84, percent: 46 } });
    expect(res.body.obligation).toMatchObject({ label: '14 of 20 pages', actual: 14, target: 20 });
  });

  it('POST shelf takes the learner from the grant, not the body', async () => {
    const [a, d] = app();
    const res = await request(a).post('/school/books/kid/shelf').set('X-School-Book-Grant', 'ok-kid')
      .send({ learnerId: 'sibling', bookId: 'b', entryId: 'e1', where: 'starting' });
    expect(res.status).toBe(200);
    expect(d.openBookShelfItem.calls[0].learnerId).toBe('kid');
  });

  it('POST progress and POST mode route to the use case with the grant learner', async () => {
    const [a, d] = app();
    await request(a).post('/school/books/kid/shelf/kid:b:e1/progress').set('X-School-Book-Grant', 'ok-kid').send({ kind: 'progress', page: 90, entryId: 'p1' });
    expect(d.recordBookProgress.calls[0]).toMatchObject({ learnerId: 'kid', itemId: 'kid:b:e1', page: 90 });
    await request(a).post('/school/books/kid/shelf/kid:b:e1/mode').set('X-School-Book-Grant', 'ok-kid').send({ progressMode: 'check' });
    expect(d.recordBookProgress.modes[0]).toEqual({ learnerId: 'kid', itemId: 'kid:b:e1', progressMode: 'check' });
  });

  it('turns a ValidationError into 400 with the message', async () => {
    const [a, d] = app();
    d.recordBookProgress.execute = async () => { const e = new Error('page must be a positive integer'); e.name = 'ValidationError'; throw e; };
    const res = await request(a).post('/school/books/kid/shelf/kid:b:e1/progress').set('X-School-Book-Grant', 'ok-kid').send({ kind: 'progress', page: -1, entryId: 'p' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/page/);
  });
});
```

If `supertest` is not installed, check `package.json` devDependencies; `rubiksCube.test.mjs` shows the harness the repo actually uses — copy that instead.

**Step 2: Run to verify they fail** — `Cannot find module`.

**Step 3: Implement**

`books.mjs`:
```js
import express from 'express';

/** The lookup a child's shelf uses; no auth — book facts are not private. */
export function createBooksRouter({ resolveBook, logger = null } = {}) {
  if (!resolveBook) throw new Error('createBooksRouter requires resolveBook');
  const router = express.Router();
  const STATUS = { ok: 200, invalid: 400, 'not-found': 404, unavailable: 503 };
  router.get('/resolve', async (req, res) => {
    const id = typeof req.query.id === 'string' ? req.query.id : '';
    if (!id.trim()) return res.status(400).json({ status: 'invalid', reason: 'empty' });
    try {
      const result = await resolveBook.execute(id, { refresh: req.query.refresh === '1' });
      res.status(STATUS[result.status] ?? 500).json(result);
    } catch (error) {
      logger?.warn?.('books.resolve.request-failed', { error: error.message });
      res.status(500).json({ status: 'unavailable', reason: 'internal' });
    }
  });
  return router;
}
export default createBooksRouter;
```

`schoolBooks.mjs`:
```js
import express from 'express';
import { projectShelfItem } from '#domains/school/bookShelf.mjs';

/**
 * The shelf's routes. Every one is grant-gated and takes the learner from the
 * grant — the body's `learnerId`, if any, is ignored (design §2, review B4).
 */
export function createSchoolBooksRouter({
  grants, bookLog, openBookShelfItem, recordBookProgress, bookLogLauncher, bookRepository, logger = null,
} = {}) {
  for (const [name, dep] of Object.entries({ grants, bookLog, openBookShelfItem, recordBookProgress, bookLogLauncher, bookRepository })) {
    if (!dep) throw new Error(`createSchoolBooksRouter requires ${name}`);
  }
  const router = express.Router();

  const authorized = (req, res) => {
    const result = grants.verify(req.get('X-School-Book-Grant'), { learnerId: req.params.learnerId });
    if (!result?.ok) { res.status(403).json({ error: 'A current reading launch is required' }); return null; }
    return result.payload.learnerId;
  };
  const wrap = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (error) {
      const status = error?.name === 'ValidationError' ? 400 : 500;
      logger?.warn?.('school.book-shelf.request-failed', { path: req.path, status, error: error.message });
      res.status(status).json({ error: error.message });
    }
  };

  router.get('/:learnerId/shelf', wrap(async (req, res) => {
    const learnerId = authorized(req, res); if (!learnerId) return;
    const [items, status] = await Promise.all([bookLog.listForLearner(learnerId), bookLogLauncher.status(learnerId)]);
    const enriched = await Promise.all(items.map(async (item) => {
      const book = await bookRepository.findByIsbn(item.bookId).catch(() => null);
      return {
        ...item,
        title: book?.title ?? null, authors: book?.authors ?? [], coverUrl: book?.coverUrl ?? null,
        // ONE day function for agenda and card alike — the launcher's (Task 5).
        projection: projectShelfItem(item, { dayOf: (iso) => bookLogLauncher.dayOf(iso) }),
      };
    }));
    enriched.sort((a, b) => String(b.projection.lastAt ?? '').localeCompare(String(a.projection.lastAt ?? '')));
    const op = status?.obligationProgress ?? null;
    res.json({
      learnerId,
      items: enriched,
      obligation: op ? { label: status.progressLabel, ...op } : null,
    });
  }));

  router.post('/:learnerId/shelf', express.json(), wrap(async (req, res) => {
    const learnerId = authorized(req, res); if (!learnerId) return;
    const { learnerId: _ignored, ...body } = req.body ?? {};
    res.json(await openBookShelfItem.execute({ ...body, learnerId }));
  }));

  router.post('/:learnerId/shelf/:itemId/progress', express.json(), wrap(async (req, res) => {
    const learnerId = authorized(req, res); if (!learnerId) return;
    const { learnerId: _ignored, ...body } = req.body ?? {};
    res.json(await recordBookProgress.execute({ ...body, learnerId, itemId: req.params.itemId }));
  }));

  router.post('/:learnerId/shelf/:itemId/mode', express.json(), wrap(async (req, res) => {
    const learnerId = authorized(req, res); if (!learnerId) return;
    res.json(await recordBookProgress.setMode({ learnerId, itemId: req.params.itemId, progressMode: req.body?.progressMode }));
  }));

  return router;
}
export default createSchoolBooksRouter;
```

**Step 4: Run to verify they pass** — `npx vitest run backend/src/4_api/v1/routers/books.test.mjs backend/src/4_api/v1/routers/schoolBooks.test.mjs` → 8 passed.

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/books.mjs backend/src/4_api/v1/routers/books.test.mjs backend/src/4_api/v1/routers/schoolBooks.mjs backend/src/4_api/v1/routers/schoolBooks.test.mjs
git commit -m "feat(api): /books/resolve and grant-gated /school/books shelf routes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CCgjP35PPBGYjLnxiMPNdM"
```

---

## Task 7 (DONE — `c2264b172`): `YamlBookRepository` — the resolved-record cache

**Files:**
- Create: `backend/src/3_applications/books/ports/IBookRepository.mjs`
- Create: `backend/src/1_adapters/persistence/yaml/YamlBookRepository.mjs`
- Test: `backend/src/1_adapters/persistence/yaml/YamlBookRepository.test.mjs`

**Step 1: Failing test**
```js
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { createBookRecord } from '#domains/books/BookRecord.mjs';
import { YamlBookRepository } from './YamlBookRepository.mjs';

let root;
const configService = { getHouseholdPath: (suffix) => path.join(root, suffix) };
const repo = () => new YamlBookRepository({ configService, logger: { info() {}, warn() {}, error() {}, debug() {} } });
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookrepo-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('YamlBookRepository', () => {
  it('saves and finds by isbn13, under household/books/', async () => {
    const r = repo();
    await r.save(createBookRecord({ source: 'openlibrary', isbn13: '9780064400558', title: "Charlotte's Web", pageCount: 184 }));
    expect(fs.existsSync(path.join(root, 'books/9780064400558.yml'))).toBe(true);
    const found = await r.findByIsbn('9780064400558');
    expect(found).toMatchObject({ title: "Charlotte's Web", pageCount: 184, sources: ['openlibrary'] });
    expect(Object.isFrozen(found)).toBe(true);
  });
  it('returns null for a miss and for a corrupt file', async () => {
    expect(await repo().findByIsbn('9780000000000')).toBeNull();
    fs.mkdirSync(path.join(root, 'books'), { recursive: true });
    fs.writeFileSync(path.join(root, 'books/9780064400558.yml'), 'this: [is: bad');
    expect(await repo().findByIsbn('9780064400558')).toBeNull();
  });
  it('refuses an unsafe isbn as a filename', async () => {
    await expect(repo().save(createBookRecord({ source: 'x', isbn13: '../escape' }))).rejects.toThrow(/isbn/);
  });
});
```

**Step 2: Fail** on missing module.

**Step 3: Implement** — port with `findByIsbn()`/`save()` throwing stubs; adapter stores `<householdPath>/books/<isbn13>.yml`, `SAFE = /^\d{13}$/`, `save` writes `yaml.dump(record)` via `writeFileAtomic`, `findByIsbn` returns `createBookRecord(loaded)` (re-freezes and re-normalises) or `null` on missing/corrupt (log `books.repository.corrupt` at warn). Read `YamlBookLogStore.mjs` for `ensureDir`/`writeFileAtomic` imports.

**Step 4: Pass** — 3 tests.

**Step 5: Commit** — `feat(books): YAML repository for resolved book records`.

---

## Task 8 (DONE — `97c175d10`): Composition — wire everything, mount routers, `continueToday` on the reading code

**Anchors (all measured, use these exactly):**
- New module `backend/src/5_composition/modules/booksApi.mjs` (house convention: `<domain>Api.mjs`, cf. `fitnessApi.mjs` — `import { createXApiRouter, createXModule } from '#composition/modules/xApi.mjs'`). Export `createBooksModule({ configService, logger })` → `{ resolveBook, bookRepository }` and `createBooksApiRouter({ resolveBook, logger })` (thin over `createBooksRouter`). Gateways: `OpenLibraryAdapter` always; `GoogleBooksAdapter` with `apiKey = configService.getHouseholdAuth('google')?.GOOGLE_BOOKS_API_KEY ?? null` — the key lives in **`household/auth/google.yml`** (fields `GOOGLE_API_KEY`, `GOOGLE_BOOKS_API_KEY`, `GOOGLE_CSE_ID`); `system/auth/google.yml` is a different OAuth file, do not read it. Pattern: `configService.getHouseholdAuth('komga')` at `bootstrap.mjs:2773`.
- `bookGrants = new HmacSchoolBookGrantIssuer({ key: jwtSecret })` built in `app.mjs` next to `schoolCubeGrants` (`app.mjs:3280`); `jwtSecret` already satisfies the ≥32-byte floor.
- `createSchoolLifecycle(...)` (`app.mjs:3832`, signature at `schoolLifecycle.mjs:220`) gains deps `bookGrants`, `resolveBook`, `bookRepository`. Inside: `stores.bookLog = new YamlBookLogStore({ configService, logger })` beside `readingLog` (~line 512); `launchers.set(BOOK_LOG_PROGRAM_ID, new BookLogProgramLauncher({ bookLog: stores.bookLog, assignments: stores.assignments, timezone, clock, logger, grants: bookGrants }))` beside story-time (~606), unconditional; `useCases.getBookShelf/openBookShelfItem/recordBookProgress` constructed with `clock`, `logger`, `resolveBook`, `bookRepository`; expose `bookLog`/`bookRepository` in the returned `stores` and the three in `useCases` (return at ~1378).
- Mounts in `app.mjs` beside `/rubiks-cube` (~4436): `v1Routers.use('/books', createBooksApiRouter(...))` and `v1Routers.school.use('/books', createSchoolBooksRouter({ grants: bookGrants, getBookShelf, openBookShelfItem, recordBookProgress }))`.
- `continueToday` (as built): `BuildAgenda` derives `subjectsWithReadingShelf(assignment)` from the `PlanProjection` it already loads — the subjects of the learner's `book-log` programs (`subject ?? 'english'`) — and adds `continueToday: true` to the `subject_next` token's `subject` block for those sections. (`section.progressRows` was the WRONG hook: `progressRowsFor` returns a program's own lesson rows.) Test: `BuildAgenda.continueToday.test.mjs`. `v1Routers` is keyed by path segment, so `/books` is registered in `routers/api.mjs` and assigned as `v1Routers.books`.
- `test:composition-contracts` (`composition-contract-registry.test.mjs`) runs in the hook — add the new launcher/stores if it enumerates them.


**Files:**
- Modify: `backend/src/5_composition/modules/schoolLifecycle.mjs` (launcher registration near line 606; stores near line 512)
- Modify: `backend/src/app.mjs` (router mounts near line 4436; look for how `rubiksCubeGrants` is built and how the cube secret is read — reuse that secret source with a distinct purpose)
- Modify: whichever module writes `subject.continueToday` onto an issued code record (trace from `ResolveAccessCode.mjs:256 record.subject?.continueToday` back to where records are created — likely the daily code issuance in `IssueSchoolContinuationCode.mjs` or the agenda print path). Set `continueToday: true` when the subject's offered program is `book-log`.
- Test: `backend/src/5_composition/composition-contract-registry.test.mjs` (run it; add the new launcher/stores if it enumerates them)

**Steps:**

1. In `schoolLifecycle.mjs` stores block: `bookLog: new YamlBookLogStore({ configService, logger })`, `bookRepository: new YamlBookRepository({ configService, logger })`.
2. Build gateways: `new OpenLibraryAdapter({ logger })` and, when `configService` yields a `GOOGLE_BOOKS_API_KEY` from `household/auth/google.yml` (find how `google.yml` is read elsewhere — grep `GOOGLE_API_KEY` in `5_composition`), `new GoogleBooksAdapter({ apiKey, logger })`. `resolveBook = new ResolveBook({ gateways, repository: stores.bookRepository, logger })`.
3. `bookGrants = new HmacSchoolBookGrantIssuer({ secret: <same secret source as rubiksCubeGrants>, clock })`.
4. `launchers.set(BOOK_LOG_PROGRAM_ID, new BookLogProgramLauncher({ bookLog: stores.bookLog, assignments: stores.assignments, timezone, clock, logger, grants: bookGrants }))` — unconditional, beside story-time.
5. Export `resolveBook`, `bookGrants`, `stores.bookLog`, `stores.bookRepository`, the launcher, and instances of `OpenBookShelfItem` / `RecordBookProgress` from the lifecycle result so `app.mjs` can mount:
   ```js
   v1Routers.use('/books', createBooksRouter({ resolveBook, logger }));
   v1Routers.school.use('/books', createSchoolBooksRouter({ grants: bookGrants, bookLog, openBookShelfItem, recordBookProgress, bookLogLauncher, bookRepository, logger }));
   ```
   The cube router is mounted at `app.mjs:4436` — mirror that. `bookGrants` uses the same `jwtSecret` the cube issuer takes at `app.mjs:3280` (`new HmacSchoolCubeGrantIssuer({ key: jwtSecret })`).
6. `continueToday` (measured): the daily code record is minted at `backend/src/3_applications/school/usecases/BuildAgenda.mjs:378-380` — `mintToken({ tokenClass: 'subject_next', subject: { learnerId, subject: section.subject }, ... })` — and `ResolveAccessCode.mjs:256` reads `record.subject?.continueToday`. A section's program entries are in `section.progressRows` (from `progressRowsFor(statuses)`; confirm the row's key field). Set `continueToday: true` in that `subject` block when any row's program is `book-log`, so the reading code still opens the shelf after the obligation is met. Unit test in `BuildAgenda.test.mjs` (or the nearest existing suite) asserting the minted record carries it for a book-log section and not for a plain one.
7. Run: `npx vitest run backend/src/5_composition/composition-contract-registry.test.mjs backend/src/3_applications/school` — expect green except the pre-existing `CloseLanguageDay` ordering flake (verify it also fails on `main` before blaming this task).
8. Boot check WITHOUT starting a second backend: `node --check backend/app.mjs` and `npm run check:parse`.
9. Commit: `feat(books): compose the shelf — stores, resolver, grants, launcher, routes, continueToday`.

---

## Task 8b (DONE — `df838bcd9`), 8c (DONE — `0cbe6f31e`), 8d (DONE — `e91079379`): the agenda path

Three defects the Task 8 review chain surfaced, each of which left the shelf silently inert:
no `book-log` plan entry (8b: `assignedProgramPlan` branch mirroring story-time, `unitId
book-log:shelf`, `programInstance shelf`); `status(learnerId)` where every caller passes
`status({ userId })` (8b); the served-day `continueToday` fallback reading the planner's
pre-append `inProgress/available` snapshots (8c in `ResolveSubjectNext`, 8d in the DUPLICATE
`ResolveAccessCode#resolve` — the typed-code path — and the scan path); append-order
returning a lesson over the shelf (8d: the token carries `program: 'book-log'` and both
resolvers share `findContinuationEntry`, preferring the named program; `forwardAction`'s
"One more?" tokens carry no program and keep meaning a lesson); `baseEntry` hard-coding
`cadence: 'daily'` so `terminal` never fired (8c: a `per: 'once'` obligation passes `'once'`).
Verified: 1275/1275 across `usecases` + `tests/isolated/application/school`.

## Task 11b: `useBookShelf` review fixes

`busy` released only after the refetch; the duplicate guard enforced (`confirmCover(true)`
refuses with `add.rejected{duplicate}`) and reachable (`openDuplicate()`); generation bump on
unmount; single-flight `lookup`; a done-then-timer test.

## Task 9 (DONE — `418a9bd22`): Frontend — `NumberPad` (replaces Keypad for pages, minutes, ISBN) (review B2)

As built: glyph size derives from the 32rem wrapper, not the viewport (a viewport formula overflowed 13 slots at 1920px). **Follow-up for Task 13:** wrap the keys with Keypad's `useTapFire` pointerdown pattern (the wall panel's buttons are hard to press) and consider the bonded-HID `keydown` path.

**Why:** `Keypad.jsx` auto-submits at exactly `length`, refuses digits past it, empties on submit, hardcodes `<h1>Type your code</h1>` and a screen-off button. The shelf needs variable length, an explicit submit, retained entry on failure, an optional `X` key, and a label prop.

**Style scope (measured):** `npm run audit:ui` scans only `lib/ui`, Health, Life, Auto and Media — **the School module is not in its roots**, which is why `Keypad.jsx` (6 native `<button>`s) passes today. Follow the `selfService/` conventions and `School.scss` directly; do not pull Mantine/`lib/ui` primitives into the kiosk (it is not wrapped in an `AppThemeProvider`). Test harness: root vitest, `@testing-library/react` from `frontend/node_modules`, jest-dom matchers wired globally, `fireEvent` (no `user-event`); mock `../schoolLog.js` as `Keypad.autoSubmit.test.jsx` does.

**Files:**
- Create: `frontend/src/modules/School/books/NumberPad.jsx`
- Test: `frontend/src/modules/School/books/NumberPad.test.jsx`
- SCSS: append to `frontend/src/modules/School/School.scss` under a `.school-books` namespace; reuse the key sizing tokens from `.school-selfservice__key` (`clamp(3.75rem, 8.5vh, 4.5rem)`) and the display font.

**Step 1: Failing test** (vitest + @testing-library/react, same setup as `Keypad.autoSubmit.test.jsx`):
```jsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NumberPad from './NumberPad.jsx';

describe('NumberPad', () => {
  it('shows the label and submits only on the explicit button', () => {
    const onSubmit = vi.fn();
    render(<NumberPad label="What page are you on?" maxLength={4} submitLabel="Save" onSubmit={onSubmit} />);
    expect(screen.getByText('What page are you on?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '8' }));
    fireEvent.click(screen.getByRole('button', { name: '4' }));
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledWith('84');
  });
  it('keeps the entry after submit so a retry does not retype 13 digits', () => {
    render(<NumberPad label="ISBN" maxLength={13} submitLabel="Look it up" onSubmit={() => {}} />);
    for (const d of '9780064400558') fireEvent.click(screen.getByRole('button', { name: d }));
    fireEvent.click(screen.getByRole('button', { name: 'Look it up' }));
    expect(screen.getByTestId('numberpad-entry').textContent.replace(/\s/g, '')).toBe('9780064400558');
  });
  it('refuses digits past maxLength and offers an X key only when asked', () => {
    render(<NumberPad label="x" maxLength={2} allowX onSubmit={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    expect(screen.getByTestId('numberpad-entry').textContent.replace(/\s/g, '')).toBe('12');
    expect(screen.getByRole('button', { name: 'X' })).toBeTruthy();
  });
  it('disables submit while a hint says the entry is wrong', () => {
    render(<NumberPad label="x" maxLength={4} hint="Check that number" submitLabel="Go" canSubmit={false} onSubmit={() => {}} />);
    expect(screen.getByRole('button', { name: 'Go' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Check that number')).toBeTruthy();
  });
  it('reports every change so a parent can validate per keystroke', () => {
    const onChange = vi.fn();
    render(<NumberPad label="x" maxLength={3} onChange={onChange} onSubmit={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '9' }));
    expect(onChange).toHaveBeenLastCalledWith('9');
  });
});
```

**Step 2: Fail** on missing module.

**Step 3: Implement** — a controlled-ish pad: internal `entry` state; props `label, maxLength, allowX=false, submitLabel='Go', canSubmit=true, hint=null, onChange, onSubmit, autoFocus`; digits `1-9,0`, `⌫`, optional `X`; entry rendered in `data-testid="numberpad-entry"` as spaced glyphs with empty slots up to `maxLength`; submit button disabled when `!canSubmit || entry.length === 0`. No `<h1>`, no screen-off. Class names `school-books-pad`, `school-books-pad__entry`, `school-books-pad__key`, `school-books-pad__submit`, `school-books-pad__hint`. Keys reuse `.school-selfservice__key` sizing via `@extend` or copied tokens; **entry slot width must be computed from `maxLength`** so 13 slots fit `min(32rem, 100%)`: use `font-size: clamp(0.9rem, calc(28vw / var(--slots)), 2rem)` with `--slots` set inline.

**Step 4: Pass** — 5 tests. Also run `npx vitest run frontend/src/modules/School/selfService` to prove `Keypad` is untouched.

**Step 5: Commit** — `feat(school-ui): NumberPad — explicit submit, retained entry, variable length`.

---

## Task 10 (DONE — `66ca302d7`): Frontend — `DayPicker` (design §5, review m1)

**Files:**
- Create: `frontend/src/modules/School/books/DayPicker.jsx`
- Create: `frontend/src/modules/School/books/dayGrid.js` (pure)
- Test: `frontend/src/modules/School/books/dayGrid.test.js`, `DayPicker.test.jsx`

**Step 1: Failing pure test** `dayGrid.test.js`:
```js
import { describe, expect, it } from 'vitest';
import { buildDayGrid } from './dayGrid.js';

describe('buildDayGrid', () => {
  it('ends on today, starts on a Monday, covers at least 21 days, never shows the future', () => {
    const rows = buildDayGrid('2026-09-02'); // a Wednesday
    const flat = rows.flat().filter(Boolean);
    expect(flat.at(-1).key).toBe('2026-09-02');
    expect(rows[0][0].weekday).toBe(1);
    expect(flat.length).toBeGreaterThanOrEqual(21);
    expect(flat.every((c) => c.key <= '2026-09-02')).toBe(true);
  });
  it('pads the last row with nulls after today rather than future days', () => {
    const rows = buildDayGrid('2026-09-02');
    const last = rows.at(-1);
    expect(last.map((c) => c?.key ?? null)).toEqual(['2026-08-31', '2026-09-01', '2026-09-02', null, null, null, null]);
  });
  it('a row that crosses a month boundary is ONE row, with the month change flagged on the cell', () => {
    const rows = buildDayGrid('2026-09-02');
    const crossing = rows.find((r) => r.some((c) => c?.key === '2026-08-31') && r.some((c) => c?.key === '2026-09-01'));
    expect(crossing).toBeTruthy();
    expect(crossing.find((c) => c?.key === '2026-09-01').monthStart).toBe(true);
  });
  it('today on a Sunday is exactly three full rows; today on a Monday adds a one-cell row', () => {
    expect(buildDayGrid('2026-09-06').length).toBe(3);
    const mon = buildDayGrid('2026-09-07');
    expect(mon.at(-1).filter(Boolean)).toHaveLength(1);
  });
  it('marks today', () => {
    expect(buildDayGrid('2026-09-02').flat().find((c) => c?.key === '2026-09-02').isToday).toBe(true);
  });
});
```

**Step 2: Fail.**

**Step 3: Implement `dayGrid.js`** — pure, no Date-locale: parse `YYYY-MM-DD` to UTC epoch; ISO weekday `((getUTCDay()+6)%7)+1`; walk back to the Monday that is ≥ 20 days before today (i.e. start = today − (todayIso−1) − 14 days), produce rows of 7 `{key, day, weekday, monthStart, isToday}` or `null` after today. Export `WEEKDAY_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']` and `monthLabel(key)`.

**Step 4: `DayPicker.jsx`** — props `today, value, onChange, onConfirm`; collapsed state shows `Today · Wed 2` and `pick a day ›`; expanded renders the grid with weekday header once, `monthStart` cells carrying a small month caption, today bracketed, the selected cell highlighted, `That's the day` confirm. Test: renders the crossing row as one row, pre-selects today, emits the chosen key on confirm. Speech: **omit** (review M4 — no TTS exists); leave a `// TODO(a11y): read the weekday aloud once the panel has speech` comment.

**Step 5: Pass, commit** — `feat(school-ui): DayPicker — rolling three weeks, weekday first, no month breaks`.

---

## Task 11 (DONE — `35fa3886b`, hardened in 11b): Frontend — `useBookShelf.js`, `isbn.js`, `schoolApi.books`, `schoolLog.bookShelf`

**Files:**
- Create: `frontend/src/modules/School/books/bookShelfApi.js`
- Create: `frontend/src/modules/School/books/bookLog.js` (facade over `schoolLog`)
- Create: `frontend/src/modules/School/books/useBookShelf.js`
- Test: `frontend/src/modules/School/books/useBookShelf.test.jsx`

**API — as an additive `books` group on the existing `schoolApi` (measured), NOT a new file:** `schoolApi.js` has a private `req(path, body, method, headers)` returning `{ ok, status, data }` and never throwing, with `BASE = '/api/v1/school'`, plus `reqAbsolute(path)` for GETs outside it. Add `schoolApi.books = { resolve(id) → reqAbsolute('/api/v1/books/resolve?id=…'), shelf(learnerId, grant), open(learnerId, grant, body), progress(learnerId, grant, itemId, body), mode(learnerId, grant, itemId, progressMode) }`, each passing `{ 'X-School-Book-Grant': grant }`. Error bodies from the app handler are `{ ok:false, error:{ type, message, code }, traceId }` — read `data?.error?.message`. Likewise **no `bookLog.js`**: add `bookShelf` / `bookShelfError` entries to `schoolLog` (`emit('book-shelf', detail, data[, 'error'])`), matching every other category there.

**Hook state machine** (`useBookShelf.js`) — states: `loading | shelf | update | add:number | add:lookup | add:cover | add:where | add:page | add:when | history | closed`. Rules from the design:
- generation guard: every async result is dropped if `gen` changed (Done or idle-close) — copy the pattern at `useSelfService.js:35-39, 402-404`.
- idle timer: `idleTimeoutSeconds` prop (default read from the same lock config `SchoolApp` uses, `SchoolApp.jsx:137-150`), any tap resets; expiry → `onExit('idle')`.
- `entryId`s minted with `crypto.randomUUID()` when an overlay opens (`update`, `add:where`), and a second one for the first event.
- local ISBN validation: import `parseBookIdentifier` from `#domains/books/BookIdentifier.mjs` is NOT allowed (frontend cannot import backend). Copy the checksum+prefix logic into `frontend/src/modules/School/books/isbn.js` (pure, ~40 lines, with its own test mirroring `BookIdentifier.test.mjs`'s ISBN cases) — **and add a length gate**: below 10 chars → `hint: null`; 10 or 13 chars → validate; 11–12 or >13 → `not-an-identifier`.
- copy table (review M3): `isbn13-checksum` / `isbn10-checksum` → *Check that number — one digit is off*; `not-a-book-prefix`, `not-an-identifier` → *That's the library's sticker. Flip the book over.*
- duplicate guard: if the resolved `isbn13` matches an item whose projection is `reading`, state → `add:cover` with `duplicateOf: itemId`.

**Tests** (`useBookShelf.test.jsx` via `renderHook`): loads shelf; opening update mints an entryId; `done()` bumps `gen` and a late `getShelf` resolution does not change state; idle expiry calls `onExit('idle')`; `add` with `'9780064400557'` produces the checksum hint and `canSubmit=false`; `'00100123456789'` produces the sticker hint; `'97800'` produces no hint; resolve `not-found` → state `add:number` with copy *We couldn't find that one*; resolve `unavailable` → `retry` available and the digits retained.

Commit — `feat(school-ui): useBookShelf state machine, api client, log facade, isbn check`.

---

## Task 12 (DONE — `eaf22e01d`, chip fallback in `8dd057562`): Frontend — `ShelfTile`, `BookShelf`, `History`

**Files:**
- Create: `frontend/src/modules/School/books/ShelfTile.jsx`, `BookShelf.jsx`, `History.jsx`
- Test: `ShelfTile.test.jsx`, `BookShelf.test.jsx`
- SCSS: `.school-books` in `School.scss`

**Rules from the design and review:**
- Header: reuse the learner chip — `school-selfservice-card__learner` with `ProfileAvatar` (`LaunchCard.jsx:454-455`), not plain text. `Done` button reuses `.school-selfservice__done` sizing (64px).
- Obligation line only when `shelf.obligation` is non-null; text is `obligation.label` plus the window word: append ` today` for `per: 'day'`, ` this week` for `week`, ` this month` for `month`, nothing for `once` (review M7). The router returns `per` inside `obligation`.
- Tile: cover `<img>` with `onError` → placeholder using class `school-selfservice-card__poster-placeholder` (review m3); caption per mode (`page`: bar + `p. N`, or `Just started` when `page` is null; `minutes`: `Xh Ym` formatted client-side; `check`: `read on N days`); `doesn't count toward {metric}` tag when `itemId` ∈ `obligation.incompatibleBooks`.
- Title: `overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;` — test a 40-char no-space title does not overflow the tile (assert the class is present; visual check in Task 14).
- **Scroll container** (review M6): `.school-books__grid { overflow-y: auto; max-height: calc(100vh - <header+footer>) }` inside the locked body which is `overflow: hidden`.
- `history ›` bottom-right, `.school-books__history-link`, min 52px tall (review m4 — nothing actionable smaller than the panel's own minimum).
- `History.jsx`: same tiles, finished/set-aside only, grouped by month of the terminal event, read-only.

Commit — `feat(school-ui): shelf, tiles, history`.

---

## Task 13 (DONE — `60fddd9ab`, check-ins copy in `8dd057562`): Frontend — `UpdateBook` and `AddBook` overlays

**Files:**
- Create: `frontend/src/modules/School/books/UpdateBook.jsx`, `AddBook.jsx`
- Test: `UpdateBook.test.jsx`, `AddBook.test.jsx`

**`UpdateBook`**: per mode — `page` → `NumberPad maxLength=4 label="What page are you on?" submitLabel="Save"`; `minutes` → `NumberPad maxLength=3 label="How long did you read?"`; `check` → single button `I read some today`. `I finished it` → opens `DayPicker` (collapsed on today; confirm posts `finished` with `finishedOn`). `set it aside` → **52px min-height button** (review m4), visually subdued. Mode switch: tapping the bar/caption opens a 3-button chooser → `setMode`. Tests: right control per mode; finish posts `{kind:'finished', finishedOn: today}`; set-aside posts `set-aside`.

**`AddBook`**: step `number` → `NumberPad maxLength=13 allowX label="Type the number under the barcode" submitLabel="Look it up"`, `hint`/`canSubmit` from the hook's length-gated validation; step `lookup` shows a spinner and *Looking it up…* (no dead screen on a slow network); step `cover` shows cover/title/author/description with `Yes`/`No` and, for `duplicateOf`, *You've already got this one* + `Open it`; step `where` = three doors; `page` = NumberPad; `when` = DayPicker. Tests: every hint sentence renders for its reason; `not-found` and `unavailable` render their sentences and `unavailable` keeps the digits.

Commit — `feat(school-ui): UpdateBook and AddBook overlays`.

---

## Task 14 (DONE — `7fd7c8a26`; 14b review fixes in the commit that carries this line): Mount branch in `SchoolApp` + launch test

**Files:**
- Modify: `frontend/src/modules/School/selfService/useSelfService.js` — `launchTarget()` carries `bookGrant: effect.bookGrant ?? null` (14b); test `useSelfService.launchTarget.test.js`
- Modify: `frontend/src/modules/School/SchoolApp.jsx` — beside the `rubiks-cube` branch (`:456-462`):
  ```jsx
  if (target?.kind === 'program' && target.program === 'book-log') {
    const learnerId = launchedLearnerId ?? target.learnerId ?? null;
    if (!target.bookGrant || !learnerId) return false;
    setBookLaunch({ learnerId, bookGrant: target.bookGrant });
    openSection('book-shelf');
    return true;
  }
  ```
  and render `<BookShelf learnerId={bookLaunch.learnerId} grant={bookLaunch.bookGrant} idleTimeoutSeconds={…same source as lock…} onExit={…} />` where the cube program is rendered (`:861`).
- Test: `frontend/src/modules/School/SchoolApp.launch.test.jsx` — add a case mirroring the cube one: a `program: 'book-log'` target with `bookGrant` mounts `BookShelf`; without `bookGrant` returns false.

Run `npx vitest run frontend/src/modules/School/SchoolApp.launch.test.jsx` → green. Commit — `feat(school-ui): mount the reading shelf from a book-log launch`.

As built (deviations from the sketch above, each for a measured reason):
- **Rendered beside the ladder and the reels, not the cube.** `RubiksCubeProgram` sits inside the `!lock.locked` wrapper, which never paints on a locked panel — and the shelf's one real path is the locked wall panel. It renders where `SentenceLadderProgram`/`LanguageReelsProgram` do, outside that wrapper, gated `section === 'book-shelf' && !active && bookLaunch && bookLaunch.learnerId === currentUser?.id` (the reels' guard).
- **The locked-panel `Done` overlay is not drawn over the shelf** (`section !== 'book-shelf'` joins `!courseId`): the shelf carries its own always-visible Done, and the overlay sits bottom-right, where the shelf's `history ›` link is.
- `bookLaunch` is cleared in `goHome` (the cube's is not) — the grant is a credential and leaves with the workspace — and in the identity-change effect with the cube's.
- Launch logs `schoolLog.bookShelf('launch', { learnerId })`, never the grant. Refusals return a bare `false` like the cube (the keypad keeps its card up).
- Section label `Reading`.
- **The `launchTarget` hop (14b, BLOCKER).** `useSelfService.launchTarget()` rebuilds the program target field-by-name, and `bookGrant` was not on the list — so the keypad path (the shelf's only real path; `BookLogProgramLauncher.launch()` is inert and nothing broadcasts `school.launch` for `book-log`) always reached `SchoolApp` grantless: the card said *Opening it here on the screen* over a `mount.refused`. Fixed by adding `bookGrant: effect.bookGrant ?? null` (no spread; the allowlist stays deliberate). Pinned in `useSelfService.launchTarget.test.js` with the wire shape `RunSelfServiceAction` sends (`{ ...target, programId, unitId, learnerId }`).
- Refusals log `schoolLog.bookShelf('launch-refused', { reason: 'no-grant' | 'no-learner' })` (14b) — never the grant.
- **Lapse dead-end (14b).** The 10-minute identity lapse nulled `bookLaunch`, the guard hid the shelf, and `section` stayed `'book-shelf'` with the locked Done overlay excluded — a blank wall with no exit. The identity effect now calls `goHome()` when it finds a `bookLaunch` for another learner, which returns the locked panel to the keypad.
- Test: `SchoolApp.launch.test.jsx` stubs `BookShelf` (records props) and the cube, and wraps the real `useSchoolLaunch` to expose `claim`/`onLaunch`, so the boolean `onPortalLaunch` returns is asserted directly. Direct cases: grant+learner mounts the shelf (props `learnerId`, `grant`, `idleTimeoutSeconds === DEFAULT_IDLE_TIMEOUT_SECONDS`, `onExit` a function; cube absent; log without the grant); no grant → `false`, `launch-refused` logged, `launch-unroutable` not; no learner anywhere → the same with `no-learner`. Keypad cases (14b), through the real `Keypad` + `useSelfService` on `mode="locked"` with only `selfServiceResolve`/`selfServiceAct` faked to the wire shapes (`ResolveAccessCode`: `{ ok, learner: '<id>', subject, title, sentence, ...projection }`): resolve → act → mount renders the shelf with the grant, no `mount.refused`, no keypad behind it and no second Done; the shelf's `onExit` returns the keypad; an 11-minute clock jump plus one touch (the lapse is judged on the next input) returns the keypad, not a blank wall.

---

## Task 16: Docs — commit the corrections (already applied in-tree)

The design doc (§2 grant handshake + idle knob, §3 obligation-line window word + captions,
§4/§5 `NumberPad`, length gate, fourth reason, no TTS, day-picker rows, §6 routes and the
`program` token, §7 facades) and the PRD (§6 architecture, `itemId` shape, component inventory,
decisions 12–16 + the tidy-up list) were edited during execution and sit unstaged. Remaining:
`git rev-parse HEAD > docs/docs-last-updated.txt`, then commit
`docs(books): align design doc and PRD with what shipped`.

## Decision needed: the shelf shares the `english` subject with curriculum (final review M1)

Measured with `planDailyAgenda` on a plan holding an available English lesson plus
the `book-log:shelf` entry (both `timingPriority: 3`): the lesson wins the tie, so the
reading code opens the lesson first and the shelf is reachable only once the lesson
passes; and a met `checkins/day` obligation marks English `servedToday`, which hides
that day's English lesson. `SUBJECT_IDS` has no `reading`, so the shelf cannot sit
under a subject of its own without extending the enum. The enrolled learner has no
English curriculum today, so neither effect bites yet. Options, for the grown-up to
pick: (a) leave as is and document lesson-before-shelf; (b) give the shelf entry a
`timingPriority` that loses on purpose and stop `doneToday` from serving the subject;
(c) add `reading` to `SUBJECT_IDS` and default the program there.

## Task 17: Enroll <learner> — AFTER deploy, never before

**Why the order matters:** enrollments live in the Dropbox-synced data tree that prod reads
live. Writing this before the code is deployed makes prod's agenda throw `no launcher
registered for program "book-log"` and fault <learner>'s English row (review B1).

**Facts (measured):** learner id `<learner>`; plan file `<household>/school/plans/learners/<learner>.yml`
currently holds ONE program (`piano-course`, `plex:675689`, weekdays), `assignedBy: kckern`,
`updatedAt: '2026-08-31T01:35:21.993Z'`. He is not on story-time. The write is
`PUT /api/v1/school/lifecycle/assignments/<learner>` (`routers/schoolLifecycle.mjs:655`), body
`{ courses, units, programs, assignedBy, pin, baseUpdatedAt }` — it **replaces** `programs`,
so send his existing entry plus the new one. The grown-up pin is enforced inside
`SetAssignments`; ask the user for it.

**The enrollment.** "Any logging event satisfies it, even the same page as yesterday" is the
`checkins` metric exactly: it counts distinct study days holding any non-`set-aside` event
(`started`, `progress`, `finished`), regardless of page delta.

```json
{ "programs": [
    { "programId": "piano-course", "corpusId": "plex:675689", "courseId": "plex:675689",
      "subject": "arts", "title": "Hoffman Academy lesson", "schedule": { "daysOfWeek": [1,2,3,4,5] } },
    { "programId": "book-log", "corpusId": null, "subject": "english", "title": "Reading",
      "obligation": { "metric": "checkins", "quantity": 1, "per": "day" },
      "schedule": { "daysOfWeek": [1,2,3,4,5] } }
  ],
  "assignedBy": "kckern", "pin": "<ask>", "baseUpdatedAt": "<<learner>.yml updatedAt at the time>" }
```

**Verify e2e on prod after enrolling:** print/preview <learner>'s agenda → English row shows
the reading program, not `program_unavailable`; type his reading code at the panel → the
shelf mounts; add a book by ISBN → confirm → partway → page; next day, log the SAME page →
`obligationProgress.actual` for `checkins` is 1 and the row reads done.

## Task 15 (runs LAST, after Task 17): Playwright flow — the goal's e2e

**Why last:** there is no seeded school data to test against — the demo generator
(`tests/_infrastructure/generators/setup-household-demo.mjs`) writes fitness, finance,
calendar and users only, never `school/plans/learners`. And enrolling any learner locally
writes into the Dropbox tree that **prod reads live**, which faults that learner's agenda
until the launcher is deployed (review B1). So the honest e2e is the real one: <learner>'s real
reading code, on a dev server running the deployed code, after Task 17.

**File:** `tests/live/flow/school/reading-shelf.runtime.test.mjs`

**Preconditions (all measured):**
- Code merged to `main` and deployed; <learner> enrolled (Task 17).
- A dev server on this laptop: check `lsof -i :{env.ports.app}` first; if nothing, `npm run dev` (the
  documented laptop dev instance on 3111/3112 — this is NOT the forbidden second backend,
  which means a second instance on the same host as prod).
- <learner>'s reading code: `POST /api/v1/school/lifecycle/learners/<learner>/agenda` mints the day's
  codes; read the English section's code from `accessCodesByToken` in the response. Do NOT
  use `/agenda/preview` — it substitutes a placeholder code (`BuildAgenda.mjs:357`).
- The panel: the School app **defaults to locked** in a plain browser
  (`SchoolApp.jsx:17`, `browserModeFromUrl() ?? 'locked'`), so navigating to the school URL
  from `tests/_fixtures/runtime/urls.mjs` lands on the keypad. No query needed.
- No existing keypad/self-service Playwright flow to mirror — `tests/live/flow/school/`
  holds teacher and media-lesson flows; take the harness shape from those and the
  selectors from `selfService/Keypad.jsx` / `LaunchCard.jsx`.

**Flow, every step asserted, no conditional asserts (per `docs/ai-context/testing.md`):**
keypad visible → type the code → shelf mounts (learner chip shows <learner>) → `+` → type
`9780064400558` → cover card shows *Charlotte's Web* → `Yes` → *I'm partway through* →
`84` → `Save` → shelf tile shows `p. 84` and a bar → `Done` → keypad again.
Then the goal's own condition: re-enter the code → tap the same tile → type `84` again →
`Save` → `GET /api/v1/school/books/<learner>/shelf` (with the grant from the mount effect, or
via the launcher's `status()` through the agenda endpoint) reports `obligation.actual === 1`
for `checkins` — the same page as before still counts as today's check-in.

Commit — `test(school): reading shelf e2e — code, add, page, repeat-page counts as a check-in`.

## Final review fixes (DONE — as built)

Eight findings from the branch's final review, one commit each: **M2** `checkIsbn` stays
`typing` at ten, eleven and twelve digits unless the entry ends in `X` or the caller passes
`{ submit: true }`; the hook lights `Look it up` at ten and thirteen and `lookup()` judges ten
on the tap (the first ten of a thirteen-digit number pass the ISBN-10 checksum 1 in 11 times).
**M3** both book adapters take `timeoutMs` (default 8000) and pass it to `HttpClient.requestRaw`
as the abort timeout — a timeout is a thrown provider failure `ResolveBook` already reports as
`unavailable`; `back()` on the lookup step bumps the generation and returns the pad with the
digits. **m1** `OpenBookShelfItem` and `RecordBookProgress` take a required `dayOf` (the
launcher's, wired in `schoolLifecycle.mjs`) and judge "not in the future" on the study day,
never the UTC date (PRD decision 16 rewritten). **m2** `GetBookShelf` returns `studyDay:
dayOf(now)` (it now takes `clock`), the hook exposes `studyDay`, and `BookShelf` seeds both
DayPickers from it, `localDayKey()` being the fallback for a server that said nothing. **m5**
`projectShelfItem.daysRead` counts every non-`set-aside` event, the set `measureObligation
('checkins')` counts. **n3** a grant is valid only while `Number.isFinite(exp) && exp > now`.
**n4** `DayPicker`'s toggle, cells and confirm spread `useTapFire`. **n1** the identity-lapse
effect's narrow deps carry a comment naming the test that pins them.

## Done when

- `npx vitest run backend/src/2_domains/books backend/src/1_adapters/books backend/src/3_applications/books backend/src/2_domains/school/bookLog.test.mjs backend/src/2_domains/school/bookShelf.test.mjs backend/src/3_applications/school/BookLogProgramLauncher.test.mjs backend/src/3_applications/school/usecases/OpenBookShelfItem.test.mjs backend/src/3_applications/school/usecases/RecordBookProgress.test.mjs backend/src/1_adapters/persistence/yaml/YamlBookLogStore.test.mjs backend/src/1_adapters/persistence/yaml/YamlBookRepository.test.mjs backend/src/1_adapters/school/actions/HmacSchoolBookGrantIssuer.test.mjs backend/src/4_api/v1/routers/books.test.mjs backend/src/4_api/v1/routers/schoolBooks.test.mjs frontend/src/modules/School/books tests/unit/tooling/auditLayerImports.test.mjs tests/unit/tooling/auditDirectFsImports.test.mjs` is green.
- `npm run check:parse` passes.
- Task 17 done (deployed, <learner> enrolled), then the Task 15 Playwright flow passes against the laptop dev server.
- The branch `books/shelf` is ready to merge into `main` (no PR — house rule), then delete the branch and record it in `docs/_archive/deleted-branches.md`.
