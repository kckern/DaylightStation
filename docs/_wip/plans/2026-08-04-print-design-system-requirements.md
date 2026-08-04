# School Print Design System ("Workbook") product requirements

> **Status:** v1 requirements draft (post adversarial design review). Canonical
> scope and boundary document for the School print design system: YAML-authored,
> AI-compiled, on-demand-rendered PDF documents — quiz sheets, worksheets, and
> (later) textbook-style info pages — built by evolving the existing printable
> document machinery (`2_domains/school/documents/`,
> `1_rendering/school/documents/`). The OMR reader, Print Center, and
> SchoolCalc documents refine or consume this contract; they do not override it.

## 1. Product definition

The household's primary learning-content workflow is: **find source material
(a PDF book, HTML page, Wikipedia article, video or audiobook transcript) → AI
transforms it into lessons and comprehension worksheets/quizzes → print →
students complete → pass off.** This product is the print half: a design
system that turns validated YAML into workbook-quality PDF pages.

Three governing ideas:

1. **A printout is an app screen, not a file.** A print-document is a
   *parameterized template*, rendered on demand for a specific learner with a
   specific seed, variant, date, and OMR card allocation. The same document
   renders per-kid variants at the kitchen table and re-renders
   byte-identically weeks later for regrading.
2. **The primary author is an LLM.** The schema is a compilation target:
   strict validation, dotted-path errors, no ambiguous sugar — because the
   authoring loop is generate → validate → repair, and strictness with good
   errors is what makes that loop converge. Hand-authoring and compilation
   from question banks are secondary modes of the same schema.
3. **Answers ride separate paper.** Quiz answers are marked on official
   Chatsworth OMR cards (5 positions × 50 rows), never bubbled on the printed
   sheet. Printed sheets carry questions, choices, scratch space — and a
   numbering contract that maps 1:1 onto card rows.

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

- **Evolve, don't fork.** This is v2 of the *existing* printable-document
  envelope and block registry — one validator, one layout engine, one
  renderer family. No parallel document system.
- **The block set is closed.** Inventing a block is a code change, never
  config (existing posture). Every block has a renderer for every target it
  claims; an unsupported combination is a validation error, not a render
  crash.
- **Deterministic regeneration.** `seed` is mandatory (existing rule). Every
  shuffle — wordbank order, matching permutation, bank item selection,
  per-kid variants — derives from `(seed, variant, blockPath)`. Re-rendering
  with the same context is byte-identical (modulo the pdfkit CreationDate
  handling the existing golden tests already use).
- **Documents cannot contain answers.** The existing `collectAnswerKeys`
  invariant stands: any node carrying `answer`/`answers` fails validation.
  Answers live in question banks; inline-authored questions compile to a
  derived bank at publish. The teacher key is a sibling render, never an
  embedded field.
- **Fail closed at validate time.** Overset one-pagers, non-row-mappable quiz
  items, allocation overflows, unsupported block×target combinations — all
  are validation/publish errors with dotted paths and actionable amounts, so
  the AI repair loop (and the human) fixes the document, not the printout.
- **Subject-neutral framework.** Blocks and layout speak structure
  (passage, wordbank, matching), never subjects. Content is data.
- **One aesthetic, tokenized.** Modern workbook: clean sans, bolder heads,
  rounded boxes, friendly density, photocopy-safe grayscale. Every drawn
  dimension reads from theme tokens so a future classic-textbook variant is
  a second token file, not new rendering code.

## 3. The envelope (`school.document/v2`)

One envelope, extending the existing validated shape. Existing fields are
kept with their semantics; new fields are additive.

```yaml
schema: school.document/v2
documentId: us-states-quiz-3          # stable id; quiz card ids derive from it
seed: 91242                            # REQUIRED (existing rule) — all shuffles derive from it
variant: base                          # optional; per-kid variants override at render
target: [letter]                       # letter | receipt (existing); block×target matrix enforced
archetype: quiz                        # quiz | worksheet | infopage — a PRESET BUNDLE, not a schema fork
title: "U.S. States — Quiz 3"
header:                                # archetype presets; all overridable
  name: true                           # blank line, or pre-filled at render for a known learner
  date: true
  scoreBox: true                       # quiz default; worksheet default false
  instructions: "Mark answers on your bubble card."
fit:
  policy: one-page                     # flow | one-page | fill
  typeScale: standard                  # standard | young  (grade-band dial)
omrAllocation:                         # present iff any item is OMR-answered
  cardId: USQZ003                      # the card's 7-char document id
  startRow: 18                         # question numbering starts here (shared-card offsets)
points: default                        # or per-question overrides on blocks
source:                                # optional supplemental-content QR (uses scan_action)
  action: launch-states-video
  label: "Watch the review video"
blocks: [ ... ]
```

