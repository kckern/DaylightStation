# Print Documents — Worksheets, Quizzes, and OMR Grading

> **Status: implemented.** Verify the active deployment separately. The full
> loop is: author a YAML source → publish → render on demand (per-student,
> per-variant) → the student answers on a physical bubble card → the card scan grades, records
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
id: arts/creature-identification/quiz-1     # hierarchical taxonomy id
subject: arts                               # must match the id's first segment
topics: [popular-culture, creature, identification]
seed: 80426
target: [letter]
archetype: quiz                             # or worksheet — the stakes dial
title: "Creature Identification — Quiz 1"
header:
  instructions: "Mark your answers on your bubble card."
fit:
  policy: flow                              # flow | one-page | fill | prefer-one-page
  typeScale: standard                       # standard | young
blocks:
  - type: question
    key: pk1
    bankId: arts/creature-identification/creature-identification-medium
    select: 6                               # bank-select sugar: 6 seeded picks
```

- **Ids are taxonomy paths** — 1–4 kebab-case segments
  (`subject/course/slug`). A flat slug is still legal. When a `subject:` field
  is present on a hierarchical id, it must equal the first segment;
  contradiction is a validation error, not metadata. Source files nest under
  their id's path
  (`catalog/documents/arts/creature-identification/quiz-1.yml`).
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

### Teacher history and artifact lineage

A teacher history view is a **read-only projection of one work session**, not
a new print request. The projection joins the append-only session events with
the issued worksheet instance, its exact published document revision, answer
evidence, assessment revisions, and any retained rendered bytes. It must not
allocate an OMR card, republish a document, alter a grade, or create an
artifact merely because someone opened the record.

`school.teacher-session/v4` is the browser contract for that projection. It
returns human taxonomy (subject, course, module, lesson), a named assignment
with the frozen questions, item-level assessment evidence, and an artifact
lineage. Internal ids remain links between records; they are never the title
shown to a teacher.

Every newly issued worksheet artifact uses `school.session-artifact/v2`. Its
manifest records the linked session or sessions, document revision, frozen
render context, OMR mapping, parent lineage, and an integrity hash over retained
bytes. A composed worksheet is one shared artifact linked to every included
session; it is never reconstructed as several individual worksheets.

Settlement result receipts use `school.session-artifact/v3`. Before the
thermal job is sent, the rendered PNG and the complete result-document input
(including its timestamp, learner context, score, question marks, feedback,
and action codes) are captured immutably. The printer receives those retained
PNG bytes, so **Open original receipt** and a subsequent reprint refer to the
same object the child was handed — viewing teacher history never renders or
creates an artifact. `result_receipt_captured` links the receipt to its session
without placing it in the worksheet issue/reprint list; `result_receipt_reprinted`
records a separately authorized physical dispatch.

Teacher history can also offer **Open frozen replay** for a v3 receipt. That is
a new compatible rendering of the frozen `sourceDocument`, clearly labelled as
a replay; it never replaces, overwrites, or claims to be the retained original.
An adult grade adjustment or retraction creates a new non-printing
`result-correction` receipt artifact, parented to the previous receipt, and
leaves the original result and original paper untouched. Legacy records retain
their legacy/exact availability label and are never silently restyled.

The same rule applies to a systematic bank regrade. It first appends corrected
attempt evidence; only when all of a session's immutable graded roster can be
accounted for does it append a deterministic effective-grade correction through
the normal reward-aware adjustment path, which captures a parented corrected
receipt. Sessions with a later manual adjustment or incomplete evidence are
reported as skipped rather than guessed at.

There are four honest artifact representations during the incremental rollout:

- An `school.issued-artifact/v1` has retained PDF bytes. Its **issued PDF** is
  the exact object sent to the printer and may be explicitly reprinted.
- `exact` means retained bytes are available and are the only bytes a reprint
  may dispatch.
- `deterministic-replay` means a compatible renderer can reproduce a frozen
  document revision and complete issue context, including the original card
  rows, without calling the allocation store.
- `semantic-reconstruction` and `unavailable` are explicit historical states;
  neither may be presented as the paper a learner received.

Viewing any of these records is pure and does not backfill a new artifact.

Every future assignment and feedback/result rendering should bind an immutable
render specification (document or feedback inputs, creation time, medium, and
renderer revision); retain bytes whenever they were actually issued. A grade
correction appends a new assessment/feedback artifact and leaves the original
assignment artifact untouched. Printing that feedback remains a separate,
explicit action.

### Composed daily worksheets

A daily worksheet is a **single flowed document**, not a stack of individually
rendered PDFs. It has one name/date header, continuous question numbers, and
one shared physical OMR card. Each lesson begins with a full-width lesson card:
the real subject SVG, a subject/course/topic breadcrumb, lesson title, quiet
print-book citation, and question/mastery metric. A `Read:` line appears only
when the course supplies a real learner-facing section locator or printed page
range; sidecar EPUB filenames, chapter-file numbers, and generic text such as
"assigned section" never reach a child. The component lesson instances remain
immutable; composition only creates a new print artifact that scopes their
question ids by section.

When a `prefer-one-page` worksheet genuinely spills after compact fitting, the
renderer balances whole question fragments across the resulting pages. It
therefore avoids a small final orphan question while preserving the sequence;
a substantial question may still begin a page on its own when moving it would
create a worse break.

The allocation persists each section's exact row range and session/lesson
ownership beside the card record. A scan can therefore be repeated while the
card is in progress: nonblank rows become evidence immediately, a completed
section advances only its own session, and the card remains live until every
allocated row has an answer. A document exceeding the 50-row OMR capacity is
split into sequential parts, each with its own card.

For safe proofing without issuing an enrollment, use the same composition core
from the CLI:

```sh
node cli/school.mjs worksheet compose \
  --lesson science/molecules-ted-gray/molecules-ch01-house-built-of-elements \
  --lesson science/molecules-ted-gray/molecules-ch02-power-of-names \
  --profile upper --seed friday --out /tmp/friday.pdf
