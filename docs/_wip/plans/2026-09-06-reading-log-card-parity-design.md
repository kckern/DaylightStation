# The reading log as a course — printed card parity

**Status:** design, validated 2026-09-06, revised the same day after an
adversarial review against the code. Not yet implemented.
**Builds on:** `2026-09-02-books-domain-prd.md`, `2026-09-02-book-shelf-ui-design.md`
**Scope:** the printed agenda card, the code it carries, and the one naming
authority every reading surface reads. No change to the shelf panel UI.

---

## 1. What is wrong today

The reading log prints as a bare box: a label, a QR, six digits. Every other
thing a child is asked to do that day prints as a *lesson card* — subject glyph,
breadcrumb, unit line, title, description, progress bars, a footer verb naming
the action.

The cause is one line of vocabulary. `readingLogAction`
(`backend/src/2_domains/school/documents/receipts.mjs:210`) builds a plain
`scan_action`; `lessonAction` (same file, line 53) builds
`presentation: 'lesson'`. The reading card was built from the notice shape and
has been wearing it since.

**The governing decision: from a schoolwork point of view the reading log is
another course.** It is structurally different — no units, no catalog entry, no
grade — and it stays that way. On paper, on the board, and in the day row it is
one more thing to do, and it should look and be named like one.

What it is NOT: a curriculum course. `program:book-log` stays a *scheme*
(`bookLog.mjs:62`), the same trick `piano-course` uses with `plex:<ratingKey>`.
A course with no units is what the catalog gate refuses, and enrollment,
progress and the gradebook would all try to believe in it.

---

## 2. There is already a reading lesson card — this is not a second one

**The single most important correction in this design.** On a day the obligation
is unmet, an enrolled learner's shelf is already `section.next`
(`agenda.mjs:298-311`) and already renders through `lessonAction` via
`offerPresentation`'s program branch (`BuildAgenda.mjs:594-601`). Printing a
standalone reading card inline beside it would put **two reading cards** on one
page.

So the work is not "give the reading log a card". It is:

1. **Enrich the card that already exists** when the shelf is the section's
   `next` — give it the featured book, the author line, the book bar.
2. **Print the standalone card only when the shelf did not appear as a
   section** — an unenrolled learner, or an enrolled one whose obligation is
   already met (`doneToday: true` filters it out of `offerEligible` at
   `agenda.mjs:297`).

One card either way, built by one function, from one `feature` block.

---

## 3. The card

`readingLogAction` is deleted; `lessonAction` builds both paths above.

| Slot | A lesson card | The reading card |
|---|---|---|
| `icon` | subject id → SVG in the gutter | **`readingSubject`**, not a hardcoded `english` — an enrollment may place the shelf under any subject (`BuildAgenda.mjs:305-310`) |
| `taxonomy` | `Science › Book of Mammals` | see below — **four** strings, not two |
| `unit` (■ line) | `Unit 1: Felines` | the author — `Gary Paulsen` |
| `title` | the lesson | the book — `Hatchet` |
| `description` | what the lesson covers | where they are, what to do, plus the "also reading" tail |
| `progress` | course bar + unit bar | book bar + obligation bar |
| `meta` | `PRINT IT AGAIN` | `UPDATE ON THE PANEL` (`ADD A BOOK ON THE PANEL` when nothing is open) |
| `rail` | `Catch-up` | `Done` when the obligation is met |
| `panelCode` | six digits under the QR | six digits under the QR |

```
┌──────────────────────────────────────┐
│ 📖 English › Reading log             │
│ ┌──────┐ ■ Gary Paulsen              │
│ │  QR  │ Hatchet                     │
│ │      │ Page 84 of 184 — nearly     │
│ └──────┘ there. Save tonight's page  │
│  481902  or say you finished it.     │
│ HATCHET                    84 of 184 │
│ ▐▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░▌  │
│ READING THIS WEEK             4 of 7 │
│ ▐▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░▌  │
│      [ ] UPDATE ON THE PANEL         │
└──────────────────────────────────────┘
```

### `taxonomy` needs four non-empty strings, and a second renderer reads them