**Archetype presets** (all expressible as explicit fields; presets are
defaults, not magic): quiz ⇒ scoreBox, simplex, tracked issue, all scored
items row-mappable; worksheet ⇒ name/date only, duplex-friendly, loose print,
mixed OMR/write-on items; infopage ⇒ no header fields, `flow` fit.

**Render context** (supplied at render time, never authored):
`{learnerId?, learnerName?, date?, variant?, omrStartRowOverride?}`. A
learner-aware render pre-fills the name line and derives the kid's variant;
an anonymous render leaves write-on blanks. Adaptive *item selection* driven
by learner progress is a v2 hook on bank selection (§5); v1 selection is
seeded.

## 4. The OMR card contract

The cards are fixed physical objects: **5 mark positions per row, 50 rows,
first 7 characters encode a document id.** The design system prints no
bubbles and emits no form maps — it guarantees the *sheet-to-card mapping*:

- Every OMR-answered item occupies exactly one card row. Row consumption is
  contiguous from `omrAllocation.startRow` in document order.
- Printed question numbers ARE card row numbers. A worksheet sharing a card
  via `startRow: 18` prints its first question as **18**. Non-1 starts are
  first-class.
- Item types that map to a row: `multiple_choice` (≤5 choices, Ⓐ–Ⓔ),
  `true_false` (rendered as Ⓐ True / Ⓑ False), `multi_select` (≤5 options;
  instruction text states "mark all that apply" / "choose up to N" — the
  reader decodes full row masks, so multi-mark rows are legal).
- Validation errors: >5 choices on a row-mapped item; allocated range
  exceeding row 50; a **quiz** containing any scored item that is not
  row-mappable (cloze/matching/essay/wordbank are worksheet-only or
  unscored); duplicate/overlapping allocation *within* one document.
- **Cross-document allocation** (several worksheets sharing one card): every
  render carrying an `omrAllocation` writes a lightweight **allocation
  record** — `(cardId, rowRange) → (documentId, seed, variant, learnerId?,
  renderedAt)` — so a scanned card always resolves to the right document,
  learner, and shuffle. Collision on write (overlapping live range for the
  same cardId + learner) is an error. Quizzes additionally flow through the
  full `IssueDocument` machinery (§8); the allocation record is the floor,
  not the ceiling.
- **Legacy bubble pipeline:** `omr_response` blocks, `omrForm.mjs` form maps,
  and the home-printed bubble path remain in place for the virtual-reader
  test harness and any existing printables, but are **legacy**: new
  archetypes never emit them, and the stale "no off-the-shelf card fits this
  reader" comment gets corrected as part of this work.

## 5. Blocks

### 5.1 Inventory disposition (against the real, ten-member registry)

| Existing block | Disposition |
| --- | --- |
| `rich_text` | Kept as the prose primitive (markdown subset incl. ATX headings, bullets, bold/code/math inline). Gains the `italic` inline span (§7) and the cloze inline atom (§5.3). |
| `math`, `plot`, `asset` | Kept unchanged. |
| `geometry` | Kept; no new investment in v1. |
| `question` | Kept; extended with `points`, `omr: true|false`, and the `multi_select` item shape. Bank-referencing form is the sanctioned answer path. |
| `answer_space` | Kept — it IS the elastic write-space primitive. New sugar blocks compose it rather than replacing it. |
| `scan_action` | Kept — it IS the QR block. The envelope `source` field is sugar for a header-corner scan_action. |
| `media_action` | Kept unchanged. |
| `omr_response` | **Legacy** (§4). Valid, never emitted by new archetypes. |

### 5.2 New blocks (all single-cursor; no columns, no sidebar in v1)

