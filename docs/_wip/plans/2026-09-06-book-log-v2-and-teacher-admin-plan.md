# Book log v2 + teacher reading admin — implementation plan

> **For Claude:** REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** Re-key the shelf on an opaque reading id, give evidence rows identity and
honest dates, then build the teacher workspace that edits all of it.

**Architecture:** `2_domains/school/bookShelf.mjs` gains a v2 reading shape whose
projection is the current one minus the array-order inference. `YamlBookLogStore`
reads v1 and v2, writes v2. A CLI converts, verified by projection equality. The
teacher API is a thin router over one use case per verb; the console gets one new
learner-scoped route.

**Reference:** `2026-09-06-book-log-data-model-redesign.md` (the audit and the v2
shape), `2026-09-06-teacher-reading-admin-design.md` (the surface, verbs, gates).
Read both. They record decisions taken with the user; do not re-derive them.

**Hard rules for every task:**
- **No real child names** in code, tests, fixtures, comments or docs. Use
  `learner_a`, `test-user`. The repo convention is `User_4`.
- Worktree only; never `npm test` (use `npx vitest run <path>`); never bypass hooks.
- One commit per task, conventional prefix, ending with the Co-Authored-By and
  Claude-Session trailers.

---

## Phase A — the v2 shape in the domain (pure, no I/O)

### Task A1: `readingFrom` — one reading, projected

**Files:** `backend/src/2_domains/school/bookShelf.mjs`, its co-located test.

`projectShelfItem` today infers `status` from array position (`finished` via a
`finishFacts` scan for an uncancelled `finished`; `set-aside` only while it is the
LAST event). v2 stores `status` explicitly, so the projection stops inferring it.

Add `projectReading(reading, { dayOf })` returning
`{ status, page, percent, minutes, daysRead, lastOn, lastAt }`:
- `status` comes from `reading.status` verbatim — no inference.
- `page` stays **furthest** (`Math.max`) over entries. Keep the 212-of-184
  comment; the rule is right and only became a trap because rows could not be
  edited. They can now.
- `percent` from `reading.book.pageCount`, clamped, same as `percentFor`.
- `daysRead` counts DISTINCT `entry.on` values — no `dayOf` mapping needed,
  because `on` is already a study day. That is the point of the field.
- `lastOn` is the latest `on`; `lastAt` the latest `at`. Both, because "when did
  they last read" and "when was this last touched" are different questions and
  the teacher view shows both.

Keep `projectShelfItem` untouched and exported — v1 files still flow through it
until Phase B finishes.

Tests: status is passthrough (all three values); furthest page survives a lower
later entry; percent clamps; `daysRead` counts days not entries; a reading with
no entries; junk never throws.

### Task A2: obligation measurement over v2

`measureObligation` currently walks `item.events` and maps `event.at` through
`dayOf`. Add the v2 path: walk `reading.entries` and use `entry.on` directly.

The four metrics (`pages`, `minutes`, `books`, `checkins`) and the window
arithmetic are unchanged. `books` counts readings whose `status === 'finished'`
and whose `finishedOn` falls in the window — no more scanning for a `finished`
event that no `reopened` cancels.

Tests must pin that a v1 item and its v2 conversion measure IDENTICALLY for each
metric and window. That equality is what Phase B's migration verifies against.

---

## Phase B — the store

### Task B1: read both, write v2

**File:** `backend/src/1_adapters/persistence/yaml/YamlBookLogStore.mjs`

