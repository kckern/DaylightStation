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

---

## 2. Authoring: the source document

A source lives under `data/content/school/print-documents/` as
`school.document-source/v1` YAML. It is the ONE place answers may appear —
publishing strips them.

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
  policy: flow                              # flow | one-page | fill
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
  their id's path (`print-documents/arts/pokemon-identification/quiz-1.yml`).
- **Blocks** are the closed set from the learning-document system (rich text,
  math, figures/assets, insets, lists, wordbank, matching, cloze,
  short answer, essay, questions with inline choices or bank-select,
  multi-select, true/false, scan/media action codes) plus layout controls
  (dividers, spacers, page breaks). Wordbank/matching orders are
  seeded-shuffled; cloze blanks are fixed-width atoms.
- **Fit** is decided by measurement, never streaming: `flow` paginates,
  `one-page` must fit (density falls back to compact before refusing with the
  overset amount), `fill` grows answer spaces into leftover page space.
  `typeScale: young` enlarges glyphs *and* leading for early readers.
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
(x-of-y footers, continuation strips, duplex gutters), and vector QR codes
for any action block whose token was minted at issue time.

Two **varieties** exist at the request level:

- **`omr`** — card-backed. The sheet carries a card banner ("Card
  **1443186** — questions 1–6", with a first-use instruction to bubble the
  number into columns 1–7 of a fresh card, or a "use your card" reminder on a
  reprint) and **no on-page bubbles**. The student reads the sheet, marks the
  physical card.
- **`hand`** — hand-graded. Bubbles print on the page; no card, no
  allocation, nothing tracked.

**The teacher key is a render mode, not a separate document**: the identical
student pages plus appended dense answer pages (namespaced entries — bare
numbers for questions, `Fill-in (passage N): blank n:`, `Matching:`). The
fit/pagination decision is computed identically with or without the key, so a
key can never disagree with the sheet it answers. Keys are gated: `teacher=1`
requires `pin=` matching the household school config's `print.teacherPin`,
and denies when unset or wrong (see §9, trust model).

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

## 6. The print API

`GET /api/v1/school/print/<id-path>` — the id is the full taxonomy path
(`…/print/arts/pokemon-identification/quiz-1`). Returns the PDF inline
(filename from the slug), with `X-School-Print-Allocation` (the card record
summary) and `X-School-Print-Warnings` headers.

**`GET /print/<7 digits>` is a card lookup.** The card number is the one
thing printed in large digits on the sheet in a child's hand, so it is
enough by itself: the path resolves the card's newest usable allocation and
reproduces its exact sheet (adoption semantics — the record's
rev/variant/rows/learner govern; `teacher=1&pin=` works on top for its key).
An unknown card 404s with Hamming-1 live near-miss suggestions, the same
courtesy a mis-bubbled scan gets. Bare 7-digit *document* ids are reserved
at validation time so the shape can never be ambiguous.

| Param | Meaning |
|---|---|
| `variety=omr\|hand` | **default `omr`** — card-backed (the main mode) unless `hand` is asked for |
| `learnerId=` | whose sheet. **Required for quiz-archetype omr renders** (or an explicit `card=`) — without it two siblings would share one sheet identity. Worksheets may stay anonymous; teacher renders are reads and stay exempt |
| `teacher=1&pin=` | append the answer key; pin must match `print.teacherPin` |
| `rev=` | pin a 9-hex published revision (default: latest published) |
| `variant=0..999` | per-student shuffle variant |
| `card=NNNNNNN` | reproduce (or extend) a specific physical card |
| `startRow=1..50` | with `card=`: attach this document at a row offset (card sharing) |
| `freshCard=1` | force-mint a new card |
| `retake=1` | fresh card at the learner's next unused variant; rejects all explicit identity params |
| `learnerName=`, `date=` | prefill the header lines |

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

`node cli/school-docs.cli.mjs` (`npm run school:docs`):

- `validate <file|dir>` — parse + validate, render-free, sub-second (the AI
  repair loop's inner step).
- `publish <file>` — source → published + derived bank, append-only.
- `render <file> --out <pdf>` — the real fit/render pipeline. Flags:
  `--teacher`, `--learner-name`, `--date`, `--type-scale`,
  `--card <id> | --fresh-card`, `--start-row <n>`, `--learner-id <id>`.
  **Card mode always resolves the published document** — the file argument
  only supplies the id; an unpublished id fails with "publish first" rather
  than pinning a phantom rev.
- `release-card <cardId> [--rows a-b]` — allocation housekeeping.

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
remediation), exactly as for on-screen work.

## 9. Trust model and known limits

Print endpoints are unauthenticated household surfaces; the only privileged
artifact is the answer key, gated by `print.teacherPin` (school config,
boot-cached). The pin rides the query string — visible in access logs and
browser history — an accepted trade at household scale: **it gates children,
not adversaries.**

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
| Stores | `backend/src/1_adapters/school/documents/` — document repository (sources, `published/`, `derived-banks/`), allocation store (`allocations/`) |
| PDF rendering | `backend/src/1_rendering/school/documents/` — workbook theme, measure/place, draw, furniture |
| API | `backend/src/4_api/v1/routers/school.mjs` → `GET /api/v1/school/print/*` |
| Scan wiring | `backend/src/5_composition/modules/schoolPrintScanConsumer.mjs` |
| CLI | `cli/school-docs.cli.mjs` |
| Content | `data/content/school/print-documents/` (sources by taxonomy path, `published/`, `derived-banks/`, `allocations/`) |
| Evidence | `data/users/{id}/apps/school/attempts/` (shared with the on-screen engine) |
| Config | `data/household/config/school.yml` → `print.teacherPin` |

Curriculum units reference a print quiz as `document: print/<id-path>@<rev>`
— the rev is pinned at authoring time, so a republish never silently changes
what an assigned unit prints.
