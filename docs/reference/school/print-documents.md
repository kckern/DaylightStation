# Print Documents — Worksheets, Quizzes, and OMR Grading

> **Status: built and deployed.** The full loop runs in production: author a
> YAML source → publish → render on demand (per-student, per-variant) → the
> student answers on a physical bubble card → the card scan grades, records
> evidence, and advances the work session — with anything a machine cannot
> honestly grade routed to a person.
>
> **Requirements:** [`docs/_wip/plans/2026-08-04-print-design-system-requirements.md`](../../_wip/plans/2026-08-04-print-design-system-requirements.md)
> · Fix-wave plan: [`2026-08-05-print-scan-rereview-fixes.md`](../../_wip/plans/2026-08-05-print-scan-rereview-fixes.md)
>
> This system supersedes nothing: the quota-based worksheet printing described
> in the [School README](./README.md#printing-worksheets-on-the-kitchen-laser-printer)
> (bank → simple worksheet PDF, page quotas, grown-up approval) still runs for
> its own use case. Print documents are the richer sibling: authored layouts,
> revisioned publishing, card-backed grading, and a session lifecycle.

---

## 1. The idea

A printout works like an app screen: **generated on demand for the current
student**, not photocopied from a master. The same document renders as one
child's quiz sheet, a sibling's differently-shuffled variant, or the teacher's
answer key — all from one published source, all reproducible from the same URL.

Worksheets and quizzes are one family with a **stakes dial** (`archetype:`).
A worksheet is lower stakes and often open-book; a quiz is tracked,
per-student, and graded. Both share the same blocks, the same renderer, and
the same card machinery.

Answers ride the **physical OMR card** (official Chatsworth bubble cards,
5 choices × 50 rows), not the page: a card-backed sheet prints the questions
and choices but **no fillable bubbles** — the letters and choice text keep
their exact positions, only the mark-target ink is withheld, so an answer can
never land somewhere the scanner will not look. Hand-graded sheets print
bubbles for on-page marking.

Cards are expensive, so they are **shared**: several documents can occupy one
card at different row offsets, and a sheet's printed question numbers ARE its
card rows (a sheet covering rows 7–12 numbers its questions 7–12; a write-on
question that consumes no row prints no number at all — two numbering systems
on one page is exactly the sheet-to-card confusion the design exists to
prevent).

For enrollment-issued work, a settled card is currently reused at its next
untouched row until row 50. A lesson that would cross row 50 starts a new card;
completed rows are not reclaimed. Continuation worksheets say **REUSE THE SAME
ANSWER SHEET** and print the exact row range so a learner does not consume
another physical sheet unnecessarily. The allocation model can already attach
several documents to one card across subjects and courses; the current issuing
policy merely waits for the previous allocation to settle. The configurable
many-to-one policy is specified in [§5.1](#51-configurable-answer-sheet-reuse).

---

## 2. Authoring: the source document

A source lives under `data/content/school/catalog/documents/` as
`school.document-source/v1` YAML. It is the ONE place answers may appear —
publishing strips them.

**A document is the class; a published revision is the object.** That is why a
source is authored on the catalog shelf and not in `print-documents/`:
`catalog/documents/` is where authored document *classes* live — the same
shelf as the `school.learning-document/v1` files, which are authored classes
too — while `print-documents/` holds only machine-written artifacts
(`published/`, `derived-banks/`, `allocations/`).

The two schemas share that shelf without colliding, because each system
identifies its own files positively rather than by elimination:
`YamlLearningContentRepository` matches a learning document by its
`documentId` (a print source has `id`, never `documentId`);
`YamlPrintDocumentRepository.list()` admits a file only when its `schema` is
`school.document-source/v1` or the hand-authorable `school.document/v2`.
`school-docs validate <dir>` applies the same rule, reporting anything it
skipped as belonging to another system.

```yaml
schema: school.document-source/v1
id: arts/pokemon-identification/quiz-1     # hierarchical taxonomy id
subject: arts                               # must match the id's first segment
topics: [popular-culture, pokemon, identification]
seed: 80426
target: [letter]
archetype: quiz                             # or worksheet — the stakes dial
title: "Pokemon Identification — Quiz 1"
header:
  instructions: "Mark your answers on your bubble card."
fit:
  policy: flow                              # flow | one-page | fill | prefer-one-page
  typeScale: standard                       # standard | young
blocks:
  - type: question
    key: pk1
    bankId: arts/pokemon-identification/pokemon-identification-medium
    select: 6                               # bank-select sugar: 6 seeded picks
```

- **Ids are taxonomy paths** — 1–4 kebab-case segments
  (`subject/course/slug`). A flat slug is still legal. When a `subject:` field
  is present on a hierarchical id, it must equal the first segment;
  contradiction is a validation error, not metadata. Source files nest under
  their id's path
  (`catalog/documents/arts/pokemon-identification/quiz-1.yml`).
- **Blocks** are the closed set from the learning-document system (rich text,
  math, figures/assets, insets, lists, wordbank, matching, cloze,
  short answer, essay, questions with inline choices or bank-select,
  multi-select, true/false, scan/media action codes) plus layout controls
  (dividers, spacers, page breaks). Wordbank/matching orders are
  seeded-shuffled; cloze blanks are fixed-width atoms.
- **Fit** is decided by measurement, never streaming. Four policies:
  `flow` paginates at normal density with no shrinking; `one-page` must fit —
  density falls back to compact, and a document still overset at compact is
  REJECTED with a structured overset amount rather than printed;
  `prefer-one-page` tries normal, then compact, and only spills (at compact,
  never rejecting) if neither reaches one page — this is the **default for the
  `worksheet` archetype** (an archetype preset, like `header`'s
  name/date/scoreBox defaults; an explicit `fit.policy` still overrides it),
  for documents where one page is strongly preferred but not worth refusing a
  render over; `fill` balances and then grows into leftover page space.
  `typeScale: young` enlarges glyphs *and* leading for early readers.

  `fill` does two things, in order. First it **balances**: placement runs a
  second time against a soft per-page target, ending a page when stopping lands
  closer to that target than adding the next fragment would. The hard page
  ceiling still governs every fit decision, so the target only ever starts a
  page early — and the balanced result is adopted only if it produced the same
  page count, so balancing can never make pagination worse. Then it **grows**:
  answer spaces expand first, each to its own `maxPt`; any space still left is
  shared among `fillAfter` fragments, capped per share at
  `theme.pagination.maxFillGrowthPt` (32pt normal, 22pt compact).

  That cap is the point. Uncapped, a sparse last page dumped all its slack into
  one or two gaps and produced page-tall voids between questions. Capped, the
  leftover simply stays as blank space at the bottom of the page — trailing
  white space is preferred over an oversized interior gap.
- **Shuffles are edit-stable**: derived from `(seed, variant, block key)`, so
  editing one block never reshuffles its neighbours, and variant N is a
  different-but-deterministic shuffle of the same content.

## 3. Publishing: revisions and derived banks

`school-docs publish <file>` (or the same transform in-process) splits a
source into:

- `published/<id-path>@<rev>.yml` — the answer-free `school.document/v2`
  document. Validation rejects an `answer`/`answers` key anywhere in a
  published document; a document that *could* hold an answer is one that can
  print it on a learner's sheet.
- `derived-banks/<id-path>@<rev>.yml` — the answer-bearing question bank for
  anything the source declared inline (absent for a purely presentational
  source; a bank-select document's answers stay in the external bank it
  references).

`rev` is a **9-hex content hash** of the validated source. The store is
**append-only**: republishing an unchanged source is an idempotent no-op;
different content at an existing `<id>@<rev>` path is refused outright. Prior
revisions are retained forever — a card printed last month still grades
against exactly what it printed.

### Enrollment-issued worksheet instances

An agenda or result-receipt QR does not render directly from mutable lesson
YAML. `IssueDocument` first creates an immutable
`school.worksheet-instance/v1` record bound to learner, enrollment, lesson,
profile, bank revision, selected item ids, prompts, evidence locators, visible
options, correct option identities, A–E letters, document revision, Student
No., and answer-sheet rows. Reprints resolve that snapshot, so later question
bank edits cannot change paper already issued or its grading key.

**The instance is also the grading roster.** For a unit with a `bank` and no
`document`, the sheet holds a *sample* of the bank — so the instance's
`itemIds` is the only correct denominator, and the only correct list of
questions a grown-up can still be asked to mark. `SubmitPaperWork` and
`GradeSubmission` both read it via `worksheetInstanceRoster()`
(`2_domains/school/questionBankV2.mjs`), taking `itemIds` as authoritative and
`questions[].itemId` only as a repair fallback. Reading the live bank back
instead scored a perfect ten-question paper out of however many items the bank
holds today, and queued the never-printed remainder as work nobody could ever
clear — pinning the session at `awaiting_review` permanently. A session with no
instance on file (a legacy screen-path hand-in) still marks against the bank.

The authored course and banks remain content under
`content/school/curriculum/`, and the authored print-document sources under
`content/school/catalog/documents/`. Published documents, derived banks, and
physical card allocations live under `content/school/print-documents/`, which
holds nothing else; the learner/enrollment-bound worksheet-instance records
live in the household school application data. These are runtime records, not
curriculum source.

Moving a source file never invalidates an artifact: allocations, worksheet
instances, and published filenames all key off the document's `id`, never its
path.

**Renders are published-first.** Every render lane that can pin a revision —
the HTTP route, the tracked-quiz issue path, and the CLI's card mode —
resolves the published artifact; the raw source only renders when the
document has never been published (proofing a draft) or through the CLI's
plain proof render. This matters because a card allocation records the rev it
rendered, and a scan later resolves that exact rev: a source that drifted
from its published artifact would otherwise mint a "phantom" rev no scan
could ever serve.

## 4. Rendering: varieties, keys, variants

The renderer produces Letter PDFs in the **modern workbook** aesthetic
(Atkinson Hyperlegible, four text styles, normal/compact densities), with
name/date lines, a score box for point-bearing documents, page furniture
(x-of-y footers carrying the card number when card-attached, duplex
gutters), and vector QR codes
for any action block whose token was minted at issue time.

**Which archetypes get alternating gutters — and what actually prints.** The
3-hole-punch gutter alternates side by page parity (mirror margins) for the
`worksheet` archetype only (`DUPLEX_ARCHETYPES` in `RenderPrintDocument.mjs`).
Every other archetype — `quiz`, `infopage` — reserves the gutter on the **left
of every page**; v1 legacy documents draw no gutter at all.

That decision now travels with the render: `execute()` returns `duplex`
(`true` / `false` / `null` for v1), and `IssueDocument` and
`ReplaceLostAnswerSheet` pass it to `printPdf({ duplex })`, overriding the
printer adapter's global default. A `worksheet` prints double-sided; a
multi-page `quiz` or `infopage` prints **single-sided**, because folding a
fixed-gutter document onto one sheet would put facing pages' punch margins on
opposite physical edges and punching the stack would destroy content on every
verso. `null` leaves the adapter default in place.

Adding an archetype to `DUPLEX_ARCHETYPES` changes page layout, not just a
printer setting — it needs its own visual verification. See
[`README.md` → Printing → Duplex](./README.md) for the PJL envelope that
carries it (and the standing caveat that none of it is hardware-confirmed).

Two **varieties** exist at the request level:

- **`omr`** — card-backed. The sheet carries a compact outlined **Student
  No.** identity box in the same top row as Name and Date. A continuation adds
  `REUSE THE SAME ANSWER SHEET · ROWS 7–12` above the same number. It prints
  **no on-page bubbles**: the student reads the sheet and marks the physical
  answer sheet.
- **`hand`** — hand-graded. Bubbles print on the page; no card, no
  allocation, nothing tracked.

**The teacher key is a render mode, not a separate document**: the identical
student pages plus appended dense answer pages (namespaced entries — bare
numbers for questions, `Fill-in (passage N): blank n:`, `Matching:`). The
fit/pagination decision is computed identically with or without the key, so a
key can never disagree with the sheet it answers. Keys are gated: `teacher=1`
requires a pin matching the household school config's `print.teacherPin`,
and denies when unset or wrong (see §9, trust model) — `pin=` on the GET for
a bare key read, `teacherPin` in the `POST /print/render` body when the key
combines with a card mint (`freshCard=1&teacher=1`).

**Variants** are per-student shuffles of one document (variant 0 unmarked;
variant 1 prints as "Form B", etc.). `retake=1` mints a fresh card at the
learner's next unused variant — a retake is never the memorizable duplicate
of the first sheet, and consumed variants (even on released records) are
never reissued.

## 5. OMR cards and allocation

The physical card is the sheet's identity. Card ids are **random 7-digit
numbers** ("like a uuid" — never sequential), student-bubbled into the
card's ID columns. Multi-mark rows are legal (select-all-that-apply grades as
an exact set; a double mark on a single-select row grades *ambiguous*, never
guessed).

Every card-backed render writes (or reuses) an **allocation record** at
`data/content/school/print-documents/allocations/<cardId>.yml`:

```yaml
- recordId: arts/pokemon-identification/quiz-1@632002966:v2:1-6
  cardId: '9251793'
  rowRange: {start: 1, end: 6}
  documentId: arts/pokemon-identification/quiz-1
  rev: 632002966
  seed: 80426
  variant: 2
  learnerId: felix
  sessionId: ws_abc123        # when issued by a tracked-quiz session
  rowItems:                   # the row→item mapping ACTUALLY printed
    - {row: 1, itemId: sneasel-evolution, itemType: multiple_choice}
  renderedAt: '2026-08-05T15:12:28.097Z'
  status: live                # live → satisfied | released | superseded
```

Rules the record system holds to:

- **The record is the sheet's identity.** `recordId` is deterministic
  (`<docId>@<rev>:v<variant>:<start>-<end>`); the same render context always
  names the same record, so reprints reuse rather than duplicate. A reprint
  of a *satisfied* record (the teacher pulling a taken quiz's key up to
  grade) reproduces it idempotently; a same-id request whose context actually
  differs (seed, learner, or row mapping) is refused with the reason named.
- **Row collisions are refused** against any live record on the card,
  regardless of learner. Rows of a settled (satisfied) record may legally be
  reallocated — a card is reused once its prior claimant is done.
- **`rowItems` is the drift guard.** A bank-select block's selection depends
  on the external bank's size; if that bank mutates after printing,
  re-derivation at scan time would grade a mapping the paper does not carry.
  The persisted mapping is authoritative; disagreement refuses the record
  (`ALLOCATION_ROW_MAPPING_DRIFT`) rather than grading wrong answers
  confidently.
- **Released records recycle rows but never reproduce.** `release-card` frees
  a card's rows; the released record's exact context can never be
  re-allocated on that card (recovery is a fresh card).
- A tracked-quiz issue that fails after allocating (fit rejection, printer
  jam) logs the orphaned card loudly and best-effort releases it, so retries
  land on a clean slate instead of burning cards forever.

### 5.1 Configurable answer-sheet reuse

`Student No.` identifies one **physical answer sheet**, not one document,
course, subject, or work session. Internally this identity should be treated as
an `answerSheetId` even though the printed label remains `Student No.` to match
the purchased form. A worksheet instance remains independently identifiable by
its immutable document/allocation record.

This makes the relationship intentionally many-to-one:

```text
Student No. 7651208

Civilization worksheet       rows 1–6
Mathematics worksheet         rows 7–14
Science quiz                  rows 15–20
Civilization retry            rows 21–23
```

There is no grading ambiguity in this arrangement. Each allocation retains its
learner, document revision, worksheet instance or work session, answer mapping,
and non-overlapping row range. The scanner resolves each marked row through its
owning allocation, so documents on the same card may belong to different
subjects and courses. A card must never contain allocations for different
learners.

The issuing policy is configurable at the household level:

```yaml
answer_sheets:
  reuse: until_full
  capacity: 50
```

Supported policy values:

| Policy | Behavior |
|---|---|
| `never` | Mint a new answer sheet for every worksheet. |
| `after_scan` | Reuse only after the previous allocation settles. This is the default, conservative behavior. |
| `school_day` | Reserve all of a learner's worksheets issued during the local school day on one answer sheet when they fit. |
| `until_full` | Keep one active answer sheet across subjects, courses, and days until the next whole worksheet would exceed its capacity. This is the recommended default because it conserves the most physical cards. |

Allocation invariants apply in every mode:

- Reserve each row range atomically; concurrent issue requests cannot claim the
  same rows.
- Never split one worksheet across answer sheets. If the next worksheet does
  not fit in the remaining rows, mint a new sheet before allocating it.
- Never overwrite, reclaim, or renumber a range that reached the learner.
  Remediation uses the next untouched rows when they fit.
- A reprint reproduces the original answer-sheet number and row range exactly.
- Multiple outstanding (`live`) allocations may share a card only in
  `school_day` or `until_full` mode, only for the same learner, and only at
  non-overlapping ranges.
- Progressive rescans grade newly completed live ranges and ignore unchanged,
  already-recorded answers. Changed answers on a settled range and marks in
  unallocated rows remain diagnostic events rather than silently replacing
  evidence.

The learner-facing language must make physical-sheet reuse explicit without
using the implementation term OMR:

- First allocation: **NEW ANSWER SHEET · ROWS 1–6**
- Later allocation: **KEEP USING THE SAME ANSWER SHEET · ROWS 7–14**
- Agenda summary: **TODAY'S ANSWER SHEET · Student No. 7651208 · Use rows
  7–20 today**

For `school_day`, reuse is compared in the household's local timezone. A future
agenda-batch reservation may reserve all advertised ranges together so print
order cannot change them. For `until_full`, the allocator may append
work as it is issued, but the same atomic reservation rule applies. The agenda
may therefore point several course worksheets at one answer sheet while every
worksheet and result receipt still carries enough identity and row information
to be understood if separated from the agenda.

### 5.2 Lost answer sheets

A lost answer sheet is **superseded, never deleted or reset in place**. Settled
allocations remain immutable evidence. Only work whose allocation is still
`live` is printed again, on a newly minted Student No. and fresh row ranges.
Each old record links to its replacement with `supersededReason:
answer-sheet-lost`, the replacement card and record ids, the reporting teacher,
and the timestamp.

Loss recovery is a teacher-console write guarded by the normal teacher role and
PIN. It is available in two forms:

- `POST /api/v1/school/lifecycle/answer-sheets/:cardId/lost` performs the
  replacement immediately.
- `POST /api/v1/school/lifecycle/answer-sheets/:cardId/lost-ticket` mints a
  15-minute, one-use School QR for that specific card. Add `?format=png` to
  receive a rendered QR slip rather than its JSON description. Scanning the QR
  performs the same replacement and revokes the token after success.

The QR is not a permanent teacher credential. Teacher authorization is checked
when the card-specific token is created; the opaque token then carries only
that narrow, expiring authority. A child who finds an old replacement QR cannot
use it for another card or after it has succeeded or expired.

Replacement is committed one allocation at a time. The new worksheet must
render and physically print before its old live record becomes superseded. If
the printer fails, the just-created replacement allocation is released and the
old allocation remains scannable. If several live worksheets shared the lost
card and printing stops partway through, successfully printed replacements stay
valid while a later recovery attempt handles only the still-live remainder.

## 6. The print API

`GET /api/v1/school/print/<id-path>` — the id is the full taxonomy path
(`…/print/arts/pokemon-identification/quiz-1`). Returns the PDF inline
(filename from the slug), with `X-School-Print-Allocation` (the card record
summary) and `X-School-Print-Warnings` headers. This GET is a **plain proof
render**, safe to bookmark, refresh, and share a link to — repeating it never
mutates anything.

**Card-minting renders are `POST /print/render`, not the GET (punch 5b).**
Minting or spending a card is a mutation, and a teacher pin is a secret —
neither belongs on a GET, whose URL lands in browser history, proxy access
logs, and `Referer` headers. The GET 400s
(`{ error: 'card-minting renders require POST /print/render' }`) if it sees
`card=`, `freshCard=`, or `teacherPin=` in the query string; those three (plus
everything else the GET accepts) move into the JSON body of
`POST /print/render: { id, variety, learnerName, learnerId, card, freshCard,
startRow, teacherPin, date, rev, variant, retake, teacher }`. Both routes
render through the same shared logic, so the allocation semantics below are
identical either way — only the transport (and where the pin lives) differs.

**`GET /print/<7 digits>` is a card lookup**, and stays a GET — it is a pure
read, not a mint. The card number is the one thing printed in large digits on
the sheet in a child's hand, so it is enough by itself: the path resolves the
card's newest usable allocation and reproduces its exact sheet (adoption
semantics — the record's rev/variant/rows/learner govern; `teacher=1&pin=`
works on top for its key, same as the plain-document GET). An unknown card
404s with Hamming-1 live near-miss suggestions, the same courtesy a
mis-bubbled scan gets. Bare 7-digit *document* ids are reserved at validation
time so the shape can never be ambiguous.