```

`--lesson` and deterministic `--sample subject/course:N` may both be repeated.
This preview writes only the requested PDF; it does not create an enrollment,
worksheet instance, published revision, allocation, or OMR card record.

For a real multi-lesson issue, `POST /api/v1/school/lifecycle/worksheets/compose` accepts
`{ "sessionIds": ["…"], "issuedBy": "teacher-id", "pin": null }` from the
browser, where the router replaces the null proof with its HttpOnly teacher
capability. Raw-PIN CLI clients remain supported. The operation creates (or reuses) the immutable per-lesson
instances, publishes one composed document per 50-row card, persists each
section's row ownership in the allocation, and appends the corresponding
issue/reprint event to every participating session. This is the production
entry point for an agenda or teacher-selected subset; its teacher stamp and
authorization are checked server-side and it does not introduce a second, packet-only grading
record.

The teacher console obtains its checklist from
`GET /api/v1/school/lifecycle/learners/:learnerId/printable-sessions?window=today`.
That endpoint filters out terminal, media-only, and document-backed sessions;
the compose endpoint validates the same bank-only constraint again before it
can dispatch paper.

**Renders are published-first.** Every render lane that can pin a revision —
the HTTP route, the tracked-quiz issue path, and the CLI's card mode —
resolves the published artifact; the raw source only renders when the
document has never been published (proofing a draft) or through the CLI's
plain proof render. This matters because a card allocation records the rev it
rendered, and a scan later resolves that exact rev: a source that drifted
from its published artifact would otherwise mint a "phantom" rev no scan
could ever serve.

**Issued bytes are retained, not reconstructed.** Before a tracked PDF is sent
to the printer, School archives the exact PDF plus a compact manifest containing
the artifact id, capture kind, exact byte and page counts, SHA-256 digest,
issuance time, session/learner/unit lineage, and worksheet/card allocation
identifiers when present. The retained bytes—not a later render—are what the
teacher downloads as the issued original. Pre-retention legacy sessions may
have lifecycle metadata without a retained PDF; the UI says so instead of
implying byte identity. The teacher session inspector exposes:

- the manifest and immutable original PDF;
- a separately labeled postview PDF that overlays later grades/corrections.

The original-PDF link supports browser/manual reprinting of the retained bytes.
There is not yet a separate server-side “send this artifact to the printer
again” teacher operation, so the console does not claim a dispatch receipt for
that manual reprint.

Postview is a derived view, not the original artifact, and requires a one-use
teacher grant scoped to `artifact.postview` plus that artifact id. Its presence
cannot mutate the archived original or the session evidence.

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

That decision travels with the render: `execute()` returns `duplex`
(`true` / `false` / `null` for v1), and `IssueDocument` and
`ReplaceLostAnswerSheet` pass it to `printPdf({ duplex })`.

> **⚠️ The per-document choice no longer reaches the paper.** `duplex: false`
> is currently a **no-op**. Sidedness is supplied by the printer's own
> `sides-default`, applied to every job, and the adapter cannot opt a single
> job out: this firmware rejects the IPP `sides` attribute at *any* value —
> including `one-sided` — so there is no way to request single-sided for one
> document. See [`README.md` → Printing → Duplex](./README.md) for the
> measurements.
>
> With the device set to `two-sided-long-edge`, a multi-page `quiz` or
> `infopage` prints double-sided with its gutter fixed to the left of every
> page. **This is a comfort loss, not a correctness problem** — see
> *Punch clearance* below before treating it as a defect.

**Punch clearance: the base margin already covers it.** These documents are
loose-leaf; three-hole punching is an archival afterthought, not the primary
use. And the gutter is not what keeps holes out of content:

| | points | inches |
|---|---|---|
| `page.marginPt` — applied to **both** edges | 54 | 0.75″ |
| `furniture.gutterPt` — added to **one** edge | 18 | 0.25″ |
| Outer edge of a standard ¼″ hole centred ½″ in | ~45 | ~0.625″ |

`contentBox` builds `contentLeftPt = page.marginPt + leftPt` and
`contentRightPt = pageWidth - page.marginPt - rightPt`, so the 54pt base margin
is present on the gutter-less side too. A punch reaching ~45pt from the edge
still clears content by ~9pt. What the gutter buys on the bound edge is
breathing room from the rings, not hole clearance.

So a fixed-gutter document printed double-sided loses 18pt of binding-edge
comfort on its versos and nothing else. Do not "fix" it by reverting the device
to single-sided; that costs twice the paper on every worksheet to buy comfort on
archived quizzes.

The layout rule itself is unchanged: a `worksheet` is built for double-sided
binding, `quiz` / `infopage` are not. If perfect archival binding is ever wanted
for them, adding an archetype to `DUPLEX_ARCHETYPES` is cheaper than it sounds —
`contentBox` returns an identical `widthPt` either way (recto reserves left,
verso reserves right, both give up the same room), so mirroring reflows nothing
and repaginates nothing; only `xPt` changes. The care needed is in OMR: bubble
coordinates shift on verso pages and `formMap` drives grading, so the
zero-tolerance coordinate assertions in
`tests/isolated/rendering/school/golden/golden.test.mjs` must be re-verified,
not regenerated.

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
an exact set); a double mark on a single-select row grades *ambiguous* and is
queued for a person to look at — **except for the eraser signature**
(2026-08-22 policy), which is credited outright:

- **Two marks, one of them correct, earn full credit.** A child who erases
  one bubble and fills another often leaves enough graphite for the reader to
  see both — that reads as an eraser, not a guess.
- **Everything else about a multi-mark row still holds for review, never
  guessed at.** Three or more marks never earn credit, even when one of them
  is correct. Two marks where *both* are wrong never earn credit. Marks
  covering **every available choice** never earn credit regardless of count —
  this is what stops a true/false row (only two choices) from being
  auto-credited by the rule above: marking both options *is* marking
  everything.
- **The credit is bounded per sheet:** at most `max(1, floor(rowCount / 5))`
  rows on any one card may be credited this way, spent in question-number
  order so the cap is deterministic. A row that would otherwise qualify but
  finds the budget already spent falls through to the review queue exactly
  like an ordinary ambiguous row.
- **Strictness is archetype-driven.** A `worksheet` (low-stakes practice) is
  graded leniently; a `quiz` (and `infopage`) is strict — the cap is 0, so a
  quiz's double-marks are never credited and always hold for review, exactly
  as before this policy existed.

A row this rule promotes is recorded as `correct` with a `leniency: 'eraser'`
marker carried through to the verdict sheet (`gradedBy: 'engine-leniency'`
there, distinct from a plain `'engine'` verdict) — auditable, never silent.

Every card-backed render writes (or reuses) an **allocation record** at
`data/content/school/print-documents/allocations/<cardId>.yml`:

```yaml
- recordId: arts/creature-identification/quiz-1@632002966:v2:1-6
  cardId: '9251793'
  rowRange: {start: 1, end: 6}
  documentId: arts/creature-identification/quiz-1
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
active capability (or a raw PIN from a compatible non-browser client). It is
available in two forms:

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
(`…/print/arts/creature-identification/quiz-1`). Returns the PDF inline
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
  `<dataDir>/household/school/records/worksheets/<sessionId>.yml` and
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

