# The reading shelf — School-side UI design

**Status:** design, awaiting review
**Date:** 2026-09-02
**Builds on:** `2026-09-02-books-domain-prd.md` (the domain, the obligation grammar, the
launcher and the store — all implemented, 201 tests green)
**Scope:** the frontend a child touches, and the three routes it needs

---

## 1. What it is

A child types the reading code on the wall panel and gets **their shelf**: the books they
are partway through, as cover tiles, with `+ Add a book` as the last tile and `history ›`
tucked in the corner. Tapping a book asks one question matched to that book's
`progressMode`. Tapping `+` walks through number → cover → *where are you with it*.

Two decisions taken in the brainstorm shape everything else:

1. **Shelf first, add is one tile.** Most days a child is updating a book they already
   have, so the common case is one tap with no instructions to read.
2. **Three doors, then detail.** After confirming a cover: *starting it* / *partway* /
   *already finished*. Each path asks only for what it needs; a child starting a book
   never meets a date picker.

---

## 2. How it mounts — no new surface

The panel's flow is unchanged and the shelf rides its existing extension point:

```
child types code
  → POST /self-service/resolve        → launch card
  → POST /self-service/act            → { outcome: 'mount',
                                          effect: { kind: 'program', program: 'book-log',
                                                    learnerId } }
  → launchTarget(action, effect)      (useSelfService.js)
  → onPortalLaunch(target, learnerId) (SchoolApp.jsx)
  → if (target.program === 'book-log') mount <BookShelf learnerId=… />
```

That last line is **one branch beside `rubiks-cube`, `flashcards` and `language-reels`**
at `SchoolApp.jsx:434–476`. On the backend, `BookLogProgramLauncher.issueLaunchTarget`
mints a signed **`bookGrant`** (`HmacSchoolBookGrantIssuer`, the cube grant's twin with its
own context and purpose) and `RunSelfServiceAction` spreads it into the mount effect, so
the effect carries `{ kind: 'program', program: 'book-log', learnerId, bookGrant }`.

### The one deliberate departure: it is a workspace

Every other panel action is *one action, then close*. The shelf is a place a child stays —
updating a page, adding a book, glancing at history — so it needs an exit the others do
not, and it has to guard against the hazard the others never face.

**The walk-away hazard.** A shelf left open on a shared wall panel is one child's books
with another child's hands on them — the same misattribution the domain refuses to guess
about (PRD §5.3 S14, tier 3). Two guards, both house pattern:

| Guard | Behaviour | Precedent |
|---|---|---|
| **`Done`** | always visible, top-right, returns the panel to the keypad | every panel card |
| **Idle close** | `idleTimeoutSeconds` from the same lock config the panel already reads (`SchoolApp`: prop → screen config → default), reset on any tap, no exemptions | The panel's own card timer only runs while a card is up; a mounted runner has none, so the shelf owns its timer — but on the existing knob, not a new constant |

### Identity is the grant's, never the client's

`/act` locks the panel before the runner mounts, so there is no session for the routes to
read. Instead every shelf request carries the mount's `bookGrant` in `X-School-Book-Grant`;
the router verifies it against the URL's learner and then acts for **the learner named in
the grant's payload** — the body's `learnerId`, if any, is discarded. The client cannot name
a learner; it can only act as the one whose code opened the card.

---

## 3. The shelf view

```
┌──────────────────────────────────────┐
│  Reading · <learner>               Done  │
│  14 of 20 pages today                │   ← only when an obligation exists
│                                      │
│  ┌────────┐ ┌────────┐ ┌────────┐    │
│  │[cover] │ │[cover] │ │   +    │    │
│  │Hatchet │ │Frog &  │ │  Add   │    │
│  │▓▓▓░░░░ │ │Toad    │ │ a book │    │
│  │ p.84   │ │read 12d│ │        │    │
│  └────────┘ └────────┘ └────────┘    │
│                                      │
│                          history ›   │
└──────────────────────────────────────┘
```

- **Tiles, not rows.** The cover is the recognition cue; a child finds *Hatchet* by its
  picture. Laid out for a **~500 px cover, never upscaled** (PRD B14) — most of what a
  young child reads has no better art, and a layout tuned to a large cover looks broken
  across the shelf. A book with no cover gets the calm placeholder the launch card already
  uses, never an invented one.
- **The caption is the mode's own number**, straight from `projectShelfItem`:

  | `progressMode` | caption |
  |---|---|
  | `page` | progress bar + `p. 84`; `Just started` while no page is logged; no bar when the record had no page count |
  | `minutes` | `3h 20m` (the projection carries integer minutes; the tile only formats) |
  | `check` | `read on 12 days` |

  The tile derives nothing — status, page, percent and days come from `projectShelfItem`
  on the server; formatting a duration is the one thing it does itself.