- `#load` detects `schema: school.book-log/v2`. A file without it is v1 and is
  mapped to the v2 in-memory shape on read (see B2's mapping) but **not written
  back** — reads stay non-mutating.
- `openReading({ learnerId, isbn, idempotencyKey, openedOn, progressMode, pageCount })`
  mints `id: rdg_<ulid>`, `status: 'reading'`, `entries: []`, `revisions: []`.
  Idempotency: an existing reading whose `entries` or own `idempotencyKey`
  matches returns unchanged, exactly as `openItem` does today.
- `appendEntry({ readingId, on, page, minutes, source, idempotencyKey })` mints
  `id: ent_<ulid>`. Dedupe on `idempotencyKey`.
- `updateReading({ readingId, patch, revision })` and
  `updateEntry({ readingId, entryId, patch, revision })` — set fields, push the
  revision.
- `deleteEntry`, `deleteReading`, `moveReading({ readingId, toLearnerId, revision })`.
  **The move writes the destination file FIRST and only then removes from the
  source**, matching the attempt-reassignment rule in `teacher.md` §10: a corrupt
  destination refuses the move rather than half-completing it.
- **`learnerFromItemId` is deleted.** Every write takes `learnerId` explicitly.
  This is the defect the redesign exists to remove; leaving the parser would
  leave the coupling.

Keep the `#enqueue` serialization and the damaged-file-is-loud rule verbatim.

### Task B2: the migration CLI

**File:** `cli/school/booklog.cli.mjs` (new), `migrate` subcommand.

Per learner: back up to `{learnerId}.v1.bak`, convert, then **verify by projection
equality** — for every reading, `projectShelfItem(v1Item)` and
`projectReading(v2Reading)` must agree on status, page, percent, daysRead, and the
obligation measurement for each metric. A mismatch aborts that learner, leaves v1
in place, and reports which reading and which field.

Mapping:
| v1 | v2 |
|---|---|
| `itemId` | a fresh `rdg_<ulid>`; the old id recorded in the conversion revision |
| `bookId` | `book.isbn` |
| `pageCount` | `book.pageCount` |
| `openedAt` | `openedOn` = its study day |
| derived status | `status`, and `finishedOn` from the uncancelled `finished` event's day |
| `events[]` minus `started`/`reopened`/`set-aside` | `entries[]`, `on` = study day of `at`, `at` verbatim |
| `entryId` | `idempotencyKey` |
| — | one `revisions` entry recording the conversion |

`started` becomes `openedOn`; `set-aside`/`reopened` become `status` — they are
state changes, not evidence, which is why they were distorting `daysRead`.

**Dry-run by default**, `--apply` to write, one learner at a time. The data tree is
shared and Dropbox-synced: a migration is live the moment it runs.

### Task B3: switch the callers

`OpenBookShelfItem`, `RecordBookProgress`, `GetBookShelf`, `BookLogProgramLauncher`
(`status` and `featuredBook`) move to the v2 store methods and `projectReading`.
`noonOf` and the `openedAt`-falsification in `OpenBookShelfItem` are deleted —
a backdated finish now sets `finishedOn` and leaves `openedOn` truthful.

The panel's own routes and `useBookShelf` keep their wire shape: `itemId` becomes
the reading id, which the client already treats as opaque.

---

## Phase C — the teacher API

### Task C1: use cases

One per verb, in `backend/src/3_applications/school/usecases/teacher/`:
`GetLearnerReadings`, `UpdateReading`, `AddReadingEntry`, `UpdateReadingEntry`,
`DeleteReadingEntry`, `AddReadingForLearner`, `MoveReading`, `DeleteReading`,
`UndoReadingRevision`.

Each: validates, writes a `revisions` entry (`by`, `at`, `verb`, `before`, `after`,
`reason`, `toldChild`), and — where the record got SMALLER — delivers a
child-readable note through the same path review notes and settle reasons use.

**The notification rule:** deleted entry, un-finish, a re-date that leaves the
counted window, a move, a deleted reading. Those five require a reason and deliver
it. Everything else is silent and still logged.

**`baseRevisionCount`** on every write; a stale value is refused with a reload
message, never merged (`teacher.md` invariant 5).

### Task C2: the router + gates

`backend/src/4_api/v1/routers/teacherReading.mjs`, routes per the design doc §5.
All capability-gated. Two new entries in `TeacherCapabilitySessions.mjs#STEP_UP_ACTIONS`:
`books.reading.reassign` (scoped to `readingId`) and `books.reading.delete`
(scoped to `readingId`).

**The Set and `teacherResource` must agree** — `requiresTeacherStepUp` derives from
the resource being non-null, so a name in the Set with no resource branch requires
nothing at all. `teacher.md` §1 says a step-up that silently buys a free pass looks
exactly like one that works. Add both halves, and test the gate refuses without a
grant.

---

## Phase D — the console

### Task D1: the route and the shelf view

`/school/teacher/students/:learnerId/reading`, registered beside Day/Courses/
History/Reports/Operations. The workspace per design doc §2: obligation strip,
then readings grouped `reading` / `finished` / `set-aside`, one row each with
cover, title, author, mode, progress and last-read.

Five fetch states (`loading | error | empty | unavailable | ok`), panels fail
alone. **An unreadable shelf shows no edit controls** — a damaged year of evidence
must never present as an empty shelf a grown-up starts "fixing".

### Task D2: the reading detail and its verbs

Four bands in this order — identity, evidence, state, danger — then history.
Every verb from design doc §3. Destructive verbs arm first with a sentence naming
the consequence, matching the console's two-tap rule for structural changes.

### Task D3: history and undo

Render `revisions` newest-first: who, when, what changed, from → to, the reason,
and whether the child was told. `Undo` on each. Undo appends a new revision; it
never rewinds the list. A move that the receiving child has since logged against
is not undoable — say so in place of the button.

---

## Definition of done

- [ ] A reading is identified by an opaque id; `learnerFromItemId` no longer exists
- [ ] Two readings of one book are two records with two histories
- [ ] Every entry is addressable, and `on` / `at` are separate fields
- [ ] Migration verified by projection equality, with a `.v1.bak` beside each file
- [ ] Every teacher verb works, is attributed, and is undoable
- [ ] The five shrinking verbs deliver a reason to the child; the rest are silent
- [ ] Two new step-up actions, both with a resource, both tested
- [ ] No real child names anywhere in the diff