| Param | Meaning | Where |
|---|---|---|
| `variety=omr\|hand` | **default `omr`** — card-backed (the main mode) unless `hand` is asked for | GET or POST |
| `learnerId=` | whose sheet. **Required for quiz-archetype omr renders** (or an explicit `card=`) — without it two siblings would share one sheet identity. Worksheets may stay anonymous; teacher renders are reads and stay exempt | GET or POST |
| `teacher=1&pin=` | append the answer key; pin must match `print.teacherPin`. `pin=` stays a GET query param — a bare teacher-key read never mints | GET or POST (POST's body key is `teacherPin`, not `pin`) |
| `rev=` | pin a 9-hex published revision (default: latest published) | GET or POST |
| `variant=0..999` | per-student shuffle variant | GET or POST |
| `card=NNNNNNN` | reproduce (or extend) a specific physical card | **POST body only** |
| `startRow=1..50` | with `card=`: attach this document at a row offset (card sharing) | **POST body only** |
| `freshCard=1` | force-mint a new card | **POST body only** |
| `retake=1` | fresh card at the learner's next unused variant; rejects all explicit identity params | GET or POST — retake alone doesn't carry `card`/`freshCard` |
| `learnerName=`, `date=` | prefill the header lines | GET or POST |

**Sheet identity is automatic and stable.** A bare `variety=omr` render
reuses the document's newest usable record (live before satisfied, filtered
to the learner when given) and only mints when none exists — refreshing a
bookmarked URL never burns cards, and the same URL keeps producing the same
sheet, including after the scan settles it. Adopting a record pins its
rev/variant/rows/learner; explicit `rev`/`variant` are rejected in that mode
because the record, not the query string, is the identity.

