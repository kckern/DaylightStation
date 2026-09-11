# The reading log — a child's books, on paper, on the panel, and in the console

> **Status:** current as of 2026-09-06. This is the durable reference; the
> dated files in `docs/_wip/plans/` are the point-in-time record of how it got
> here and why particular decisions were reversed.

A child reads a physical book off-screen and records it themselves: type the
number off the back once, then say what page they are on and, eventually, that
they finished. A grown-up can see all of it and correct any of it.

This is **not** the living-room story-time feature. That one is
[`reading-sessions.md`](reading-sessions.md): a preschooler taps an NFC card,
the TV plays screen-resident content, and the natural end credits the read. The
two share a name and nothing else — different surfaces, different evidence,
different stores. The comparison table at the end says which is which.

---

## 1. The four surfaces

| Surface | Who | Where |
|---|---|---|
| **The shelf** | a child | the school wall panel, `frontend/src/modules/School/books/` |
| **The printed card** | a child | the daily agenda, on thermal tape |
| **The workspace** | a grown-up | `/school/teacher/students/:learnerId/reading` |
| **The CLI** | an operator | `cli/school/booklog.cli.mjs` |

---

## 2. The unit: a reading, not a book

**A shelf record is one child's pass through one book, at one time.** The book
and the learner are attributes of it. Reading the same book twice is two
records with two histories — which the household's real data already contained
before the model admitted it.

This was got wrong once and cost a redesign. The original key was
`learner:isbn:entryId`, which welded three mutable facts into an identifier:
correcting a mis-scanned ISBN made the id disagree with its own record, and
moving a book to the sibling who actually read it was structurally impossible,
because the store parsed the learner back out of the id to choose which file to
write. The audit is `_wip/plans/2026-09-06-book-log-data-model-redesign.md`.

### The stored shape

`<household>/school/records/books/{learnerId}.yml`, `schema: school.book-log/v2`:

```yaml
readings:
  - id: rdg_…                  # opaque, stable, never parsed
    learnerId: learner_a       # a FIELD — the file is chosen by it
    book: { isbn: "978…", pageCount: 184 }
    progressMode: page         # page | minutes | check
    status: reading            # reading | finished | set-aside
    openedOn: "2026-09-01"     # study day
    finishedOn: null
    entries:
      - id: ent_…
        on: "2026-09-03"       # the study DAY the reading happened
        at: "2026-09-03T19:02:11.004Z"   # when it was RECORDED
        page: 84               # or minutes, or neither (a check-in)
        source: panel          # panel | teacher | import
        idempotencyKey: "…"    # the client's retry key
    revisions:
      - { id, by, at, verb, op, before, after, reason, toldChild }
```

Four properties carry the design:

- **`on` and `at` are different questions.** "I finished it Friday" logged on
  Sunday is two facts, and one field could not hold both. Before the split,
  `noonOf()` fabricated a noon instant and a backdated finish falsified
  `openedAt` so the two would not contradict each other.
- **Entries are addressable**, so a grown-up can name the row to fix.
- **Status is stored, not inferred.** It used to be a function of array
  position: `set-aside` held only while it was the last event.
- **Reads stay derived.** Furthest page, percent, days read and last-touched
  are recomputed on every read by `projectReading`, so there is no second copy
  of the truth to disagree with the rows it came from.

**The store reads v1 and writes v2.** A v1 file is mapped on read and never
written back; a write against one takes a `.v1.bak` first. `booklog.cli.mjs
migrate` converts deliberately, dry-run by default, and refuses to write a
conversion whose readings do not project **identically** to the originals —
status, page, percent, daysRead, and every obligation measurement.

---

## 3. The child's shelf

### Three doors, one shelf

| Door | The child has | It asks |
|---|---|---|
| **The printed code** | a slip the agenda printed | six digits |
| **A scanned barcode** | the book | who is reading it |
| **The panel door** | neither | who they are |

Only the first costs paper. The other two exist because "I am holding a book I
want to log" should not begin with fetching a printout.

**The code opens the shelf directly.** A reading code used to resolve to a
launch card whose entire content was one button reading "Open Reading" over a
"Go back" — asked of a child who had just spelled out, in six digits, the
sentence that button said. The backend marks such a card
`presentation.openImmediately` and the panel runs its single action instead of
rendering it, so the child goes keypad → shelf.

**A scan never takes a screen someone is using.** The panel knows whether it is
busy — resting on the keypad with nothing running, nothing typed and nothing in
flight, or not — and a scan that lands on a busy panel does not interrupt. It
offers instead: a corner card naming the book, with a way in and a way out. The
intent lives on the server for five minutes, so the offer is real rather than a
notice; taking it clears the panel and hands over to the same "who's reading
this?" question an idle scan asks, so that question has one home. Leaving a
graded run asks first, in the card itself — a locked panel draws no header, so
the confirm cannot live where the apple's does.

This replaced a dead end. The corner state used to be one sentence with no
button behind it, while the claim path refused outright whenever the panel was
busy; a child's only recovery was to finish what they were doing and scan the
book again.

