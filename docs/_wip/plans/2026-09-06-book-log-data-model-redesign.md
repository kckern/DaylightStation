# The book log's data model — audit and redesign

**Status:** audit + proposed v2, 2026-09-06. Not implemented.
**Trigger:** the teacher console needs full CRUD over a child's shelf, and every
verb it needs lands on something the current model cannot express.
**Verdict:** the storage shape is wrong in four specific, nameable ways. Three
of them are the same mistake — **mutable facts welded into an identifier**.

---

## 1. What the model is today

`<household>/school/records/books/{learnerId}.yml`:

```yaml
items:
  - itemId: "learner_a:9781423133384:9db5f5c2-3a3c-4560-880f-fb6ec3d4059d"
    bookId: "9781423133384"
    progressMode: check
    pageCount: null
    openedAt: "2026-09-01T14:22:09.114Z"
    events:
      - { kind: started,  at: …, entryId: 9db5f5c2-… }
      - { kind: progress, at: …, page: 84, entryId: … }
      - { kind: finished, at: …, entryId: … }
```

Status, furthest page, percent, days read and last-touched are all derived on
read by `projectShelfItem` (`bookShelf.mjs:212`). **That part is right** and
should survive: there is no second copy of the truth to disagree with itself.

---

## 2. Defect 1 — the identifier embeds three mutable facts

`itemId` is `` `${learnerId}:${bookId}:${entryId}` `` (`YamlBookLogStore.mjs:160`).
Two of those three parts are facts that legitimately change, and the third is a
key borrowed from a different job.

**A shelf item is not a book. It is one child's pass through a book, at one
time — a *reading*.** The book, the child, and the day are attributes of a
reading, not its identity. The current key says the opposite.

What it costs, concretely:

| The teacher wants to | Why the id blocks it |
|---|---|
| fix a wrong ISBN (scanned the wrong barcode) | `bookId` is inside the id. Change it and the id lies; keep the id and it disagrees with its own record |
| move a book to the sibling who actually read it | `learnerId` is inside the id — **and `learnerFromItemId()` parses it back out to choose the file to write to** (`YamlBookLogStore.mjs:178, 209`). A move is structurally impossible without minting a new id and orphaning every reference |
| understand two readings of one book | Both ids differ only by a UUID tail, while both name the book as identity. The re-read works, but by accident of the suffix |

The re-read case is the clean proof. A child reads Hatchet in September and
again in March. Those are two readings — different dates, different pages,
possibly different progress modes, each with its own finish. They share nothing
but a book. A key that puts the ISBN in the identity of both is describing the
wrong noun.

**`entryId` is doing two unrelated jobs.** It is the client's idempotency key
(a retried POST must not log a book twice — the right and load-bearing reason
append-only exists here) *and* the third component of the item's identity.
Those have nothing to do with each other, and coupling them is why
`openItem` had to grow the collision comment at `YamlBookLogStore.mjs:29`.

---

## 3. Defect 2 — evidence rows have no identity

An event's `entryId` is `entryId ?? null` (`YamlBookLogStore.mjs:198`) — nullable
by construction. So an individual page log, check-in, or finish **cannot be
addressed**. The only handle is its array index, which moves when anything is
inserted or removed.

Every teacher verb in the request — *change the date on that check-in*, *fix
that page number*, *delete the one they fat-fingered* — needs to name one row.
Today none of them can.

---

## 4. Defect 3 — "when it happened" and "when it was recorded" are one field

Every event carries a single `at`. But a child logging on Sunday that they
finished on Friday means two different facts, and the model has one slot.

The workarounds are already in the tree and they are load-bearing:

- `noonOf(day)` (`bookShelf.mjs:44`) fabricates a fake instant — noon UTC — so a
  chosen day survives a timezone. It is a real function existing to paper over a
  missing field.
- `OpenBookShelfItem` stamps `openedAt` to the finish day for a backdated
  finish (`:105`), deliberately falsifying when the item was opened so the two
  do not contradict each other.
- `MAX_BACKDATE_DAYS = 14` bounds how far the fiction may reach.

With `on` (the study day it happened) and `at` (the instant it was recorded) as
separate fields, "logged late" is representable honestly, the backdate bound
becomes a policy on `on` rather than a defense of a fiction, and `noonOf`
disappears.

---

## 5. Defect 4 — status is inferred from array position

```js
const status = finished ? 'finished'
  : (last?.kind === 'set-aside' ? 'set-aside'
    : (events.length > 0 ? 'reading' : 'unread'));
```

`set-aside` is true only while it is the **last** element. `finished` is
computed by `finishFacts` scanning for a `finished` that no later `reopened`
cancels. So the lifecycle state of a child's book is a function of array order.

Consequences:
- A teacher cannot *set* a state; they can only append an event whose position
  produces the state they want, and hope nothing lands after it.
- `reopened` exists solely to negate `finished` — an event kind whose only job
  is to cancel another event kind, which is the correction-event pattern
  arriving through the back door.
- The furthest-page rule (`Math.max` over event pages, `bookShelf.mjs:229`) is
  deliberate and good for a child re-reading a chapter — but it means a
  fat-fingered `250` is **permanent**. There is no page value a teacher can add
  that lowers it. Only deleting the row helps, and §3 says rows cannot be named.

---