**A scan that goes nowhere says so.** The two events that explain "I scanned it
and nothing happened" are deliberately loud and carry their reasons:

| event | level | carries |
|---|---|---|
| `school.print.scan-unresolved` | `warn` | `testId`, `code`, `testIdCandidates` count, `answerCount` |
| `school.print.scan-awaiting-review` | `info` | `sessionId`, `recordId`, `pendingReview`, `learnerId`, `reasons`, `items` |

`scan-unresolved` is `warn`, not `debug`, because debug-level events are not
shipped to the log store at all — at debug this line was dropped entirely and
an unreadable sheet left no trace anywhere. The candidate count is what
distinguishes "the id was unreadable" from "the id was ambiguous."

`scan-awaiting-review` names `reasons` and `items` because `pendingReview: 1`
alone required reading the queue file on disk to learn *which* row stopped the
session and why. A sheet parking silently in review, with no receipt printed
and no signal in the room, is the failure mode these two events exist to make
visible.

**The grading hook.** When a Home Assistant gateway is configured for the
household, `SchoolGradingHookAdapter`
(`backend/src/1_adapters/school/SchoolGradingHookAdapter.mjs`) fires one HA
script on each of the four terminal scan outcomes below — a signal in the
room, not just on a screen or in the log store. It does **not** fire on a
card the store has never seen, a card whose records are all retired, or a
scan that resolves to no live allocation at all (`unknownCard`, `deadCard`,
no-allocation — see the diagnostics table further down); those are not
outcomes of a resolved scan, they are scans that never reached one.
`school.yml`:

