# School Print Design System ("Workbook") product requirements

> **Status:** v1 requirements, revision 2 (post adversarial spec review).
> Canonical scope and boundary document for the School print design system:
> YAML-authored, AI-compiled, on-demand-rendered PDF documents — quiz sheets,
> worksheets, and (later) textbook-style info pages — built by evolving the
> existing printable document machinery (`2_domains/school/documents/`,
> `1_rendering/school/documents/`). The OMR reader, Print Center, and
> SchoolCalc documents refine or consume this contract; they do not override it.
>
> **Revision 2 changes:** source-vs-published split resolves the answer
> paradox (§3); card identity rebuilt on the calibrated hardware — random
> numeric 7-digit card-instance IDs, two-bank row model, integration with the
> existing scan decoder (§5); honest envelope migration — versioning
> introduced (the existing envelope is version-less), `id` kept, `variant`
> stays an integer, teacher key is a render mode not a variant (§4); shuffle
> derivation defined on stable block keys with a post-issue immutability rule
> (§4.3); allocation-record lifecycle (§5.4); `multi_select` grading rule
> (§5.5); `fill` correctly described as inverting the last-page exclusion
> (§7); IssueDocument binding wired (§9); acceptance criteria extended and
> the work phased A/B/C (§12, §13).

## 1. Product definition

The household's primary learning-content workflow is: **find source material
(a PDF book, HTML page, Wikipedia article, video or audiobook transcript) → AI
transforms it into lessons and comprehension worksheets/quizzes → print →
students complete → pass off.** This product is the print half: a design
system that turns validated YAML into workbook-quality PDF pages.

Three governing ideas:

1. **A printout is an app screen, not a file.** A print-document is a
   *parameterized template*, rendered on demand for a specific learner with a
   specific seed, variant, date, and card allocation. The same document
   renders per-kid variants at the kitchen table and re-renders
   byte-identically weeks later for regrading.
2. **The primary author is an LLM.** The schema is a compilation target:
   strict validation, dotted-path errors, predictable shapes — because the
   authoring loop is generate → validate → repair, and strictness with good
   errors is what makes that loop converge. Hand-authoring and compilation
   from question banks are secondary modes of the same schema.
3. **Answers ride separate paper.** Quiz answers are marked on official
   Chatsworth OMR cards, never bubbled on the printed sheet. Printed sheets
   carry questions, choices, scratch space — and a numbering contract that
   maps 1:1 onto card rows (§5).

Document archetypes, in v1 priority order:

- **Quiz sheet** — closed-book, tracked, OMR-answered. Name/date/score
  header, numbered questions with Ⓐ–Ⓔ glyph choices, all scored items
  row-mappable to the card.
- **Worksheet** — the same block family at lower stakes: open-book practice,
  loose printing, optionally OMR-assisted for ungraded feedback, plus
  write-on blocks (cloze, matching, essay lines, wordbank) that never touch
  a card.
- **Info page** *(later)* — textbook-style teaching pages. The block and
  theme vocabulary anticipates them; v1 ships no info-page-only feature.

Quiz and worksheet are **one schema with a stakes dial** (archetype presets),
not two systems.

## 2. Product principles

- **Evolve, don't fork.** One block registry, one layout engine, one renderer
  family. The v2 envelope *introduces* versioning to a currently version-less
  document shape (§4.1); it does not create a parallel system.
- **The block set is closed.** Inventing a block is a code change, never
  config. Every block has a renderer for every target it claims; an
  unsupported combination is a validation error, not a render crash.
- **Deterministic regeneration.** `seed` is mandatory (existing rule). Every
  shuffle derives from `(seed, variant, block key)` (§4.3). Re-rendering with
  the same context is byte-identical (modulo the pdfkit CreationDate handling
  the existing golden tests already use).
- **Published documents cannot contain answers.** The existing
  `collectAnswerKeys` invariant stands for everything that can reach a
  learner's printer. Answers are authored in the *source* stage and live in
  derived banks after publish (§3). The teacher key is a render mode, never
  an embedded field.
- **Fail closed at validate time.** Overset one-pagers, non-row-mappable quiz
  items, allocation overflows, unsupported block×target combinations — all
  are validation/publish errors with dotted paths and actionable amounts, so
  the AI repair loop (and the human) fixes the document, not the printout.
- **Subject-neutral framework.** Blocks and layout speak structure
  (passage, wordbank, matching), never subjects.