- `passage` — the comprehension lead block: long-form reading text with a
  `source` citation line (title/author/locator) and `mode: reprint | cite`
  (closed-book quizzes reprint the text; open-book worksheets cite the book
  the kid is holding). Optional line numbering. Keep-with-next affinity so a
  passage never strands away from its first question.
- `figure` — asset + caption (+ optional credit), sized to content width.
  v1 assets come from the existing asset catalog/resolver only — no
  AI-fetched images.
- `inset` — rounded-box aside (tips, definitions, "remember" boxes).
- `list` — bullet / numbered / checklist.
- `wordbank` — boxed, seeded-shuffled term set; pairs with cloze.
- `matching` — two seeded-shuffled lists, write-the-letter blanks. Never
  row-mapped.
- `short_answer` — prompt + ruled lines (sugar over prompt + `answer_space`).
- `essay` — prompt + ruled lines or open box (sugar over `answer_space`).
- `divider`, `spacer` (elastic, participates in fit), `page_break`.
- Bank selection sugar on `question`: `{bankId, select: 10, filter?: {topics,
  difficulty}}` — items chosen by `(seed, variant)`; the v2 adaptive hook
  replaces the picker function, not the schema.

Containers (`inset`) hold content blocks **one level deep**; no recursion.

### 5.3 Cloze

`cloze` renders a passage whose blanks are **fixed-width inline atoms**: they
participate in word-wrap as unbreakable tokens, carry a superscript number,
and come in at most three width classes chosen by the author — never sized to
the answer (answer-length leaks are a pedagogical bug). Numbered cloze blanks
may reference wordbank entries; cloze is never row-mapped.

### 5.4 Assessment semantics

- `points` per question (default 1; envelope-level default overridable). The
  score box shows total available points.
- Answer keys: **dense end-of-document key**, one page where possible,
  rendered as a sibling artifact per `(seed, variant)` — `--variant teacher`
  in the CLI, listing printed question numbers (card row numbers where
  allocated) and correct responses. Facsimile keys are out of scope.
- Inline-authored questions **compile to a derived bank** at publish
  (id-stable, stored beside the document), so grading, regrade, reuse, and
  the no-answers-in-documents invariant all hold in one place.

## 6. Layout manager and fit

Extends the existing pure measured-layout engine (fragments, atomic blocks,
widow/orphan minima, per-page `growAnswerSpaces`) — placement stays
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
    last page bottoms out; this is the existing `growAnswerSpaces` machinery
    generalized to spacers.
- **Page furniture (v1, non-negotiable):** `page x of y` footer; a
  continuation strip (document title + name line) on pages 2+ so separated
  binder pages stay attributable; optional gutter margin token for
  three-hole punching; duplex-aware furniture placement for worksheets.

## 7. Theme and typography

One `workbookTheme` token file consumed by all drawing code:

- **Type:** a real workbook sans with **four styles** (regular / bold /
  italic / bold-italic), OFL-licensed and embedded (never base-14).
  Recommendation: **Atkinson Hyperlegible** (designed for young and
  struggling readers). The markdown inline grammar gains `*italic*`. Two
  **type-scale presets** — `standard` and `young` (larger sizes/leading for
  early readers) — selected per document via `fit.typeScale`.
- **Densities:** `normal` and `compact` spacing scales (§6).
- **Tokens:** type scale, spacing scale, rule weights, rounded-box radii,
  glyph-badge geometry (drawn Ⓐ–Ⓔ circles), ruled-line spacing, page grid
  (margins, header band, footer band, gutter option).
- **Ink:** pure black + one grayscale tint; no color dependence (mono laser
  is the deployment reality). Ragged-right text only — pdfkit has no
  hyphenation, and justified rag at workbook sizes is worse than ragged.
- **Cost acknowledged:** replacing Roboto Condensed invalidates the existing
  golden layout/render snapshots; the re-baseline is a planned work item,
  not a surprise.

## 8. Tracking, printing, and the pass-off seam

- **Quizzes are tracked work.** A quiz render flows through the existing
  `IssueDocument` machinery: session, minted tokens, receipts, reprint
  reusing the artifact identity. The OMR allocation record (§4) is written
  as part of issuance.
- **Worksheets print loose** via a `document`-type printable in
  `PrintService` (subject to the existing quota/approval policy), except
  that any worksheet carrying an `omrAllocation` also writes the allocation
  record so its scans resolve.