```yaml
grading_hook:
  script: script.school_graded
```

Presence of `script` is the entire enable switch — no `enabled` flag, no
score bands, no throttle knob. With no Home Assistant gateway configured at
all, or with `grading_hook` absent from `school.yml`, the hook never fires
and the scan consumer runs exactly as it did before this existed.

Dispatch is `gateway.callService('script', <service>, variables)`. A
configured `script.school_graded` and a bare `school_graded` both resolve to
service `school_graded` — the `script.` prefix is optional.

**All four terminal outcomes fire** — `graded`, `review` (awaiting-review),
`unresolved`, and `refused` — every call carrying the SAME 11 keys,
snake_case to match Home Assistant convention rather than this codebase's
camelCase. A key that doesn't apply to a given outcome still rides along as
`null` (or `[]` for the two list-valued keys) rather than being omitted, so
an HA template can write `{{ percent }}` without an `is defined` guard:

| variable | graded | review | unresolved | refused |
|---|---|---|---|---|
| `result` | `graded` | `review` | `unresolved` | `refused` |
| `learner_id` | ✓ or `null` | ✓ or `null` | `null` | ✓ or `null` |
| `test_id` | ✓ | ✓ | ✓ | ✓ |
| `session_id` | ✓ | ✓ | `null` | `null` |
| `percent` | ✓ or `null`* | `null` | `null` | `null` |
| `earned` | ✓ | `null` | `null` | `null` |
| `total` | ✓ | `null` | `null` | `null` |
| `pending_review` | `null` | ✓ | `null` | `null` |
| `reasons` | `[]` | ✓ | `[]` | `[]` |
| `items` | `[]` | ✓ | `[]` | `[]` |
| `code` | `null` | `null` | ✓ | ✓ |

\* `percent`, `earned`, and `total` are the **gradebook's own numbers** —
`RecordCardScanOutcome` surfaces the row-count `percent`/`correctCount`/
`totalCount` it just wrote into the session's `graded` event (the SAME
numbers `reduceSession` turns into `gradedPercent`, which drives pass/fail,
course grades, and the report card) onto the session object the consumer
reads, and the consumer sends those on unchanged. They are deliberately
**not** an independently computed points-based figure
(`earnedPoints`/`totalPoints`) — on a weighted worksheet (rows worth
different point values) the two disagree, and sending the points figure here
let the room announce a different outcome than the report card recorded.
`percent` is `null` only if the session bridge did not attach a number
(defensive; the ordinary path always does); otherwise
`round(correctCount / totalCount * 10000) / 100`, so it never comes through
as `NaN`.