- **Order:** most recently touched first.
- **Obligation line:** one line under the header, shown only when the shelf's `obligation`
  is non-null, from the launcher's `progressLabel` **plus the window word** — `14 of 20 pages
  today`, `1 of 2 books this week`, `… this month`, nothing for `once`. The launcher's label
  carries no window (a weekly target would otherwise read identically to a daily one), and it
  is non-null even without an obligation (`No books yet`, `2 reading · 1 finished`), which is
  why the line keys on `obligation`, not on the label. No colour, no nag — it is information,
  and an unenrolled child simply does not get the line. A book whose mode cannot satisfy the metric carries a small
  `doesn't count toward pages` tag (PRD A4), so a bar that moved while the number did not
  is explained rather than mysterious.
- **Empty shelf:** the `+` tile alone, captioned `Add your first book`.
- **`history ›`**, bottom-right, visually quiet. Finished and set-aside books as the same
  tiles with a date in place of a bar, grouped by month. Nothing on it is editable — it is
  the year's bookshelf, not a work surface.

Tapping a tile opens §4; tapping `+` opens §5. Both are overlays; `‹ back` returns to the
shelf, which is home for the whole session.

---

## 4. Updating a book

```
┌──────────────────────────────────┐
│ ‹ back                     Done  │
│                                  │
│ [cover]  Hatchet                 │
│          ▓▓▓▓▓▓▓░░░░░  84 / 195  │
│                                  │
│   What page are you on?          │
│          ┌───────┐               │
│          │  1 1 2│               │
│          └───────┘               │
│        │1│2│3│  │4│5│6│  …       │
│                                  │
│   [ Save ]      [ I finished it ]│
│                                  │
│           set it aside           │
└──────────────────────────────────┘
```

One control, matched to the mode:

| Mode | Control | Prompt |
|---|---|---|
| `page` | `NumberPad` — Keypad's vocabulary, not its behaviour (Keypad auto-submits at a fixed length and empties on submit) | *What page are you on?* |
| `minutes` | same pad | *How long did you read?* |
| `check` | no pad; one button | *I read some today* |

- **The pad starts empty**, not prefilled with the last page. A child should type what
  they see, not edit a number.
- **`I finished it`** is one tap: appends `finished`, returns to the shelf, the tile moves
  to history. The optional reflection prompt (PRD §5.4 — voice memo or a star) can follow
  later and is **never blocking**.
- **`set it aside`** is deliberately small and low on the card. It is a real outcome
  (PRD S8), not a failure, but not the thing a thumb lands on.
- **Mode switch** is one tap on the bar area — *This book doesn't have pages* → choose
  `minutes` or `check`, via `POST /shelf/:itemId/mode`. Never rewrites history (PRD S6c).
- **Validation is gentle.** A page beyond the total is accepted and the bar clamps
  (PRD S7a — editions differ; refusing "212 of 184" tells a child holding the book they are
  wrong). Blank or zero on `Save` says *type a page or tap "I read some today"*. Nothing
  here can error a child.
- **Every write is idempotent.** The client mints an `entryId` when the overlay opens and
  sends it with the save; a double-tap or a retried request appends once
  (`IBookLogStore` contract).

---

## 5. Adding a book

### Step 1 — the number

`NumberPad` at 13 digits with an `X` key, labelled *Type the number under the barcode*.
**No search box** (PRD B9). A client-side port of the ISBN rules (`isbn.js`) runs on every
keystroke, **behind a length gate** — under thirteen characters is still typing and shows no
hint, so the sticker sentence cannot fire on the first digit and *one digit is off* cannot
fire on the tenth. Ten digits are the trap: the first ten of a thirteen-digit number pass
the ISBN-10 checksum one time in eleven, so a per-keystroke verdict at ten would light
`Look it up` on the wrong book. Instead, ten digits light the button with no verdict, and
the **tap** judges them as an ISBN-10 (`checkIsbn(entry, { submit: true })`) — either
looking the book up or showing *one digit is off*; ten characters ending in `X` (a check
character only an ISBN-10 has) are judged on the keystroke. Eleven and twelve keep the
button dark with no sentence; thirteen is judged as it lands:

| `reason` | What the child reads |
|---|---|
| `isbn13-checksum`, `isbn10-checksum` | *Check that number — one digit is off* |
| `not-a-book-prefix`, `not-an-identifier` | *That's the library's sticker. Flip the book over.* |
| valid | `Look it up` lights up |

A failed lookup keeps the digits on the pad; `NumberPad` never empties on submit.

An ISBN-10 typed off a copyright page is accepted and converted (PRD B1).

### Step 2 — the cover

