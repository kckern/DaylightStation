# The teacher's reading admin — observe, correct, and account for a child's shelf

**Status:** design, 2026-09-06. Depends on the v2 storage model
(`2026-09-06-book-log-data-model-redesign.md`), which must land first.
**Home:** `/school/teacher/students/:learnerId/reading` — a new learner-scoped
workspace beside Day, Courses, History, Reports and Operations.
**Authority:** `teacher.md` §1 tiers. Capability for corrections; step-up for
the two verbs that change whose record it is or whether it exists.

---

## 1. What this is

A grown-up needs three different things from a child's reading record, and only
one of them is repair:

1. **Observe** — what is this child reading, how much, how consistently, and is
   the obligation being met? This is the daily question and it is not an
   intervention.
2. **Correct** — the child typed 250 instead of 25, tapped "finished" on the
   wrong book, scanned the wrong barcode, forgot to log Tuesday.
3. **Account** — who changed what, when, and why; and undo it if it was wrong.

The panel gives a child a workspace. This gives a grown-up the same thing over
the same data, with the authority, the audit trail, and the honesty rules the
rest of the teacher console already holds to.

---

## 2. The screen

```
┌──────────────────────────────────────────────────────────────┐
│ ← User_4 · Reading                            [Add a book] │
├──────────────────────────────────────────────────────────────┤
│  THIS WEEK          4 of 7 days      ▐▓▓▓▓▓▓▓▓▓░░░░░░▌      │
│  Reading now 2 · Finished this year 11 · Set aside 1         │
├──────────────────────────────────────────────────────────────┤
│  READING NOW                                                 │
│  ┌────┐ Hatchet · Gary Paulsen              p.84 / 184  ⋯    │
│  │cvr │ page mode · last logged Sep 3 · 6 days read          │
│  └────┘ ▐▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░▌                             │
│  ┌────┐ Frindle · Andrew Clements           3h 20m      ⋯    │
│  │cvr │ minutes mode · last logged Sep 5 · 4 days read       │
│                                                              │
│  FINISHED                                    [show all 11]   │
│  ┌────┐ The Hobbit · J.R.R. Tolkien     finished Sep 2  ⋯    │
│                                                              │
│  SET ASIDE                                                   │
│  ┌────┐ Wonder · R.J. Palacio          set aside Aug 28 ⋯    │
└──────────────────────────────────────────────────────────────┘
```

One row per **reading** — one child's pass through one book, at one time. Two
readings of the same book are two rows and always were two records; v2 stops
pretending otherwise.

`⋯` opens the reading's detail. The detail is where every verb lives, so the
list stays scannable and no destructive control sits under a browsing thumb.

### The reading detail

```
┌──────────────────────────────────────────────────────────────┐
│  Hatchet · Gary Paulsen                          [Done]      │
│  ISBN 9781423133384 · 184 pages · page mode                  │
│  Opened Sep 1 · Reading · furthest page 84 (46%)             │
│  ── Identity ──────────────────────────────────────────────  │
│  ISBN     [9781423133384        ] (re-look-up)               │
│  Mode     ( ) page  (•) minutes  ( ) check-in                │
│  Length   [184  ] pages                                      │
│  ── What was read ─────────────────────────────────────────  │
│  Sep 3   page 84                          [edit] [delete]    │
│  Sep 2   page 48                          [edit] [delete]    │
│  Sep 1   started                                             │
│                                    [+ add a day they read]   │
│  ── State ─────────────────────────────────────────────────  │
│  ( ) Reading   ( ) Finished on [____]   ( ) Set aside        │
│  ── Danger ────────────────────────────────────────────────  │
│  [Move to another child]            [Delete this reading]    │
│  ── History ───────────────────────────────────────────────  │
│  Sep 6 10:02  KC  changed the finish day  Sep 5 → Sep 2      │
│               "logged it late"                    [undo]     │
└──────────────────────────────────────────────────────────────┘
```

Four bands, in order of how often they are used and inverse order of
consequence: identity, evidence, state, danger. History last, because it is
read after the fact rather than during a correction.

---

## 3. Every verb

| Verb | Touches | Tells the child | Gate |
|---|---|---|---|
| correct the ISBN | `book.isbn`, re-resolves title/cover | no | capability |
| change the progress mode | `progressMode` | no | capability |
| correct the page count | `book.pageCount` | no | capability |
| fix a page number | `entries[id].page` | no | capability |
| change the day something was read | `entries[id].on` | **only if it leaves the counted window** | capability |
| add a day they read | append an entry, `source: teacher` | no | capability |
| delete an entry | remove `entries[id]` | **yes** | capability |
| mark finished / change the finish day | `status`, `finishedOn` | no | capability |
| un-finish | `status` → `reading` | **yes** | capability |
| set aside / put back | `status` | no | capability |
| add a book on the child's behalf | new reading, `source: teacher` | no | capability |
| **move to another child** | `learnerId` (moves between files) | **yes, both children** | **step-up** `books.reading.reassign` |
| **delete the reading** | removes it | **yes** | **step-up** `books.reading.delete` |
| undo an entry in the history | inverse of that revision | inherits the verb it undoes | inherits |