**The panel door is the mirror of a scan.** A reading icon beside the day board
asks who is reading, takes one tap on a face, and opens that child's shelf at
the ISBN pad. It is a door beside the board rather than a row on it: the board
is deliberately non-interactive, and it draws nothing at all on a settled-empty
day — which is exactly when a child most needs the way in.

That door skips everything the printed code proves: possession of paper, a cap
of twelve uses, a wrong-guess throttle, and the "is this you?" re-ask. What
pays for it is the clock. A shelf opened by tapping a face gets a grant good
for **twenty minutes**, not the printed card's eight hours — long enough to
type a number and save a page, short enough that a grant left behind on a
hallway screen is worth nothing by the time anyone finds it. The other bound is
the roster: the server, not the client, decides that the learner named is one
of today's.

The door stands wherever the School panel does, the browser mount included —
the same place the printed-code keypad already opens a shelf. It briefly also
required the request to name the configured panel, which was theatre: the
client names its own screen, so that check turned nobody away except the app's
own browser mount.

The rule is narrow on purpose: exactly one action, and that action a `program`.
A printing card also carries one button, and auto-running it would fire a
thermal printer at a child who typed their code to see what was next. And it is
never set alongside `confirmIdentity` — that question exists to ask whose paper
this is *before* anything records against them, so a re-entered code still stops
to ask.

`useBookShelf.js` owns the whole state machine; the components paint. Its four
rules, each earned:

1. **A late response may not reopen a closed card.** The panel is shared, and
   `Done` and the 90-second idle close both fire with requests in flight.
   Every `await` is followed by a generation check, or the next child sees the
   previous child's books.
2. **The number is judged before the network, behind a length gate.** A
   malformed ISBN never costs a round trip. Ten digits are the trap — the first
   ten of a thirteen-digit number pass the ISBN-10 checksum one time in eleven.
3. **Every write is idempotent.** The client mints the key before the write, so
   a double tap or a retry appends once.
4. **A failed write loses nothing.** The digits stay, the fault is named in the
   server's own words, and the next tap retries with the same key.

**The pad has no lookup button.** A finished number is its own instruction, so
the pad acts on it — and the two lengths are not the same claim:

- **Thirteen digits** are a number a child read off a book. The checksum
  settles it and nothing is left to confirm, so a short settle and it goes.
- **Ten digits** are a guess, for the reason above. The pad asks the catalog
  *at once* — hiding the round trip under the typing — but acts on the answer
  only after a second of quiet, and only on a real catalog hit. An eleventh
  digit cancels it.

**A catalog hit is the confirmation, at ten digits.** Thirteen digits carry a
`not-found` through to the honest-placeholder confirmation, because thirteen
digits name a book whether or not the catalog knows it. Ten cannot: a number
that only passes the checksum is as likely the front of someone's thirteen, and
that names nothing. So a miss at ten moves nobody and — just as deliberately —
accuses nobody, since the child may still be typing. It offers **Use this
number** instead, the one button this pad ever shows, and the only way an older
book the catalog lacks still gets logged.

**Two field-driven corrections, 2026-09-06.** A `Clear number` button sat above
the `3` and fired on pointerdown; a child wiped a half-typed ISBN four times in
88 seconds. Clearing now lives behind a 600ms hold on backspace. And the three
"where are you with it" doors were stacked text bars a pre-reader could not
tell apart; they are square tiles with icons.

---

## 4. The printed card

The card is no longer the only way in (see §3), but it is still the one that
travels: it names a book, it can be read at the kitchen table, and it works
when nobody is standing at the panel.

The agenda prints a reading card for **every** learner, enrolled or not — an
enrollment carries an obligation, not access. It is a full lesson card
(`presentation: 'lesson'`), because from a schoolwork point of view the reading
log is another course.

- **It headlines the book nearest the end** — highest percent, falling back to
  most recently touched, because percent is null for minutes-mode, check-mode,
  and any book with no page count. Ties break on id so a reprint names the same
  book as the sheet on the fridge.
- **One card, never two.** On a day the obligation is unmet the shelf is
  already the section card; the standalone card stands down.
- **The taxonomy needs four non-empty strings** — a short one fails
  `validateDocument` for the whole agenda, and the ESC/POS renderer prints
  `Course · / Unit · / Lesson ·` from it, which is the only text an operator
  ever reads about the card.
- **The code is capped at 12 uses**, not shortened in time. A slip left on the
  counter was worth unlimited opens (one code was typed thirteen times in five
  hours), but a log is genuinely repeatable. The two expiry clocks are
  deliberate and documented in `tokens.mjs`: **do not align them.**

---

## 5. The grown-up's workspace

`/school/teacher/students/:learnerId/reading` — observe, correct, account for.
Full verb table in
`_wip/plans/2026-09-06-teacher-reading-admin-design.md` §3.

**Every write appends a revision** — who, when, what changed, why, and whether
the child was told. Nothing is edited without a trace.