## 6. The v2 shape

```yaml
schema: school.book-log/v2
readings:
  - id: rdg_01JQ8F3K2M4N7P              # opaque, stable, never parsed
    learnerId: learner_a                   # a FIELD — the file is chosen by it
    book:
      isbn: "9781423133384"             # an attribute; correcting it is an edit
      pageCount: 184                    # THIS copy's length
    progressMode: page                  # page | minutes | check
    status: reading                     # EXPLICIT: reading | finished | set-aside
    openedOn: "2026-09-01"              # study day
    finishedOn: null                    # study day, set when status is finished
    entries:
      - id: ent_01JQ8F9R                # addressable
        on: "2026-09-03"                # the study DAY the reading happened
        at: "2026-09-03T19:02:11.004Z"  # the instant it was RECORDED
        page: 84                        # or minutes, or neither (a check-in)
        source: panel                   # panel | teacher | import
        idempotencyKey: "b1f0…"         # the client's retry key. One job now.
    revisions:
      - { id, by, at, verb, before, after, reason, toldChild }
```

### What each change buys

| Change | Unlocks |
|---|---|
| Opaque `id`; `learnerId` and `book.isbn` as fields | reassign to a sibling and correct an ISBN become field writes. Re-reads are simply two readings that share a book |
| `entries[].id` | every teacher verb that names one row |
| `on` vs `at` | honest backdating; `noonOf` and the falsified `openedAt` both retire |
| explicit `status` + `finishedOn` | a teacher sets a state instead of appending an event that implies one. `reopened` retires |
| `idempotencyKey` separated from identity | the retry guarantee survives with none of the identity coupling |
| `revisions[]` | history, undo, audit — additive, no fold, no precedence rules |

### What deliberately does not change

- **Derived reads stay derived.** Furthest page, percent, days read and
  last-touched remain computed by `projectShelfItem`. Status becomes stored
  because it is a *decision* (a child or a grown-up declares it), not a
  measurement.
- **Idempotency stays.** A retried POST appends nothing. This was always the
  real reason the write path is careful, and it is untouched.
- **Dated evidence stays a list.** `measureObligation` asks windowed questions —
  pages this week, checked in today — and those cannot be answered from scalars.
- **Sharded by learner**, still. A book spans days; every question worth asking
  is about a learner across time.

---

## 7. Teacher CRUD on top of v2

Every verb from the request, and what it touches. Nothing here needs a
correction-event vocabulary.

| Verb | Operation | Tells the child? | Gate |
|---|---|---|---|
| fix the ISBN / cover | `book.isbn` = … | no | capability |
| change progress mode | `progressMode` = … | no | capability |
| fix the page count | `book.pageCount` = … | no | capability |
| fix a page number | `entries[id].page` = … | no | capability |
| change a date | `entries[id].on` = … | **only if it leaves the counted window** | capability |
| add a missed check-in | append an entry, `source: teacher` | no | capability |
| delete a stray log | remove `entries[id]` | **yes** | capability |
| un-finish / re-finish | `status`, `finishedOn` | **yes on un-finish** | capability |
| set aside / resume | `status` | no | capability |
| move to a sibling | `learnerId` = … (moves files) | **yes** | **step-up** `books.reading.reassign` |
| delete the whole reading | remove the reading | **yes** | **step-up** `books.reading.delete` |
| undo / redo | apply the inverse of a revision, append a revision | inherits the underlying verb | as the verb |
| see the history | render `revisions[]` | — | capability |

**The rule for telling the child:** did their own record get *smaller*? A
removed check-in, an un-finish, a re-date that drops out of the counted window,
a move to a sibling, a deleted reading — each owes a required reason, delivered.
A corrected ISBN or page count says nothing.

**Undo is per-reading and linear**, from that reading's `revisions`. A global
stack across a child's shelf would let one teacher rewind past another's later
edit on a different book.

---

## 8. Migration

Volume is tiny — single-digit readings for two learners today — but the data
tree is **shared and Dropbox-synced, so a migration goes live the moment it
runs**. That is the risk, not the record count.

1. **Reader tolerates both.** `YamlBookLogStore` detects `schema:` and maps v1
   into the v2 in-memory shape. v1 files keep working, untouched, indefinitely.
2. **A CLI converts, one learner at a time**, writing a `.v1.bak` beside each
   file first. `itemId` → a fresh opaque `id`; `at` → `on` = its study day plus
   `at` verbatim; the derived status at conversion time → the explicit `status`;
   `entryId` → `idempotencyKey`; a synthetic `revisions` entry recording the
   conversion.
3. **Verify by projection equality**: for every reading, `projectShelfItem` over
   v1 and over the converted v2 must produce identical status, page, percent,
   daysRead and lastAt. A mismatch aborts that learner and leaves v1 in place.
4. **Only then** does the write path stop emitting v1.

The one irreversible step is renaming ids, so nothing may store a `readingId`
until step 4 completes.

---

## 9. Honest scope note

This redesign is worth doing **because the teacher surface is being built now**.
On its own the v1 shape works for the child's panel — it has been logging real
books for two learners without complaint. What it cannot survive is a second
consumer that edits. Building CRUD on v1 means correction events, fold
precedence in every reader, and ids that lie; that is the expensive path, and it
gets more expensive the longer the teacher console exists.