- **One aesthetic, tokenized.** Modern workbook: clean sans, bolder heads,
  rounded boxes, friendly density, photocopy-safe grayscale. Every drawn
  dimension reads from theme tokens so a future classic-textbook variant is
  a second token file, not new rendering code.

## 3. Source vs published — where answers live

The AI (or human) authors **one source file**; publishing splits it:

```
source (.yml, answers legal)  --publish-->  published document (answer-free)
                                        \->  derived question bank (answers)
```

- **Source stage** (`school.document-source/v1`): the authored file. Question
  items MAY carry `answer`/`answers` inline — this is the AI's natural
  output. `school:docs validate` applies the full envelope/block/fit/card
  gates but *permits* answers. Source files live in
  `content/school/print-documents/`.
- **Publish** (`school:docs publish`): deterministic compilation. Emits
  (a) the **published document** — identical structure with every
  `answer`/`answers` stripped and each inline question rewritten to
  reference its derived-bank item; and (b) the **derived bank** — an
  ordinary question bank (existing schema) holding the items *with* answers,
  id `derived/<documentId>@<rev>`. Published artifacts are generated files
  beside the source; they re-validate under the strict gate (the
  `collectAnswerKeys` ban) as a publish postcondition.
- **Revisions:** publish computes `rev` = short content hash of the source.
  Publishing an edited source creates a new `(documentId, rev)`; prior
  revisions and their derived banks are retained (append-only) because
  allocation records and issued sessions pin the rev they printed (§4.3,
  §5.4).
- Questions that already reference an existing bank (`bankId` form) pass
  through publish untouched — the derived bank covers inline items only.
- **Renders always use published artifacts.** The CLI's `render` on a source
  file implies an in-memory publish; a tracked issue (§9) requires a real
  published rev.

## 4. The envelope (`school.document/v2`)

### 4.1 Migration honesty

The existing envelope (`documentValidation.mjs`) is **version-less**: no
`schema` field, required `id` (pattern `^[a-z0-9][a-z0-9-]*$`), required
integer `seed`, `variant` as a non-negative safe integer defaulting to 0
(production `IssueDocument` compares `state.variant === (document.variant ??
0)`), `target: [letter|receipt]`. v2 therefore:

- **introduces** `schema: school.document/v2` (and `school.document-source/v1`
  for the source stage). A document *without* a schema field is a v1 document
  and continues through the existing validator unchanged — no migration of
  existing documents is required or performed.