**Five verbs tell the child, and the test is whether their own record got
smaller:** a deleted entry, an un-finish, a re-date out of the counted window, a
move to a sibling, a deleted reading. Each requires a reason, delivered through
`RecordTeacherNote` to the panel's Feedback list and the agenda's "Notes for
you". Correcting an ISBN says nothing — a feed of "a grown-up fixed the page
count" teaches a child to ignore the feed the sentence that matters arrives in.

**Two verbs cost a step-up PIN:** `books.reading.reassign` and
`books.reading.delete`. Both halves are wired — the action name *and* its
resource scoping — because a name in the Set with no resource requires nothing
at all, and looks exactly like a step-up that works.

**Undo is a verb, not a stack pointer.** It applies the inverse and appends a
new revision, so history grows and never rewinds; undoing an undo needs no
second mechanism. Three things refuse rather than lie: a move the receiving
child has since logged against, an already-undone revision, and adding a book —
whose inverse is destroying the record, and which would let a capability-only
undo do a step-up verb's work.

**The console decides nothing the server already decides.** `GET /:readingId`
serves the counted window an obligation is measured over — as
`{state: 'window' | 'none' | 'unknown', per, from, to}`, so "this child owes no
reading" is distinguishable from "the obligation could not be read" — and it
serves, on each revision, whether it can be undone and the refusal's own
sentence. Both come from the functions the write path itself uses
(`obligationWindow`, `readingEdits.mjs#undoRefusal`). The console had copies of
each; a copy of "does this shrink the child's record?" is a copy free to drift,
and the window copy went SILENT — stopping asking for a reason entirely — the
moment a shelf read carried no obligation.

**A grown-up can open a book for a child**, and it is a SHELF verb rather than
one of the detail's bands — it makes a reading that does not exist yet, so it
carries no `baseRevisionCount` and no reason, and the child is told nothing: a
book appearing on their shelf is their record getting bigger. It asks exactly
what the child's own add flow asks — the number off the back, and where they
are with it (starting, partway with a page, finished on a day) — and answers it
in ONE call, so a book cannot land on the shelf with half the answer applied.
Three things differ from the child's door, all deliberately: the day is stamped
`source: teacher`, the book's length is resolved server-side rather than typed,
and the child's backdate floor does not apply, because repairing a record from
months ago is what this surface is for. The empty shelf offers it, since that is
when the first book gets added.

**An unreadable shelf shows a named error and no edit controls.** A damaged
year of a child's evidence presented as "no books yet" invites a grown-up to
start fixing a file that was merely unreadable.

---

## 6. Obligations

An enrollment may carry one, and `obligation: null` is a complete, valid
enrollment — the shelf works with none. The grammar is four metrics × a
quantity × a window × an optional scope: `20 pages a day`, `2 books a week`,
`check in daily`, `read this series`. Which days count belongs to
`validateSchedule`, not here.

`doneToday` means **nothing owed today**, not "finished with books" — the shelf
never closes, and the reading code has no per-day cap for the same reason.

---

## 7. Not the same as story time

| | Reading log | Story time |
|---|---|---|
| Surface | school wall panel | living-room TV + NFC reader |
| Identity | access code → signed grant | personal NFC card → session |
| What is read | a physical book, self-reported | screen-resident media |
| Evidence | `school/records/books/{learner}.yml`, per learner | reading log, sharded by study day |
| Unit | a reading, spanning days | one read = one day's count |
| Launcher | `BookLogProgramLauncher` | `StoryTimeProgramLauncher` |

Nothing on this page moves when story time changes. The living-room launch
card's 2026-09-11 rebuild — today leading the shelf, an empty slot per story
owed, the idle window drawn on the live slot, the reopen grace after an idle
teardown — is entirely
[`reading-sessions.md`](reading-sessions.md#the-launch-card--the-shelf-and-the-slot-the-next-book-goes-into).
The wall panel's own empty-slot affordance is a different element with a
different job, and it is [`reading-shelf.md`](reading-shelf.md).

---

## Where each piece lives

| Piece | Path |
|---|---|
| Domain: projection, obligation, selection | `backend/src/2_domains/school/bookShelf.mjs`, `bookLog.mjs` |
| Store (v1 read, v2 write) | `backend/src/1_adapters/persistence/yaml/YamlBookLogStore.mjs` |
| Child use cases | `3_applications/school/usecases/{GetBookShelf,OpenBookShelfItem,RecordBookProgress}.mjs` |
| Teacher use cases | `3_applications/school/usecases/teacher/` |
| Agenda card | `2_domains/school/documents/receipts.mjs`, `usecases/BuildAgenda.mjs` |
| Book resolution | `3_applications/books/ResolveBook.mjs`, `1_adapters/books/` |
| Child panel | `frontend/src/modules/School/books/` |
| Teacher workspace | `frontend/src/modules/School/teacher/panels/ReadingShelfPanel.jsx` |
| HTTP | `4_api/v1/routers/{books,schoolBooks,school.teacherReading}.mjs` |
| CLI | `cli/school/booklog.cli.mjs` |

## Related

- [`reading-sessions.md`](reading-sessions.md) — the living-room story-time machine
- [`teacher.md`](teacher.md) — authority tiers, the console's state space, invariants
- [`enrollment.md`](enrollment.md) — how a program enrollment is materialized