`blocks.mjs:284` rejects a `scan_action` whose taxonomy lacks a non-empty
`subject`, `course`, `unit` AND `lesson` — and a rejected block fails
`validateDocument` for the **whole agenda**. This is bit-for-bit the failure
`receipts.mjs:60-66` memorializes ("made EVERY lesson card on EVERY agenda fail
`validateDocument()`. Invisible for months").

The values are not filler, because `DocumentEscPosRenderer.mjs:233-241` prints
`Course · / Unit · / Lesson ·` **from the taxonomy** and never reads `block.unit`,
`block.rail` or `block.progress`. That renderer is live: `schoolLifecycle.mjs:339-345`
runs it alongside the raster path to harvest the operator transcript, and it is
the only renderer when the canvas one fails to build. So:

```
taxonomy: { subject: 'English', course: 'Reading log',
            unit: <author, or 'Books' when unknown>, lesson: <book title> }
```

which reads correctly in the transcript and leaves the raster card unchanged.
The canvas renderer draws only `Subject › Course` (`includeUnit: !lesson`,
`DocumentReceiptRenderer.mjs:303-308`), so the breadcrumb still shows two.

### The `Done` rail is a statement, never a gate

Subject cards leave the page when served — they collapse into `Done today`
(`receipts.mjs:614`). The reading card must not, because the shelf never closes.
A met obligation prints the same card wearing a `Done` rail and a working code.

Note `reopenable` is *not* unconditionally true, as an earlier draft of this doc
claimed: it is hardcoded true only in the unenrolled branch
(`BookLogProgramLauncher.mjs:148`); the enrolled branch computes
`!(obligation.per === 'once' && measured.met)` (`:194`). A finished `once`
series is terminal, and terminal means no card — correct, and unchanged.

---

## 4. Which book gets the headline

Among items whose projection is `reading`:

1. **Nearest the end** — highest `percent`.
2. **Fallback: most recently touched** (`lastAt`) when no book has a usable
   denominator. `percent` is null for minutes-mode, check-mode, and any book
   with no `pageCount` (`bookShelf.mjs:247-254`), so the fallback carries real
   traffic.
3. **Ties break on `itemId`** — which means the selection runs over `items`
   zipped with their projections, not over projections alone:
   `projectShelfItem` returns only `{status, page, percent, minutes, daysRead,
   lastAt}` (`bookShelf.mjs:236-244`). There is no `itemId` and no `finishedOn`
   on it; `lastAt` is the finish instant for a finished item (`:243`).

The other in-progress books are named in one sentence at the tail of
`description` — "Also reading: Frindle and The Hobbit." — not in a new block
field. It costs rows in the narrow column beside the QR, so it is capped at two
titles and dropped entirely when the description is already long.

### Five states, not four

`projectShelfItem` has four statuses (`:222-224`): `finished`, `set-aside`,
`reading`, `unread`. `set-aside` is a real outcome a child chose, and folding it
into "you have no books" would be a lie about their own log.

| State | The card |
|---|---|
| **Reading something** | Book-first, as above. Book bar only when `percent` exists; otherwise the description carries the mode's own number ("3h 20m so far", "read on 12 days") and only the obligation bar prints. |
| **Nothing open, something finished** | Most recently finished book, `Finished` rail — "You finished *Hatchet* on Sep 2. Add the next one: type the number off the back." Verb `ADD A BOOK ON THE PANEL`. |
| **Nothing open, something set aside** | "*The Hobbit* is set aside. Pick it back up, or start something new." Same verb. Never presented as a failure. |
| **Nothing ever logged** | Title `Start a book`; "Type the number off the back of any book to put it on your shelf." No book bar; obligation bar only if enrolled. |
| **Shelf unreadable** | Title `Reading log`, no book, no counts, no bars. A damaged year of evidence must never print as a zero. The code still works. |

---

## 5. Where the data comes from

**Titles.** A log entry stores `{bookId, progressMode, pageCount}` and nothing
else (`OpenBookShelfItem.mjs:105`), so titles and authors come from the
book-record cache — `bookRepository.findByIsbn`, as `GetBookShelf` uses.

**It does NOT go on `status()`.** Enriching `status()` would put N per-book
repository reads behind `collectProgramStatuses` → `PlanProjection.mjs:272`,
which the teacher board, the status board, DoNow and the completion recompute
all call. The agenda gets its own method:

```
BookLogProgramLauncher.featuredBook({ userId }) → {
  state: 'reading' | 'finished' | 'set-aside' | 'empty' | 'unreadable',
  book:  { title, authors, pageCount } | null,
  page, percent, minutes, daysRead, at,
  alsoReading: ['Frindle', 'The Hobbit'],
}
```

`BuildAgenda` calls it once per agenda; `status()` stays exactly as cheap as it
is. (An earlier draft claimed `ResolveAccessCode` reads launchers directly as
precedent — it does not: `ResolveAccessCode.mjs:149-151` says launchers are
deliberately *not held* and every read goes through the shared projection.)

**The unenrolled short-circuit stays.** An earlier draft moved the log read
above `BookLogProgramLauncher.mjs:146`. That would make a failing
`listForLearner` return `#unreadable()` — `error: true` — for a learner who is
not enrolled in reading at all, which `programStatusCollection.mjs:51-57` turns
into `program_unavailable` and blocks their whole day from reporting complete.
`status()` keeps its `{enrolled: false, doneToday: true}` answer; `featuredBook`
is the only thing that reads the log for an unenrolled child, and it degrades on
its own.

**`#unreadable()` gains a `context`.** It returns none today
(`BookLogProgramLauncher.mjs:242-247`), which is the blank-artwork case
`:144-145` says the poster route exists to refuse — so the unreadable card has
nothing to take its own name from.

**Book facts are decoration, never a precondition.** A miss, a throw, or an
unresolved ISBN degrades to the log-first shape with bars intact — the rule
`GetBookShelf` holds. Note `bookRepository` is optional in composition
(`schoolLifecycle.mjs:258`, defaulted `null`, and `GetBookShelf` is only built
when both it and `resolveBook` exist, `:1337`): a deployment without a books API
runs the degraded card **permanently**, not just on a cold cache. That is an
acceptable steady state and the card must be legible in it.

---

## 6. Placement

The enriched section card sits where English's card already sits — no change.

The standalone card (met obligation, or unenrolled) prints **after the last
section card and before the bulk-print card**, which is roughly where it prints
today.

**`nothingLeft` must be computed before it.** `receipts.mjs:583` reads
`blocks.length === 0` to decide between `All done today` and `Done today`
(`:616`), with a comment at `:579` explaining that the bulk card is placed after
the read for exactly this reason. The reading card is unconditional, so pushing
it before that line would make **"All done today" unreachable forever**. The
verdict is computed from the curriculum sections explicitly, not from
`blocks.length`.

---

## 7. Naming

`bookLogContext()` (`bookLog.mjs:75`) is the authority for how the shelf names
itself: `course.title` becomes `Reading log`, `course.id` and `lesson.title`
unchanged. Artwork is unaffected — `projectProgramEntry` keys on
`context.course.id` (`assignedProgramPlan.mjs:147`).

Two collisions to settle in the same change, neither of which an earlier draft
saw:

- **`'Independent study'` is also the generic no-course fallback** at
  `BuildAgenda.mjs:603`, `CloseSessionOutcome.mjs:468` and
  `IssueCorrectedResultReceipt.mjs:24`. Those stay, so after the rename a page
  can carry both words. That is fine only because they now mean different
  things: `Reading log` is a named program, `Independent study` is "this work
  has no course". Say so where the fallback lives.
- **`StoryTimeProgramLauncher.mjs:180` already emits `'Reading log
  unavailable'`** for the TV story-time program. Two programs calling themselves
  the reading log on one board is the confusion `bookLog.mjs:56-61` warns about.
  Story time's sentence changes to name story time.

Tests pinning the old string: `BookLogProgramLauncher.test.mjs:209`,
`tests/isolated/applications/school/readingLogForEveryLearner.test.mjs:158,197`,
`tests/isolated/applications/school/accessCodeUseCap.test.mjs:89`.

---

## 8. The code: a use cap, and both clocks left alone

The observed problem is a printed code that gets lost or used by a younger
sibling. **An earlier draft answered it with a 4-hour TTL applied to the token
and the code together. That is withdrawn**, on four pieces of evidence:

- `tokens.mjs:269-283` argues the two clocks deliberately and ends **"Do not
  'align' them."** Reversing that is a decision, not a fix.
- An expired code is not a named refusal. The registry collapses expiry to
  `null` (`YamlTokenRegistry.mjs:389`), so it lands on `TRY_AGAIN` — "Try
  again." — **and burns a throttle strike keyed on the panel's `deviceId`**
  (`ResolveAccessCode.mjs:301-318`, `:855`). Stale codes would throttle the
  panel for the whole household. A real `expired` reason means teaching the
  registry, the resolver, and `useSelfService`'s `isBackendFault` in one change.
- "Reprinting is one action" is false: `ResolvePersonalCard`'s 15-minute agenda
  cooldown fingerprints `agenda.offers[]` only (`:95-108`), and the reading card
  is not an offer — so a tap inside the window returns `agenda_suppressed` and
  the fresh code is revoked.
- The harm is not time-shaped. `accessCode.mjs:11-22` records the incident: one
  code typed **thirteen times in five hours**. A 4-hour window with no use cap
  barely touches that.

**So: `maxUses: 12` on the reading token, and both clocks stay as they are.**

- Twelve is far above a real day of logging and just under the observed abuse.
  Subject codes are 3 (`DEFAULT_ACCESS_CODE_MAX_USES`); the reading log is
  looser because a log is repeatable, which is what `accessCode.mjs:49-52`
  already says.
- A spent code answers `USED_UP`, which is a real sentence the frontend already
  understands — unlike expiry.
- The comment at `BuildAgenda.mjs:547` explaining why there is no cap is
  rewritten rather than deleted: frequency was never a proxy for attribution,
  and a cap this high is a bound on abuse, not on honest logging.
- The digits still die at the study-day rollover; the QR still keeps the subject
  TTL. `buildAgenda.test.mjs:744` continues to pass unchanged.

Coupled time expiry is deferred to its own change — see §11.

---

## 9. Failure paths

| Failure | Behaviour |
|---|---|
| Shelf unreadable | `state: 'unreadable'` — card prints, no counts, no bars |
| Book record missing, cache throws, or no books API wired at all | Log-first shape, bars intact |
| `featuredBook()` throws entirely | Card still prints in its plain form |
| Self-service off | No code, no card — unchanged |
| Malformed code | Prints nothing, unchanged |
| Preview render | The full lesson card with `000000` and the inert token |

---

## 10. Tests

| Level | What it pins |
|---|---|
| `bookShelf.test.mjs` (exists, `2_domains/school/`) | selection rule, `alsoReading`, all five states — pure, no launcher |
| `BookLogProgramLauncher.test.mjs` | `featuredBook` across enrolled / unenrolled / unreadable / no-repository; `status()` unchanged in shape and cost; `#unreadable()` now carries a context |
| `receipts.test.mjs` | the block is a lesson card with a four-string taxonomy; `validateDocument` passes; `All done today` still reachable |
| `buildAgenda.test.mjs` | **exactly one** reading card on an unmet-obligation day; `maxUses: 12`; `accessCodeExpiresAt` still the rollover (`:744` unchanged); `:754`'s `card.label` assertion updated — `label` is now the book title, and the handle for "this is the reading card" is the taxonomy course |
| ESC/POS renderer | the transcript reads `Course · Reading log / Unit · <author> / Lesson · <book>` |
| render snapshot | beside the existing lesson-card snapshots |
| by hand | a real captured page through `school agenda render --from <artifact>` |

---

## 11. Deliberately not in this pass

- **Coupled time expiry.** Wanted, but it costs: an `expired` reason in the
  registry and resolver, teaching `useSelfService` so it does not render as an
  outage, a cooldown exemption so a reprint is really one action, accepting
  refusal slips on stale scans, and a written reversal of `tokens.mjs:269-283`.
  Its own design, independent of this one.
- No cover art on paper — the thermal renderer draws line art.
- No catalog registration; `program:book-log` stays a scheme.
- No reflection, rating or quiz surface on the card.
- No revoke-on-reprint: it needs a registry lookup by learner and token class
  that does not exist.

## 12. Open, unverified

- Card height on tape. `actionOp` (`DocumentReceiptRenderer.mjs:472-500`)
  measures band by band with no cap, and the description sits in the narrow
  column beside the QR. The "also reading" tail is the most expensive rows on
  the card; measure a real render before settling its cap of two titles.
Settled since the review: production **does** wire the repository —
`app.mjs:3864` builds the books module unconditionally and `:3918` passes
`bookRepository` into `schoolLifecycle`, and `booksApi.mjs:37` constructs a
`YamlBookRepository` with no feature gate. The degraded no-titles card is a
fallback for a cold cache and for test compositions, not today's production
state.