- **keeps `id`** (no rename; the spec's earlier `documentId` is dead).
- **keeps `variant` as a non-negative integer.** `0` is the base variant;
  per-kid variants are small integers assigned at render. IssueDocument's
  comparison survives untouched.
- **keeps `target`** with the existing values, adding a static block×target
  compatibility matrix checked at validation (a `wordbank` with
  `target: [receipt]` fails validate, not render).
- **The teacher key is a render mode** (`--teacher`), orthogonal to seed and
  variant: it renders the *same* shuffles as the student sheet it
  accompanies, plus the answers from the derived bank. There is no "teacher
  variant."

  **Trust model:** print endpoints are unauthenticated household surfaces; the
  only privileged artifact is the answer key. `teacher=1` therefore requires
  `pin=` matching the household school config's `print.teacherPin` and denies
  (403) when unset or wrong. The pin rides the query string — visible in
  access logs and browser history — which is an accepted trade-off at
  household scale; it gates children, not adversaries.

### 4.2 v2 fields

```yaml
schema: school.document/v2            # source files: school.document-source/v1
id: us-states-quiz-3
rev: 8f3a21c                          # published artifacts only; stamped by publish
seed: 91242                           # REQUIRED (existing rule)
variant: 0                            # non-negative integer (existing rule)
target: [letter]
archetype: quiz                       # quiz | worksheet | infopage — preset bundle, not a schema fork
title: "U.S. States — Quiz 3"
header:                               # archetype presets; all overridable
  name: true                          # blank line, or pre-filled at render for a known learner
  date: true
  scoreBox: true                      # quiz default; worksheet default false
  instructions: "Mark answers on your bubble card."
fit:
  policy: one-page                    # flow | one-page | fill
  typeScale: standard                 # standard | young
defaultPoints: 1                      # number; per-question `points` overrides
source:                               # optional supplemental-content QR (sugar for a scan_action block)
  action: launch-states-video
  label: "Watch the review video"
blocks: [ ... ]
```

There is no authored `omrAllocation`: card attachment is render context
(§5.3). The document declares only which items are OMR-answered; validation
checks their count and row-mappability.

**Render context** (supplied at render time, never authored):
`{learnerId?, learnerName?, date?, variant?, cardId?, startRow?, teacher?}`.
A learner-aware render pre-fills the name line and uses the learner's
assigned variant; an anonymous render leaves write-on blanks.

**Sugar inventory** (finite, each unambiguous because it expands to exactly
one canonical form before validation): envelope `source` → a header-corner
`scan_action`; `short_answer`/`essay` → prompt + `answer_space`; the bank
`select` form → a seeded item list. Nothing else desugars.

### 4.3 Shuffle derivation and post-issue immutability

- Every shuffling block (`wordbank`, `matching`, bank-`select` questions)
  carries a **required author-assigned `key`** (short string, unique within
  the document). The shuffle for a block is
  `shuffle(seed, variant, key)` — stable under document edits, insertions,
  and reordering, unlike positional paths.
- Published revisions are **immutable**: editing the source and republishing
  creates a new rev; it never mutates an existing one. Allocation records
  and issued sessions pin `(id, rev)`, so a card scanned after an edit still
  grades against exactly the revision the student held. A scan resolving to
  a superseded rev is graded normally and flagged `revisionSuperseded` in
  the result for the teacher's awareness.

## 5. The OMR card contract

### 5.1 The physical card (calibrated reality)

Chatsworth cards as calibrated in `docs/reference/omr/README.md`: 32 physical
columns; **columns 1–7 encode a 7-digit numeric test ID** (one digit per
column, digit *d* = bit (9−*d*)); questions occupy 25 columns × two banks —
**Q1–25 in the upper bank (bits 10..6), Q26–50 in the lower bank (bits
4..0)**; 5 answer positions (A–E) per question; the reader returns full row
masks, so multi-mark rows are decodable. A shared-row range may span the
bank boundary (…24, 25, 26…) — bank placement is a decoding detail, not an
allocation constraint.

### 5.2 Card identity: random numeric card-instance IDs

- A **card ID names one physical card instance**, not a document. IDs are
  **random 7-digit numbers** (leading zeros legal, avoiding all-zero),
  drawn at allocation time and collision-checked against the allocation
  store — random so IDs behave like opaque handles (no ordering, no
  guessing), per stakeholder direction.
- **The student bubbles the ID in.** Every sheet attached to a card prints
  the card ID prominently in its header as seven large digits ("Card
  4 8 2 9 3 0 6 — questions 18–30"). The first sheet issued against a fresh
  card carries the instruction line ("bubble this number into columns 1–7 of
  a new card"); subsequent sheets for the same card print the same digits
  with "use your card 4829306."
- The decoded test ID from a scan **is** the card ID. The existing decoder
  pipeline (`createQuizScanRecorder`, which already emits
  `{testId, answers: {1: 'A', 15: ['A','E']}}`) is the scan entry point;
  its testId→student/key mapping is **superseded by the allocation store**
  (§5.4) — one resolver, no parallel mapping.

### 5.3 Allocation

- Card attachment is **render context**: `{cardId, startRow}`. Convenience
  defaults: a tracked quiz render with no cardId allocates a fresh random
  card starting at row 1; worksheet renders sharing a card supply the
  existing cardId and the next free startRow (the allocation store can
  suggest it).
- Printed question numbers ARE card row numbers: numbering starts at
  `startRow` and is contiguous in document order across the document's
  OMR-answered items. Non-1 starts are first-class.
- Row-mappable item types: `multiple_choice` (≤5 choices, Ⓐ–Ⓔ),
  `true_false` (rendered Ⓐ True / Ⓑ False), `multi_select` (≤5 options,
  instruction states "mark all that apply" / "choose up to N").
- Validation: >5 choices on a row-mapped item; `startRow + count − 1 > 50`;
  a **quiz** whose scored items are not all row-mappable; write-on blocks
  are worksheet-only or unscored.

### 5.4 Allocation records and lifecycle

Every render that attaches to a card writes an **allocation record**:

```
(cardId, rowRange) -> { documentId, rev, seed, variant, learnerId?, renderedAt, status }
```

- **Lifecycle:** `live` (written at render) → `satisfied` (a scan covering
  the range was graded/recorded) → or `released` (explicit CLI/admin
  release) → or `superseded` (a reprint/re-render of the same
  `(documentId, learner)` against the same card replaces its record; the old
  record keeps its identity for audit but no longer claims the range).
- **Collision rule:** a new record whose range overlaps any `live` range on
  the same cardId is an **error**, regardless of learner — a physical card
  cannot host two documents on the same rows. Random IDs make accidental
  cross-card collisions a non-issue; same-card collisions are always real
  mistakes or a needed supersede.
- **Anonymous renders** (no learner) allocate normally; the record simply
  has no learnerId, and scan-back resolves to the document alone.
- **Single source of truth for numbering:** the allocation record. The
  render prints the numbers the record claims; the **teacher key is rendered
  per allocation** (it takes the same render context), so its numbers always
  match the sheet in the kid's binder — including startRow offsets.
- **Scan-back resolution:** decoded `{testId, answers}` → allocation
  record(s) for that cardId → per range: document rev + derived bank +
  seed/variant → grade. The resolver receives **per-row item type** from the
  derived bank (via the pinned rev), which is how it distinguishes a
  double-mark on a single-select row (ambiguous, existing legacy semantics)
  from a multi-select answer (legal mask).

### 5.5 `multi_select` grading

**Exact-set match: full points or zero.** No partial credit in v1 (a rule an
8-year-old and the grader can both hold in their heads); the `points` value
rides the item like any other. Partial-credit schemes are explicitly out of
scope (§13).

### 5.6 Legacy bubble pipeline

`omr_response` blocks, `omrForm.mjs` form maps, and the home-printed bubble
path remain for the virtual-reader harness and existing printables, but are
**legacy**: new archetypes never emit them. The stale "no off-the-shelf card
fits this reader" comments in **both** `omrForm.mjs` and
`VirtualOmrReader.mjs` are corrected as part of this work.

## 6. Blocks

### 6.1 Inventory disposition (against the real, ten-member registry)

| Existing block | Disposition |
| --- | --- |
| `rich_text` | Kept as the prose primitive (markdown subset incl. ATX headings, bullets, bold/code/math inline). Gains the `*italic*` inline span (§8) and the cloze inline atom (§6.3). |
| `math`, `plot`, `asset` | Kept unchanged. |
| `geometry` | Kept; no new investment in v1. |
| `question` | Kept; extended with `points`, `omr: true|false`, the `multi_select` shape, and the shuffle `key` where selection applies. Bank-referencing form is the published answer path (§3). |
| `answer_space` | Kept — it IS the elastic write-space primitive; new sugar composes it. |
| `scan_action` | Kept — it IS the QR block; envelope `source` is sugar for it. |
| `media_action` | Kept unchanged. |
| `omr_response` | **Legacy** (§5.6). Valid, never emitted by new archetypes. |

### 6.2 New blocks (all single-cursor; no columns, no sidebar in v1)

- `passage` — the comprehension lead block: long-form reading text with a
  `source` citation line (title/author/locator) and `mode: reprint | cite`
  (closed-book quizzes reprint the text; open-book worksheets cite the book
  the kid is holding). Optional line numbering. Keep-with-next affinity so a
  passage never strands away from its first question.
- `figure` — asset + caption (+ optional credit). v1 assets come from the
  existing asset catalog/resolver only — no AI-fetched images.
- `inset` — rounded-box aside (tips, definitions, "remember" boxes);
  contains content blocks one level deep, no recursion.
- `list` — bullet / numbered / checklist.
- `wordbank` — boxed, seeded-shuffled term set (requires `key`); pairs with
  cloze.
- `matching` — two seeded-shuffled lists (requires `key`), write-the-letter
  blanks. Never row-mapped.
- `short_answer` — prompt + ruled lines (sugar over prompt + `answer_space`).
- `essay` — prompt + ruled lines or open box (sugar over `answer_space`).
- `divider`, `spacer` (elastic, participates in fit), `page_break`.
- Bank selection sugar on `question`: `{bankId, select: 10, key: sel1,
  filter?: {topics, difficulty}}` — items chosen by `shuffle(seed, variant,
  key)`; the v2 adaptive hook replaces the picker function, not the schema.

### 6.3 Cloze

`cloze` renders a passage whose blanks are **fixed-width inline atoms**: they
participate in word-wrap as unbreakable tokens, carry a superscript number,
and come in at most three author-chosen width classes — never sized to the
answer (answer-length leaks are a pedagogical bug). Cloze blanks may
reference wordbank entries; cloze is never row-mapped. The blank joins the
inline-span grammar beside bold/code/math.

## 7. Layout manager and fit

Extends the existing pure measured-layout engine (fragments, atomic blocks,
widow/orphan minima, per-page answer-space growth) — placement stays
arithmetic on measured heights, testable without a PDF context.

- **Atomics:** a question stem never separates from its choices; a figure
  never separates from its caption; a passage keeps ≥2 lines with its first
  following question.
- **Fit policies:**
  - `flow` — natural pagination.
  - `one-page` — try **normal density**, then **compact density** (two
    discrete, fully-measured densities — no continuous solver). Still
    overset ⇒ validation error reporting the overset amount *at compact
    density*, so the AI trim loop chases a fixed target.
  - `fill` — expand elastics (`spacer`, `answer_space` max bounds) so the
    last page bottoms out. **This inverts the existing engine's deliberate
    last-page exclusion** (`growAnswerSpaces` today grows every page
    *except* the last): last-page growth is enabled iff `policy: fill`;
    `flow` and `one-page` keep the existing behavior.
  - `one-page` and `fill` are **letter-only**: combining them with
    `target: [receipt]` (a continuous roll) is a validation error.
- **Page furniture (v1, non-negotiable):** `page x of y` footer; a
  continuation strip (title + name line) on pages 2+ so separated binder
  pages stay attributable; optional gutter-margin token for three-hole
  punching; duplex-aware furniture placement for worksheets.

## 8. Theme and typography

One `workbookTheme` token file consumed by all drawing code:

- **Type:** a real workbook sans with **four styles** (regular / bold /
  italic / bold-italic), OFL-licensed and embedded (never base-14).
  Recommendation: **Atkinson Hyperlegible**. The markdown inline grammar
  gains `*italic*`. Two **type-scale presets** — `standard` and `young` —
  selected per document via `fit.typeScale`.
- **Densities:** `normal` and `compact` spacing scales (§7).
- **Tokens:** type scale, spacing scale, rule weights, rounded-box radii,
  glyph-badge geometry (drawn Ⓐ–Ⓔ circles), ruled-line spacing, page grid
  (margins, header band, footer band, gutter option).
- **Ink:** pure black + one grayscale tint; no color dependence. Ragged-right
  only — pdfkit has no hyphenation.
- **Cost acknowledged:** replacing Roboto Condensed invalidates the existing
  golden layout/render snapshots; the re-baseline lands in the same change
  as the font swap.

## 9. Tracking, printing, and the pass-off seam

- **Quizzes are tracked work** through the existing `IssueDocument`
  machinery: session, minted tokens, receipts, reprint reusing the artifact
  identity. Wiring: curriculum units (and any future session source) gain a
  **print-document reference** — `CurriculumAccess` resolves a
  `document: print/<id>@<rev>` reference to the published artifact alongside
  its existing document source; on-demand quiz renders create their session
  through the same use case rather than around it. In the issue write
  sequence, the **allocation record takes the slot the form map held**: it
  is written *before* the issue event is recorded, preserving the existing
  ordering guarantee ("the paper is out of the tray; the mapping must
  already be durable").
- **Worksheets print loose** via a `document`-type printable in
  `PrintService` (new type beside `bank`/`pdf`; same quota/approval policy),
  except any worksheet render attaching to a card also writes its
  allocation record so scans resolve.
- **Scan-back:** decoded card (via the existing `createQuizScanRecorder`
  path) → allocation store → document rev + derived bank + seed/variant (+
  learner) → grade (quizzes) or record feedback (worksheets), per §5.4/§5.5.

## 10. Tooling and the AI loop

- Source documents: `content/school/print-documents/*.yml`; published
  documents + derived banks generated beside them (per-rev).
- CLI `school:docs`:
  - `validate <file|dir>` — source-stage gates (answers legal), dotted-path
    errors; sub-second, render-free. The AI repair loop's feedback channel.
  - `publish <file>` — compile to published document + derived bank; strict
    (answer-free) re-validation as postcondition.
  - `render <file> --out proof.pdf [--learner id] [--variant n] [--card id
    --start-row n] [--teacher]` — proof renders, per-kid variants, teacher
    key (same shuffles + answers).
  - `release-card <cardId> [--rows a-b]` — allocation lifecycle management.
- The upstream ingestion pipeline (source PDF/HTML/transcript → LLM → source
  YAML) is adjacent scope; an `ingest` command is v2.

## 11. DDD ownership

| Layer | Owns |
| --- | --- |
| Domain (`2_domains/school/documents`) | Envelope v2 + source/published validation gates, archetype constraint rules, row-mapping arithmetic, fit solver + density selection, shuffle derivation, allocation lifecycle rules — all pure |
| Rendering (`1_rendering/school/documents`) | workbookTheme tokens, per-block measure/draw, glyph badges, page furniture, key rendering |
| Adapters | Print-document repository (source + published + derived banks); allocation-record store |
| Application | publish pipeline, `RenderPrintDocument` (render-context assembly, card allocation), IssueDocument integration, scan-back resolution, CLI |
| Data mount | Sources, published revs, derived banks, allocation records |

## 12. v1 acceptance (falsifiable; phase letters per §13)

1. **[A] Determinism:** identical `(document rev, seed, variant, learner)`
   renders byte-identical PDFs; `--teacher` output preserves the student
   sheet's item order for every variant.
2. **[B] Answer split:** a source file with inline answers validates; its
   published document fails the answer-scan if answers survive (publish
   postcondition test); the teacher key renders from the derived bank and
   matches the shuffles.
3. **[C] Card contract:** a quiz with a non-row-mappable scored item, >5
   choices, or `startRow + count − 1 > 50` fails validation with dotted
   paths; a worksheet rendered with `startRow: 18` prints its first question
   as **18** and a simulated scan of rows 18–30 (spanning the bank boundary)
   resolves through the allocation store to the right document rev, learner,
   and shuffles.
4. **[C] Collision:** a second render overlapping a `live` range on the same
   card fails; a re-render of the same `(document, learner)` supersedes
   cleanly; `release-card` frees a range.
5. **[C] multi_select end-to-end:** a decoded multi-mark row grades
   exact-set against the derived bank; a double-mark on a single-select row
   reports ambiguous (not wrong-answer); per-row item type demonstrably
   flows from the derived bank to the resolver.
6. **[A] Fit:** an overlong one-pager fails with an overset amount at
   compact density; `flow` paginates with correct footers and continuation
   strips; a short `fill` worksheet bottoms out its last page (inverted
   last-page growth); `one-page` + `target: [receipt]` fails validation.
7. **[A] Targets:** a wordbank document with `target: [receipt]` fails at
   validation (block×target matrix), not render.
8. **[A] Type:** four font styles embed; `*italic*` renders; both type-scale
   presets and both densities produce distinct, snapshot-pinned output; the
   golden re-baseline lands with the font swap.
9. **[B] Blocks:** cloze (fixed-width numbered blanks), wordbank, and
   matching render with seeded shuffles pinned by snapshot; editing an
   unrelated sibling block does not change a keyed block's shuffle.
10. **[A/B/C] Archetype dial:** the same body blocks render as a quiz (score
    box, tracked issue, all-scored-row-mapped) and as a worksheet (loose
    print, mixed OMR/write-on) purely by changing envelope fields.

## 13. Phasing

- **Phase A — the page:** envelope v2 + migration posture, font/theme swap +
  snapshot re-baseline, densities + fit policies + page furniture, content
  blocks (passage, figure, inset, list, divider, spacer, page_break),
  block×target matrix, CLI validate/render (no cards, no banks).
- **Phase B — the answers:** source/publish split, derived banks, assessment
  blocks (wordbank, matching, cloze, short_answer, essay, multi_select
  shape), shuffle keys, teacher key mode, points/score box.
- **Phase C — the cards:** allocation store + lifecycle, card-ID workflow,
  render-context card attachment, scan-back via `createQuizScanRecorder`,
  IssueDocument integration, `release-card`.

Each phase lands independently green with its acceptance items (§12 letters).

## 14. Explicitly outside v1

- Columns and sidebar containers; new `geometry` investment; info-page-only
  features (classic-textbook theme variant, pull quotes).
- Adaptive item selection from learner progress (hook specified, not built);
  the AI ingestion command.
- AI-fetched or web-sourced images (asset catalog only).
- Facsimile answer keys; per-question rubric text; partial credit for
  `multi_select`.
- Card inventory management beyond collision detection and release (no
  "which cards remain" ledger UI).
- Color printing; justified text; hyphenation.

## 15. Assumed physical defaults (revisable without spec change)

US Letter; mono laser, pure grayscale; optional three-hole gutter margin;
worksheets duplex-friendly, quizzes simplex; two grade-band type scales
(`standard`, `young`).

## 16. Refining and adjacent documents

- OMR reader pipeline: `docs/reference/omr/README.md` (card calibration and
  the decode path §5 builds on).
- Learning Surfaces certification (paper surface): print-documents may later
  become certifiable content; v1 deliberately does not couple them.
- On acceptance, fold the endstate into `docs/reference/school/` per the
  reference-docs convention and archive this file.