`GET /api/v1/books/resolve?id=` runs `ResolveBook`. The card shows cover, title, author,
description. *Is this your book?* — `Yes` / `No`. `No` clears the number and returns to
the pad.

The four resolve outcomes get four different sentences, on purpose:

| `status` | Copy |
|---|---|
| `ok` | the card |
| `not-found` | *We couldn't find that one — ask a grown-up to add it* |
| `unavailable` | *Can't look books up right now — try again in a minute* + `Retry` |
| `invalid` | never reaches here; caught in step 1 |

**Duplicate guard:** if that ISBN is already `reading` on this shelf, the card says
*You've already got this one* and offers to open it. A re-read after `finished` is allowed
and opens a fresh item (PRD S9).

### Step 3 — where are you with it

```
┌──────────────────────────────────┐
│ [cover] Hatchet · Gary Paulsen   │
│                                  │
│  ┌──────────────────────────┐   │
│  │  I'm just starting it    │   │
│  ├──────────────────────────┤   │
│  │  I'm partway through     │   │
│  ├──────────────────────────┤   │
│  │  I already finished it   │   │
│  └──────────────────────────┘   │
└──────────────────────────────────┘
        ↓ partway            ↓ finished
 ┌──────────────┐   ┌────────────────────┐
 │ What page?   │   │ When did you?      │
 │   ┌─────┐    │   │ (Today)(Yesterday) │
 │   │ 84  │    │   │ (Last week)(Earlier)│
 │   └─────┘    │   └────────────────────┘
 └──────────────┘
```

- **Starting it** → `openItem` with a `started` event. Done.
- **Partway** → the page pad → `openItem` + one `progress` event.
- **Already finished** → *When did you finish it?* — the day picker below. The chosen
  day becomes the `at` on the `finished` event **and** the item's `openedAt`.

### The day picker — a rolling three weeks, weekday first

Not a calendar. A calendar grid is laid out for adults finding a date; a child remembers
*"it was Saturday"* and works forward from there. So the weekday leads, the date of the
month is the small print, and the rows **never break at a month boundary** — a child does
not think in months and a row that stops at the 31st is a row with a hole in it.

Collapsed, it is one answer — today — with a `pick a day ›` to open the rest:

```
┌──────────────────────────────────┐
│  When did you finish it?         │
│                                  │
│      ┌──────────────────┐        │
│      │  Today · Wed 2   │        │
│      └──────────────────┘        │
│                                  │
│           pick a day ›           │
└──────────────────────────────────┘
```

Opened, it is the last three weeks, most recent row at the bottom, **today marked and
already selected**, future days absent rather than greyed:

```
┌────────────────────────────────────────────┐
│  When did you finish it?                   │
│                                            │
│   Mon   Tue   Wed   Thu   Fri   Sat   Sun  │
│                                            │
│   10    11    12    13    14    15    16   │   ← three weeks back (Mon Aug 10)
│   17    18    19    20    21    22    23   │
│   24    25    26    27    28    29    30   │
│   31     1   [ 2 ]                         │   ← this week; Aug 31 is Monday, [2] Wed = today
│                                            │
│   Aug ··· Sep                              │   ← month is a quiet footnote
│                                            │
│          [ That's the day ]                │
└────────────────────────────────────────────┘
```

- **Weekday is the headline**, once, across the top — not repeated in every cell.
- **The month is a footnote**, shown only where it changes (`Aug ··· Sep`), so a row
  spanning the 31st and the 1st reads as one week, which it is.
- **Three weeks, rolling.** Long enough for *"I finished it a couple of weeks ago"*, short
  enough to fit a wall panel with tappable cells. Anything older is not a thing a child is
  logging from memory; a grown-up backfilling a summer's reading is the teacher surface's
  job, not this pad's.
- **Today is pre-selected and visually marked** (the bracketed cell), so a child who opens
  the grid by mistake can just tap *That's the day* and lose nothing.
- **Weeks start Monday**, matching `schoolCalendar`'s ISO weekday convention
  (`1 = Monday … 7 = Sunday`) so the shelf and the schedule agree about what a week is.
- **Cells are one tap, large, and carry the full day as an `aria-label`** — *"Sunday 30
  August"*. The panel has no speech (its ceremony is a WebAudio tone), so reading the day
  aloud for pre-readers is a `TODO(a11y)` in the component, not a claim.

The picker is a plain component with no date library: it takes `today` as a study-day key
and renders 21 keys backwards from it. The same component serves the update view's
*I finished it* when a child says they finished it earlier than today.

**A backdated finish never counts toward today.** `measureObligation` reads each event's
own timestamp, so a book finished *last week* lands in last week's window, exactly as it
should. This falls out of the domain for free; the UI has nothing to enforce.

`progressMode` is inferred at open (`page` when the record has a page count, else `check`;
never `minutes` — PRD S6a) and shown on the shelf tile, where it can be switched.