Gates, so identities cannot be dodged or swapped:

- Quiz + no learner + no card → 400 ("quiz sheets are per-student").
- Quiz + a `card=` that carries **no usable record for this document** (a
  fabricated or mis-typed number, or a released card) → 400 demanding a
  learner, with or without `startRow` — attach-new stays legal for
  worksheets and identified learners.
- `card=` + a `learnerId` contradicting the record's → 409
  `CARD_LEARNER_MISMATCH` (with an honest message when the record is
  anonymous), never a silent identity swap.
- Store invariant refusals (row collisions, illegal transitions) → 409 with
  the invariant's own code.
- A teacher render with no existing sheet renders **key-only without
  allocating** — printing a key must never mint the sheet identity the next
  student print silently adopts. (`freshCard=1&teacher=1` still deliberately
  mints sheet and key in one go.)

Two truly simultaneous *first* prints of one document can each mint a card
(the find-then-allocate is not atomic); one strands as an uncollected live
record — recover with `release-card`. Accepted at household scale.

## 7. The CLI

`node cli/school.mjs docs` (`npm run school:docs`):

- `validate <file|dir>` — parse + validate, render-free, sub-second (the AI
  repair loop's inner step).
- `publish <file>` — source → published + derived bank, append-only.
- `render <file> --out <pdf>` — the real fit/render pipeline. Flags:
  `--teacher`, `--learner-name`, `--date`, `--type-scale`,
  `--card <id> | --fresh-card`, `--start-row <n>`, `--learner-id <id>`.
  **Card mode always resolves the published document** — the file argument
  only supplies the id; an unpublished id fails with "publish first" rather
  than pinning a phantom rev.
- `reprint <instanceId> --out <pdf>` — reproduce an exact historical print from
  a persisted worksheet instance, with **no manual flags**. Reads
  `<dataDir>/household/apps/school/worksheet-instances/<instanceId>.yml` and
  derives everything the original sheet carried — learner name, issue date,
  answer-sheet number, row range, question order — from that record, so the
  reprint is byte-identical to the paper that first came out of the tray. This
  is the command to reach for when a sheet is lost, destroyed, or re-scanned
  days later; `render --card …` requires hand-assembling five flags and prints
  a silently different sheet if any one of them is wrong or omitted.

  Because the date comes from the instance's own `issuedAt`, a sheet reprinted
  later still prints its ORIGINAL date — it stands in for the paper generated
  that day, rather than claiming to be new work.

  It refuses rather than guessing: an unsafe instance id, a malformed instance
  file, a missing `documentRevision` (which would otherwise silently resolve to
  the latest published revision — a different sheet under the original's name),
  or an allocation that does not reproduce the instance's own recorded
  `recordId` all fail loudly with exit 1 and no PDF written. On the happy path
  it writes nothing to the allocation store: the store's identical-reprint
  shortcut returns the existing live record untouched.
- `release-card <cardId> [--rows a-b]` — allocation housekeeping.
- `list-cards [--status <s>] [--older-than <Nd>]` — every allocation record
  across every card, flattened. The read that makes `release-card` usable:
  before it, releasing a stranded card required already knowing its id.
- `audit [--status <s>]` — read-only integrity check over the same allocation
  store, for CI or cron. It walks every record and reports:

  | Check | Meaning | Severity |
  |---|---|---|
  | `missing-published-revision` | `published/<documentId>@<rev>.yml` is not on disk — the record can never be reprinted and a scan of it can never resolve | `error` for a `live` record, `warn` otherwise |
  | `missing-derived-bank` | the published revision has inline OMR questions whose choice text lives only in the bank, but no derived bank exists | `error` for `live`, `warn` otherwise; `info` when it cannot be determined |
  | `missing-bank-select-bank` | a bank-select block names a catalog bank that no longer resolves | `error` for `live`, `warn` otherwise |
  | `unresolved-row-items` | a record's frozen `rowItems` mapping references item ids absent from the resolved bank, so those rows cannot be graded | `error` for `live`, `warn` otherwise |
  | `overlapping-live-rows` | two `live` records on one card claim the same rows — the store's `checkCollision` refuses this on write, so a hit means file drift | `error` |

  **A missing derived bank is not automatically a fault.** A bank-select
  document keeps its answers in the external catalog bank and legitimately
  mints none (`publishQuestion` passes a `select` block through untouched, so
  `publishDocument` returns `bank: null`), and `mergeBank` picks those items up
  from `prepareV2Document`'s `extraItems` rather than from the repository. The
  audit only reports the absence when the published revision carries an INLINE
  `omr_response` question — whose choice text exists nowhere but the bank — and
  drops to `info` when the answer-free published document cannot settle it.

  `unresolved-row-items` asks whether an id still exists anywhere the resolver
  can reach, not whether the seeded selection would pick it again: re-deriving
  the selection keys off `bank.items.length` and would report a false positive
  for any bank that has since gained or lost an unrelated item.

  Exit code is 1 only when something at `error` severity is found, 0 otherwise.
  It calls `listCardIds`/`findByCard`/`getPublished`/`getDerivedBank` and
  nothing else — it never allocates, releases, or updates a status. Revisions
  are always looked up at the record's exact `rev`; `getPublished(id)` with no
  rev resolves to the LATEST revision, which would turn every orphan into a
  false pass.

`node cli/barcode-scan-sim.cli.mjs proof <learnerId> <courseId> --out <directory>`
is the file-only lifecycle proof (formerly `school.mjs sim`,
generalized and folded into this file — see that CLI's own header comment). It
builds the learner's real agenda, scans the agenda QR, issues and renders the
enrollment-bound worksheet, submits a perfect simulated card scan, renders the
thermal result receipt, scans its next-lesson QR, and verifies answer-sheet
reuse. It writes PDFs and a `proof.yml`-equivalent JSON report; it deliberately
constructs no physical printer adapter and keeps sessions, worksheet instances,
and attempts in memory so the run leaves no learner test history. Pass
`--outcome fail` to submit a deterministic failed attempt and exercise the
complete remediation loop: locator-only review hints, a retry QR, the same
Student No., the next untouched answer-sheet rows, and a fresh worksheet
instance containing only the missed item ids with newly chosen and ordered
options. `barcode-scan-sim.cli.mjs` also has `scan`/`card`/`lesson`/`flow`
commands that drive the SAME lifecycle through persistent `--state-dir` stores
(and, opt-in via `--print`, the real laser printer) rather than in-memory
doubles — see its header comment for when to reach for which mode.

### Agenda and result-receipt language

Agenda lesson cards and worksheet results share one compact, subject-led visual
language. The subject icon establishes the visual family (for example, the
Civilization globe), while every artifact names the complete learning path:
**Subject → Course → Unit → Lesson**. A lesson action places its QR at the left
and the hierarchy, lesson description, and progress at the right; the opaque
scan token is encoded in the QR but is not printed as redundant text.
Course names describe the curriculum rather than duplicating a source-book
title. Unit numbers follow the enrollment's durable shuffled module order, so
the required opening block is Unit 0 and the learner's first regional block is
Unit 1 even when its book order differs.

A worksheet result also carries the learner name, local date, local time, and
Student No. in a compact identity strip so a loose receipt remains attributable.
Its bordered result panel is the visual lead: exact correct/total and earned
percentage share the first line, the pass/retry verdict follows with its icon,
and the smaller final line states the percentage needed to pass. Item checks or
X marks are vertically centered beside that summary. Two progress
scales provide both context and detail: course progress counts completed units,
while unit progress counts completed lessons. A single-lesson unit collapses
to a compact complete/progress row instead of drawing a meaningless one-segment
bar. Assessments up to ten items show one box per item; larger exams
switch to a compact ten-segment score bar beside the exact fraction rather than
shrinking dozens of boxes past legibility. A passing result offers the next lesson. A failed result offers
only a retry, lists hints for missed items according to the profile disclosure
policy, and never unlocks or advertises the next lesson.

The agenda and next/retry cards reuse one two-row taxonomy component: the
subject icon spans `Subject › Course` and the bold `Unit › Lesson` row. Action
state is separate from subject identity (`NEXT UP` uses a forward marker,
`TRY AGAIN` a retry marker), and the footer uses a scan-corner symbol with a
plain-language instruction. That instruction names what THIS card's scan
actually does and comes from one place — `offerSession.nextMove`, surfaced to
the document as `next.actionLabel` — so it is composition-aware: `PRINT YOUR
SHEET` for a worksheet, `WATCH OR LISTEN` for a media unit, `ANSWER ON THE
SCREEN` for a bank, `START IT AGAIN` for a stalled video, and a program unit's
own location hint (`ON THE PORTAL`, `IN THE GARAGE`). It is never hardcoded to
"print": a card that says print but plays a film sends the child to the wrong
machine. Descriptions use compact leading so the QR and hierarchy, rather than
wrapped supporting copy, determine card height.

## 8. Scan-back: grading and the lifecycle

The scan consumer subscribes alongside the household's existing bubble-sheet
recorder (same bus topics, same decoder) — additive, never gating it. A
decoded card resolves through the allocation store; the decoded test id IS
the card id.

**Resolution** (per card):

- Any unreadable ID digit → refused (`CARD_ID_UNREADABLE`), never guessed.
- **Newest claimant wins per row**: ownership is resolved across every
  live/satisfied record on the card before anything grades, so a reused row
  grades against the latest printing only — never double-graded, never
  scored against a stale key.
- Each owned, answered row grades at **the record's pinned rev/variant/seed**
  against the derived (or external) bank — the exact shuffle the paper
  carries, not whatever the document is published with today. Blank rows are
  unresolved, not wrong. A record whose owned rows got no marks is omitted.
- A record fully answered flips `live → satisfied`. Partial coverage stays
  live — the child re-feeds a finished card.
- **One bad record cannot destroy a cardmate's grade**: a per-record failure
  (drift, missing revision) becomes an error entry on that record alone;
  every other record on the same physical card still grades.

**Diagnostics** — a child's work never vanishes below `warn`:

| Signal | Meaning |
|---|---|
| `scan-unknown-card` | real answers on a card the store has never seen — almost always a mis-bubbled id (7 digits, no check digit). Suggests live cards one digit away (Hamming-1) |
| `scan-dead-card` | the card's records are all released/superseded, yet answers arrived — a retired sheet was fed |
| `scan-record-refused` | one record refused (drift / resolve failure), with its code; excluded from the resolved log |
| `scan-rescored` | a settled record was re-graded — a re-fed card or a borrowed card id |
| `scan-live-record-unmarked` | the wrong-rows signature: a live record's rows got zero marks while other rows on the card were answered |

**Evidence.** Every graded row becomes a paper-transport attempt in the same
append-only per-learner log the on-screen quiz engine writes
(`data/users/{id}/apps/school/attempts/{date}.yml`), filed under the
document's taxonomy (`bankId <docId>@<rev>`, subject from the id's first
segment), with the card/record/row provenance attached. Recording is
**idempotent per (record, row, given)**: re-feeding an identical card writes
nothing; a partial feed then a complete re-feed appends only the missing
rows; changed answers append as new evidence (and warn). An unattributed
scan (an anonymous worksheet card) records nothing, loudly.

Each attempt also carries **full curriculum context, not just subject**: a
`learning: {subjectId, courseId, unitId, conceptIds}` block — subject/course
off the document's own taxonomy path, unit off the work session that issued
the sheet (when there was one), concepts off the graded bank item itself
(empty when the item names none) — plus a `workSessionId` in provenance,
which is the session that issued the paper, never the throwaway per-scan
grading session. This is what lets a report card fold paper-transport
evidence into the same course grades and concept-mastery facets on-screen
work produces.

**Assessment grouping is by card record, not by evidence id.** Attempts have
no work session behind a purely printed (non-tracked) sheet, so grouping them
into "one assessment" falls back to the scanned card's own record id rather
than treating each graded row as its own singleton — the same grouping
`buildRecentScores` already gives a session-backed quiz. Before this, two
attempts scanned off the same card with no session landed as two separate
one-question assessments in recent scores instead of one multi-row sheet.

**The session bridge.** A tracked quiz's allocation record carries its work
session, so a complete scan advances the session the same way every other
transport does — `issued → submitted → graded`, with an item-count percent
and the real attempt ids. Two things hold it back on purpose:

- A **partial** feed records its attempts and waits — an unfinished sheet is
  never graded into the session.
- **Anything a machine cannot honestly grade goes to a person first.**
  Machine-graded rows land in the review queue as *resolved* engine verdicts
  (the durable per-item verdict sheet); ambiguous double-marks and write-on
  questions (short answer / essay — top-level or inside an inset) are queued
  *pending*, and the session holds at `submitted`. A grown-up resolves the
  pending items through the existing review flow, and the ordinary grading
  path finishes the session from the queue roster — print units derive their
  expected-item set from that same queue, which is the only roster that
  matches a bank-selected sheet's actual questions.

From `graded`, the ordinary session machinery takes over (outcome, rewards,
remediation), exactly as for on-screen work. The graded event retains the exact
correct/total counts and missed item ids. A linked remediation session copies
that immutable missed-item roster; issuance then creates a fresh worksheet
snapshot for only those items while the allocation planner continues on the
same physical answer sheet when rows remain.

## 9. Trust model and known limits

Print endpoints are unauthenticated household surfaces; the only privileged
artifact is the answer key, gated by `print.teacherPin` (school config,
boot-cached). A bare teacher-key read (`teacher=1&pin=` on the GET) still
rides the query string — visible in access logs and browser history — an
accepted trade at household scale: **it gates children, not adversaries.**
Card-minting renders (`freshCard=`/`card=`, and a key combined with either)
moved to `POST /print/render`'s JSON body (punch 5b) precisely because that
render also mutates state — a mutation's pin belongs in a body, not a URL.

Known, accepted limits (each was reviewed, not overlooked):

- **Scan-time learner binding is physical-world trust.** Nothing stops a
  child bubbling a sibling's card id; the first scan of a not-yet-settled
  record grades under the record's learner. Repeats warn (`scan-rescored`);
  first-scan impersonation is a paper problem, and sessions carry a
  `reassigned` escape hatch.
- A complete re-feed after a partial records only the fresh rows' attempt ids
  on the graded event (the queue's verdict sheet carries the full set).
- The evidence dedup key ignores a correctness flip caused by editing a bank
  answer after the fact (same given, new verdict) — republish under a new rev
  instead.
- Proofing an edited-but-unpublished change via the HTTP route serves the
  stale published artifact (by design — see §3); use the CLI's plain proof
  render for drafts.

## 10. Where it lives

| Layer | Path |
|---|---|
| Document schemas + validation (pure) | `backend/src/2_domains/school/documents/` — source/v2 envelopes, blocks, shuffles, fit, allocation planning, OMR form geometry |
| Publish / render / scan / record (use cases) | `backend/src/3_applications/school/documents/` |
| Issue + grade + review (session use cases) | `backend/src/3_applications/school/usecases/` |
| Stores | `backend/src/1_adapters/school/documents/` — document repository (two roots: `sourceDirectory` = the catalog shelf; `directory` = the artifact root holding `published/` + `derived-banks/`), allocation store (`allocations/`) |
| PDF rendering | `backend/src/1_rendering/school/documents/` — workbook theme, measure/place, draw, furniture |
| API | `backend/src/4_api/v1/routers/school.mjs` → `GET /api/v1/school/print/*` (proof renders + card lookup) and `POST /api/v1/school/print/render` (card-minting renders) |
| Scan wiring | `backend/src/5_composition/modules/schoolPrintScanConsumer.mjs` |
| CLI | `cli/school.mjs docs` |
| Content (sources) | `data/content/school/catalog/documents/` — hand-authored, by taxonomy path (CLI: `--source-root`) |
| Content (artifacts) | `data/content/school/print-documents/` — `published/`, `derived-banks/`, `allocations/` only (CLI: `--content-root`) |
| Evidence | `data/users/{id}/apps/school/attempts/` (shared with the on-screen engine) |
| Config | `data/household/config/school.yml` → `print.teacherPin` |

Curriculum units reference a print quiz as `document: print/<id-path>@<rev>`
— the rev is pinned at authoring time, so a republish never silently changes
what an assigned unit prints.