**The notification rule: did the child's own record get smaller?** A deleted
entry, an un-finish, a re-date that drops out of the counted window, a move to a
sibling, a deleted reading — each requires a reason and delivers it. A corrected
ISBN or page count says nothing, because there is nothing a child needs to know.

This is invariant 1 of `teacher.md` applied where it means something rather than
uniformly. A feed of "a grown-up fixed the page count" teaches a child to ignore
the feed, and then the sentence that matters arrives in the same stream.

**Two step-ups, both new**, and both need adding to `STEP_UP_ACTIONS` server-side
before the console may ask for them — the list is closed, and asking for a grant
the server cannot mint returns 403 (`teacher.md` §1). They earn it for the same
reason `sessions.reassign` and a superseding report-card close do: one changes
whose record it is, the other destroys the record.

---

## 4. Undo

**Per reading, linear, from that reading's own `revisions` list.** A global undo
across the shelf would let one grown-up rewind past another's later edit on a
different book.

Undo is not a stack pointer — it is a verb. Undoing revision *n* computes and
applies its inverse and **appends a new revision** saying so. The history grows;
it never rewinds. That means:

- Undoing an undo is just another undo, and reads correctly in the list.
- An undo that would tell the child (because it makes the record smaller) tells
  them, with the same reason requirement as the original verb.
- Nothing is ever removed from history, so "who changed this and when" survives
  every correction of a correction.

Redo is therefore not a separate concept: it is undoing the undo. The UI may
label it `redo` when the last revision is itself an undo; the mechanism is one.

**What cannot be undone:** a move to another child, once the receiving child has
logged against it. The reading is theirs now and rewinding it would delete their
evidence. The history says so instead of offering a button that lies.

---

## 5. Reads — the routes

All under `/api/v1/school/teacher/learners/:learnerId/reading`, all
capability-gated. (`learners`, not `students`: every learner-scoped teacher API
route already reads `/teacher/learners/:learnerId/…` — timeline, courses,
answer-sheets, agenda dispatch. The console's own URL keeps saying `students`;
the two vocabularies already differ and one more split inside the router would
be a second convention to remember. The `GET /` half is built.)

| Route | Answers |
|---|---|
| `GET /` | the whole workspace: readings grouped by status, the obligation, the counts, each with its projection |

`GET /` is served by the SAME `GetBookShelf` the child's grant-gated panel
reads, gated through `TeacherGate` (`action: books.shelf.read`, context the
URL's learner) with the acting teacher read off the capability session — a GET
carries no body to name them, exactly as the artifact postview read does.
| `GET /:readingId` | one reading with every entry and its full `revisions` list |
| `PATCH /:readingId` | identity and state fields — ISBN, mode, pageCount, status, finishedOn |
| `POST /:readingId/entries` | add a day they read |
| `PATCH /:readingId/entries/:entryId` | fix a page, minutes, or the day |
| `DELETE /:readingId/entries/:entryId` | remove one entry — reason required |
| `POST /:readingId/undo` | invert a named revision |
| `POST /` | add a book on the child's behalf |
| `POST /:readingId/reassign` | move to another child — **step-up**, reason required |
| `DELETE /:readingId` | delete the reading — **step-up**, reason required |

**Every write carries `baseRevisionCount`** — the length of the revisions list
the editor loaded. A stale save is refused with a reload message rather than
clobbering, matching `baseUpdatedAt` on assignments and `baseSeq` on grade
adjustments (`teacher.md` invariant 5). Two grown-ups on two devices is not
hypothetical in this household.

**Reads never write** (invariant 7). Re-resolving an ISBN to check a cover is a
read of the book cache; it does not mutate the reading until the teacher saves.

---

## 6. Failure states

Per invariant 6, every panel fetches independently across
`loading | error | empty | unavailable | ok`, and one dead endpoint never blanks
the page.

| Condition | What the workspace shows |
|---|---|
| the shelf file cannot be read | a named error with the server's own sentence, and **no edit controls** — a damaged year of evidence must never present as an empty shelf a grown-up can start "fixing" |
| the child has no readings | `empty` — "No books yet", plus **Add a book** |
| the books API is not wired | readings render titleless with their ISBNs; every verb still works |
| a cover fails to load | the calm placeholder the panel already uses; never an invented one |
| the learner is not on the roster | the console's existing "Student not found" screen |

---

## 7. Invariants this surface holds to

1. **A reading is one child's pass through one book at one time.** Not a book,
   not a child's relationship with a book. Two readings of one title are two
   records with two histories.
2. **Nothing is destroyed without a reason that reaches the child** — where the
   record got smaller.
3. **Every write is attributed**, and the attribution outlives the edit.
4. **Undo appends.** History never rewinds.
5. **A stale save is refused, never merged.**
6. **The teacher edits the same records the child does** — there is no shadow
   teacher copy, and no field only one of them can see.
7. **Observation costs nothing.** Reading the workspace opens no session, mints
   no code, writes no event.

---

## 8. Deliberately not in this pass

- No bulk edit across readings. Every correction names one record.
- No teacher-authored reading assignments — that is the obligation in
  `school.yml`, not this surface.
- No notes or ratings on a reading; the child's own reflection surface owns those.
- No merging two readings into one. It sounds tidy and it is destructive:
  two passes through a book are two facts.