For a composed multi-section worksheet, the hook fires **once per section**
as each section independently reaches `graded` or lands in review — every
fire carries that section's own row-count `earned`/`total`/`percent` (not the
whole card's aggregate score), because `RecordCardScanOutcome` grades and
bridges each section as its own independent session. A single-section
(legacy) card fires once, same as any other outcome.

**Home Assistant owns everything downstream of `result`.** This repo hands
over the outcome and gets out of the way; HA branches on `result` (and
whatever else it needs) to decide what happens next. There is deliberately
**no score-band → script mapping and no per-learner override in
`school.yml`** — both were considered and rejected, because either would put
behaviour in two places and force a redeploy of this repo to retune a light
or change one child's rule. A household that wants a different scene above
90%, or a distinct chime for one kid, writes that branch in the Home
Assistant script keyed on `percent` / `learner_id` — it does not belong in
this repo's config.

**The hook can never affect grading.** The consumer calls
`gradingHook.fire(...)` fire-and-forget — never awaited into the grading
path — with a `.catch(() => {})` at each call site as belt-and-suspenders
for a hook that somehow rejects outright. The adapter itself never throws:
`fire()` always resolves, to `{ok:true, ...}` or `{ok:false, error}`.

A "gateway failure" that arms the circuit breaker means **either** a thrown
error **or** a returned `{ok:false, error}` — the real
`HomeAssistantAdapter#callService` never throws at all; a downed HA, a bad
token, or a missing domain/service all come back as `{ok:false, error}`, with
no network call made in the last case. The adapter checks `result.ok` and
throws internally when it's falsy, so both shapes land in the same inner
`catch` and both count toward the breaker identically. (Before this was
fixed, only a thrown error counted — a gateway that only ever returns
`{ok:false}`, which is what the real one does, could never open the breaker
at all, and every one of its failures logged as a `fired` success.)

A circuit breaker opens after 5 consecutive gateway failures and backs off
exponentially (capped at 60s). Mechanically, a success does **not** reset
`backoffUntil` — the backoff window simply *elapses* (this is what gates the
next attempt back in), and if that next attempt succeeds, `failureCount`
zeroes; `backoffUntil` itself is never explicitly reset by a success, it is
just already in the past by the time the next failure (if any) would
recompute it. There is no deduplication and no throttle — two learners each
scoring 83% both deserve their own light, and three children scanning in
succession must all fire, so nothing here collapses or drops a repeat.

Adapter-side logs: `school.grading_hook.fired` (script + result), `.skipped`
(reason `not_configured` or `backoff`), `.failed`, `.circuit_open`, and
`.error` for a config-load failure — distinct from `.failed` because it never
touches the gateway or the breaker.

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
  (the durable per-item verdict sheet) — including a double-mark the bounded
  eraser-leniency rule credited (§5.4), resolved as `gradedBy:
  'engine-leniency'` so it stays distinguishable from an outright single-mark
  verdict. Every OTHER ambiguous double-mark and write-on question (short
  answer / essay — top-level or inside an inset) is queued *pending*, and the
  session holds at `submitted`. A grown-up resolves the
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

### Teacher retained-artifact workflow

Every issued worksheet retained by `YamlIssuedArtifactStore` is immutable.
Teacher Open PDF reads those exact bytes; teacher Reprint sends those same
bytes and preserves the artifact id, Student No., allocation, and row range.
Direct printing requires a fresh teacher confirmation plus an idempotency key,
and appends `reprinted` only after the printer confirms. It never allocates a
new answer card. A lost card must use the replacement flow, which commits the
new identity only after successful printing.

Answer-card capacity is physical history, not the number of live allocations:
`usedRows` is the highest row ever allocated across live, satisfied, released,
and superseded records. Rows are never reclaimed. A card occupied through row
26 therefore has 24 contiguous slots left on a 50-row card.

New paper attempts retain both `studyDay` (from their issuing session) and
`processedAt` (scan ingestion time). The OMR scan key plus session and item is
the deduplication identity, so re-feeds do not inflate daily work. Machine and
effective result PNG routes render the decoded OMR evidence; they are labeled
as rendered/reconstructed artifacts because the device does not provide a
physical scan photograph.

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
| Config | `data/household/school/school.yml` → `print.teacherPin` |

Curriculum units reference a print quiz as `document: print/<id-path>@<rev>`
— the rev is pinned at authoring time, so a republish never silently changes
what an assigned unit prints.