---

## 6. Backend routes

Three new routes under `/api/v1/school/books`, all learner-scoped from the session, plus
one proxy:

| Route | Does | Backed by |
|---|---|---|
| `GET /shelf` | items + projections + obligation line | `IBookLogStore.listForLearner` → `projectShelfItem`; `BookLogProgramLauncher.status` for the label |
| `POST /shelf` | open an item: `bookId`, `entryId`, `where` (`starting`\|`partway`\|`finished`), `page?`, `finishedOn?` (a study day), `progressEntryId?` — the server resolves the book, infers the mode, stamps `openedAt` (now, or the finish day for a backdated finish) | `OpenBookShelfItem` → `IBookLogStore.openItem` (+ `appendEvent`) |
| `POST /shelf/:itemId/progress` | one event: `kind`, `page?`, `minutes?`, `finishedOn?`, `entryId` — `at` is never client-supplied | `RecordBookProgress` → `IBookLogStore.appendEvent` |
| `POST /shelf/:itemId/mode` | `progressMode` | `RecordBookProgress.setMode` → `IBookLogStore.setProgressMode` |
| `GET /api/v1/books/resolve?id=` | the lookup | `ResolveBook` |

Three use cases sit between routes and store — `GetBookShelf` (projections, facts, the
obligation line, days counted by the launcher's own `dayOf`), `OpenBookShelfItem` and
`RecordBookProgress` — so validation lives once, off the router. The routers import from
neither the domain nor the application layer (the layer audit forbids it), receive everything
by injection, and throw rather than translate: the app's error handler maps `ValidationError`
to 400 and answers every error as `{ ok:false, error:{ type, message, code }, traceId }`.

**The reading code says what it wants.** The daily agenda mints <learner>'s english code with
`continueToday: true` *and* `program: 'book-log'`; both resolvers (typed code and scanned QR)
share one `findContinuationEntry` that reads the plan's entries and prefers the named
program — so a served reading code reopens the **shelf**, while a "One more?" receipt (no
`program`) still opens a lesson.

---

## 7. Frontend structure

```
frontend/src/modules/School/books/
  BookShelf.jsx          the runner SchoolApp mounts; owns Done + the idle timer
  ShelfTile.jsx          one cover + caption; placeholder when no cover
  UpdateBook.jsx         §4 overlay
  AddBook.jsx            §5 three-step overlay
  History.jsx            the hidden view
  useBookShelf.js        state: shelf, add-flow step machine, idle timer, entryId minting
  isbn.js                client-side ISBN check with the length gate + the copy table
  NumberPad.jsx          the pad (explicit submit, retained entry, variable length, X)
  DayPicker.jsx / dayGrid.js   the rolling three-week picker + its pure grid
  (API calls live on schoolApi.books; logging on schoolLog.bookShelf — no new facade files)
```

`useBookShelf` mirrors `useSelfService`'s shape — a small explicit state machine with a
generation guard, so a request resolving after `Done` cannot re-open a closed card — the
exact bug `useSelfService`'s header documents.

**Logging from the start**, per CLAUDE.md: `school.book-shelf.opened` /
`.closed{reason: done|idle}`, `.lookup{status}`, `.item-opened`, `.progress{kind, mode}`,
`.add.rejected{reason}` (the local-validation copy that fired), `.cover.unresolved`.

---

## 8. Testing

| Layer | What |
|---|---|
| Unit | `useBookShelf` step machine; the local-validation copy table; the idle timer; entryId minting |
| Component | `AddBook` renders the right sentence for each `parseBookIdentifier` reason and each resolve `status`; `UpdateBook` shows the right control per mode; `DayPicker` renders a row that crosses a month boundary as one row, pre-selects today, and emits no future days |
| Launch | a `SchoolApp.launch` test beside the existing ones: `program: 'book-log'` mounts `BookShelf` with the learner |
| Route | the three shelf routes refuse a body-supplied learner and use the session's |
| Playwright | one flow: code → `+` → 13 digits → cover → *partway* → page → shelf shows the bar |

Discipline per `docs/ai-context/testing.md`: no vacuous passes, no conditional assertions.

---

## 9. Deliberately not in this pass

- **The barcode scanner and unclaimed tray** — PRD phase 2b. The shelf is built so a
  `book` scan inside an open session can drop straight into step 2 later.
- **Voice/typed reflection on `finished`** — PRD §5.4. The hook is the non-blocking prompt
  after `I finished it`.
- **Grown-up assignment authoring** (scoping a series) — a teacher-gate surface, and the
  only place `SearchBooks` is ever reachable.
- **Audiobookshelf minutes** flowing in automatically — PRD R3; the event model already
  carries `source` and `externalId` for it.