- **Scan-back:** a scanned card resolves `(cardId, rows)` → allocation
  record → document + seed/variant + learner → grade against the derived
  bank. Ungraded worksheet feedback uses the same resolution without
  affecting pass-off.

## 9. Tooling and the AI loop

- Documents live in the content mount: `content/school/print-documents/*.yml`
  (deriving banks beside them).
- CLI `school:docs`:
  - `validate <file|dir>` — full envelope/block/fit/allocation validation,
    dotted-path errors; sub-second, render-free (fit checking measures text
    but never draws). This is the AI repair loop's feedback channel.
  - `render <file> --out proof.pdf [--learner id] [--variant v] [--teacher]`
    — proof renders, teacher key, per-kid variants.
- The upstream ingestion pipeline (source PDF/HTML/transcript → LLM → YAML)
  is adjacent scope: this system's contract is to be a reliable, strictly
  validated target for it. An `ingest` command is v2.

## 10. DDD ownership

| Layer | Owns |
| --- | --- |
| Domain (`2_domains/school/documents`) | Envelope v2 + block validation, archetype constraint rules, OMR row-mapping arithmetic, fit solver + density selection, shuffle derivation — all pure |
| Rendering (`1_rendering/school/documents`) | workbookTheme tokens, per-block measure/draw, glyph badges, page furniture, key rendering |
| Adapters | Print-document YAML repository; allocation-record store |
| Application | `RenderPrintDocument` (render-context assembly, per-kid variants), publish/compile of derived banks, `IssueDocument` integration, CLI |
| Data mount | Documents, derived banks, allocation records |

## 11. v1 acceptance (falsifiable)

1. **Determinism:** the same `(document, seed, variant, learner)` renders
   byte-identical PDFs across two runs; a teacher key's item order matches
   its student sheet's for every variant.
2. **Card contract:** a quiz with a non-row-mappable scored item, >5 choices,
   or an allocation crossing row 50 fails validation with dotted paths; a
   worksheet with `startRow: 18` prints its first question numbered 18 and
   writes an allocation record that resolves a simulated scan of rows 18–30
   back to the right document and learner.
3. **No answers on student paper:** the answer-containing-node validator
   still rejects any document carrying answers; the teacher key renders from
   the derived bank and matches the shuffles.
4. **Fit:** a deliberately overlong one-pager fails with an overset amount at
   compact density; the same content at `flow` paginates with correct
   footers and continuation strips; a short `fill` worksheet bottoms out its
   last page via expanded answer spaces.
5. **Targets:** a wordbank document with `target: [receipt]` fails at
   validation (block×target matrix), not at render.
6. **Type:** all four font styles embed; `*italic*` renders; both type-scale
   presets and both densities produce distinct, snapshot-pinned output; the
   golden-snapshot re-baseline lands in the same change as the font swap.
7. **Archetype dial:** the same body blocks render as a quiz (score box,
   tracked issue, all-scored-row-mapped enforcement) and as a worksheet
   (loose print, mixed OMR/write-on) purely by changing envelope fields.

## 12. Explicitly outside v1

- Columns and sidebar layout containers; any new `geometry` investment.
- Info-page-only features (classic-textbook theme variant, pull quotes).
- Adaptive item selection from learner progress (hook specified, not built);
  the AI ingestion command (`source → YAML`).
- AI-fetched or web-sourced images (asset catalog only).
- Facsimile answer keys; per-question rubric text.
- Card inventory management beyond collision detection (no "which cards are
  left" ledger UI).
- Color printing; justified text; hyphenation.

## 13. Assumed physical defaults (revisable without spec change)

US Letter; mono laser, pure grayscale; optional three-hole gutter margin;
worksheets duplex-friendly, quizzes simplex; two grade-band type scales
(`standard`, `young`).

## 14. Refining and adjacent documents

- OMR reader pipeline: `docs/reference/omr/README.md` (the card-scan side of
  §4/§8).
- Learning Surfaces certification (paper surface): print-documents may later
  become certifiable content; v1 deliberately does not couple them.
- On acceptance, fold the endstate into `docs/reference/school/` per the
  reference-docs convention and archive this file.
