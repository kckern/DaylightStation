# Print Design System — Phase B ("the answers") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/_wip/plans/2026-08-04-print-design-system-requirements.md` (rev 2). Phase B scope is §13 "Phase B — the answers"; acceptance §12.2, §12.9, §12.10(B slice: score box). Phase A is merged (envelope v2, workbookTheme, content blocks, fit, furniture, CLI). Cards/allocation/scan-back remain Phase C.

**Goal:** The source/publish split (answers legal in source, compiled into derived banks), the assessment blocks (wordbank, matching, cloze, short_answer, essay, multi_select items), edit-stable seeded shuffles via block `key`s, the `--teacher` dense answer key, and per-question points with the quiz score box.

**Architecture:** Source documents (`school.document-source/v1`) are v2 documents where answer-bearing fields are legal; a **pure domain publish transform** strips them into a derived question bank (existing bank schema) and an answer-free published document (`school.document/v2` + `rev` content hash), re-validated under the strict gate as a postcondition. Shuffles derive from `shuffle(seed, variant, key)` using the existing `mulberry32`/`hashSeed` primitives (`2_domains/school/generatedBanks/distractors.mjs`). Rendering reuses Phase A's node pipeline: wordbank/matching are new box/text compositions; cloze blanks join the inline-span grammar as fixed-width atoms; the teacher key is an appended key section rendered from the derived bank with identical shuffles.

**Tech Stack:** as Phase A (Node ESM, vitest from repo root, pdfkit, js-yaml). All Phase A conventions bind: dotted-path errors, closed registries, legacy/v1 byte-safety, deterministic renders (pinned CreationDate), `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` commit trailer.

## Global Constraints (from spec rev 2)

- **Answers ban on published documents stands untouched** (`collectAnswerKeys`); only the SOURCE stage relaxes it, and only on the specific answer-bearing shapes below. Publish postcondition: the published document passes strict v2 validation.
- **Shuffle derivation** (§4.3): every shuffling block carries a REQUIRED author-assigned `key` (short string, unique across the document); permutation = `deriveShuffle(seed, variant, key, length)`; stable under document edits (never positional).
- **Teacher key is a render mode** (`--teacher`), never a variant: same `(seed, variant)` shuffles as the student sheet, answers from the derived bank, dense end-of-document key section listing printed question/blank numbers. No answers ever enter the published document object.
- **Derived bank** uses the EXISTING question-bank schema (`questionBankValidation.mjs`) with id `derived/<documentId>@<rev>`; `rev` = short sha256 of the canonical (sorted-keys) source; published artifacts are append-only per rev.
- **`multi_select`**: new bank item type, ≤5 choices, `answers` array; grading = exact-set match, full points or zero (extend `gradeAnswer`); rendered with square checkboxes + an instruction line ("Mark all that apply." / "Choose up to N.").
- **Cloze blanks are fixed-width inline atoms** (§6.3): three width classes (`s|m|l` from theme tokens), superscript numbers, unbreakable in wrap, never sized to the answer.
- **Phase A regressions forbidden:** all existing suites green, zero pre-existing snapshot modifications, v1 path untouched, `plot`/`geometry` stay pinned-unrenderable.
- New blocks register letter-only in `BLOCK_TARGET_SUPPORT`; inset child-whitelist updated deliberately for each (state disposition: wordbank/matching/cloze/short_answer/essay — decide nestable or rejected, with a reason, mirroring the F5 audit method against measureBoxNode coverage).

## File Structure

```
backend/src/2_domains/school/documents/
  shuffle.mjs                      # Task 1 — deriveShuffle + key validation helper
  blocks.mjs                       # Task 2 — modify: 5 new validators (+ source-mode fields)
  documentV2.mjs                   # Task 2 — modify: matrix entries + key-uniqueness walk
  documentSource.mjs               # Task 3 — source validation + publishDocument transform
backend/src/2_domains/school/questionBankValidation.mjs   # Task 2 — modify: multi_select
backend/src/2_domains/school/grading.mjs                  # Task 2 — modify: multi_select exact-set
backend/src/1_rendering/school/documents/
  measure.mjs / DocumentPdfRenderer.mjs / workbookTheme.mjs  # Tasks 4,6 — assessment rendering + key section + score box
backend/src/3_applications/school/documents/
  RenderPrintDocument.mjs          # Task 5 — bank threading, shuffles, selection sugar; Task 6 — teacher mode
  PublishPrintDocument.mjs         # Task 5 — publish pipeline (write published + derived bank)
backend/src/1_adapters/school/documents/YamlPrintDocumentRepository.mjs  # Task 5 — modify: published/derived persistence
cli/school-docs.cli.mjs            # Task 6 — modify: publish command + --teacher flag
```

---

### Task 1: Seeded shuffle primitive + key rules (domain)

**Files:** Create `backend/src/2_domains/school/documents/shuffle.mjs` + test.
**Interfaces:**
- `deriveShuffle(seed, variant, key, length)` → frozen permutation array (indices), computed via `mulberry32(hashSeed(`${seed}:${variant}:${key}`))` Fisher-Yates — import the two helpers from `#domains/school/generatedBanks` (read `distractors.mjs` for their exact signatures; domain-internal import).
- `applyShuffle(items, permutation)` → new array; `SHUFFLE_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/`.
- Properties to test: deterministic (same inputs ⇒ same permutation); differs across seed, variant, AND key; length 0/1 safe; stable regardless of item content (indices only).
- [ ] TDD: failing test → implement → PASS → commit `feat(school-print): deterministic shuffle primitive keyed on (seed, variant, key)`.

### Task 2: Assessment block validators + multi_select item (domain)

**Files:** Modify `blocks.mjs`, `documentV2.mjs`, `questionBankValidation.mjs`, `grading.mjs`; tests beside the Phase A ones (`tests/isolated/domain/school/documents/blocks.test.mjs` etc.).
**Interfaces (block shapes — canonical for the whole phase):**
- `wordbank`: `{key (required, SHUFFLE_KEY_PATTERN), terms: non-empty array of non-empty unique strings}`. Terms are presentation (shuffled), not answers — legal in published documents.
- `matching`: `{key (required), left: non-empty array of non-empty strings, right: same}` — published form; SOURCE form additionally allows `pairs: [{left: idx|string, right: idx|string}]` (the answers; complete cover of `left` required). Validator takes an `{allowAnswers}` option threaded from the validating envelope (default false) — the same mechanism for every source-only field below.
- `cloze`: `{text (non-empty; blank markers `{{n}}` with n = 1..count, each exactly once, ≥1), blanks: [{n (int, matches a marker), width: 's'|'m'|'l' (default 'm'), wordbank?: <wordbank key>}]`; SOURCE form allows `answer` (non-empty string) per blank. REQUIRE_MACRO ban on `text`.
- `short_answer`: `{prompt (non-empty), lines (int 1..10, default 2)}`; SOURCE allows `answer`. `essay`: `{prompt, lines (int 2..30, default 8) | box: true}` — never carries answers (unmarked prose).
- `question` block: gains optional `points` (number ≥ 0, overrides envelope defaultPoints) — validate; bank-select sugar `{bankId, select (int ≥1), key (required when select present)}` shape-validated (resolution is Task 5).
- `multi_select` in `ITEM_TYPES` (questionBankValidation): `{choices (2..5), answers (non-empty array of distinct members of choices), maxSelect? (int)}`; `gradeAnswer` — exact-set match (order-insensitive) full credit else zero; `givenShapeError` accepts arrays for multi_select only.
- `documentV2.mjs`: matrix entries (all letter-only); document-wide `key` uniqueness walk (wordbank/matching/cloze-with-wordbank refs resolve to an existing wordbank key — dangling ref is an error); inset child dispositions per the F5 audit method (recommendation: reject `cloze`/`matching`/`wordbank` in insets v1 — shuffled/keyed exam furniture inside an aside is layout trouble; allow `short_answer`/`essay` which desugar to prompt+answer_space — but VERIFY against measureBoxNode's coverage and decide with evidence).
- [ ] TDD per block/item (valid + each rejection, source-vs-published field gating) → implement → all domain suites green → commit.

### Task 3: Source stage + publish transform (domain, pure)

**Files:** Create `backend/src/2_domains/school/documents/documentSource.mjs` + test.
**Interfaces:**
- `DOCUMENT_SOURCE_SCHEMA = 'school.document-source/v1'`; `validateDocumentSource(raw)` — v2 rules with `{allowAnswers: true}` threading (schema literal differs; everything else identical incl. key walks); `validateAnyDocument` (documentV2) learns the source literal → routes here (a SOURCE document is never renderable directly by Phase B's use case except via in-memory publish — Task 5).
- `publishDocument(source)` → `{errors} | {published, bank, rev}`:
  - `rev` = first 9 hex of sha256 over sorted-keys JSON of the validated source (reuse the sorted-keys serializer pattern; local helper fine).
  - Derived bank: id `derived/<id>@<rev>`, existing bank schema; items minted with stable ids from block keys/paths: cloze blank → `{id: '<clozeIndexOrKey>-b<n>', type: 'cloze', ...answer}`; matching → one `matching` item per block (pairs as the existing matching item shape — READ questionBankValidation's matching item fields and mint to fit); short_answer → `short_answer` item; inline question items pass through with their answers. Wordbank terms are NOT bank items (presentation only).
  - Published document: source minus every answer-bearing field, `schema` → v2 literal, `rev` set, cloze/matching/short_answer blocks now carry `itemRef`s pointing at derived-bank ids (extend those block validators to accept `itemRef` in published mode).
  - POSTCONDITION in code: `validateDocumentV2(published).errors` empty AND the bank passes `validateQuestionBank` — publish returns errors otherwise (never emits a half-valid pair).
- [ ] TDD: round-trip fixture with every answer-bearing shape → publish → assert bank items, refs, rev stability (same source ⇒ same rev; touched source ⇒ new rev), postcondition failure path (construct a pathological source if possible, else unit-test the postcondition wiring) → commit.

### Task 4: Assessment rendering (measure + draw)

**Files:** Modify `measure.mjs`, `DocumentPdfRenderer.mjs`, `workbookTheme.mjs` (+ new snapshot test file `workbookAssessment.render.test.mjs`).
**Interfaces:**
- `wordbank`: boxed (theme.box) flow of terms in shuffled order (shuffle applied UPSTREAM by Task 5 — measure receives already-ordered terms; measurement itself is order-agnostic), wrapping rows, label style.
- `matching`: two columns via a two-column sub-layout INSIDE one atomic fragment (left numbered 1..n, right lettered A..n with write-the-letter rule lines before left items) — this is a self-contained block layout, not the Phase-A-cut generic columns container; keep it fragment-internal.
- `cloze`: blank atoms join the inline grammar — measure produces runs with `{kind: 'blank', n, widthPt}` (widths from new `theme.blank = {s, m, l}` tokens), unbreakable, superscript number drawn at blank start; draw renders a baseline rule of widthPt.
- `multi_select` question rendering: square checkboxes (theme.badge square variant) instead of Ⓐ–Ⓔ circles, instruction line from item (`maxSelect` ⇒ "Choose up to N." else "Mark all that apply.").
- `short_answer`/`essay`: desugar at measure into prompt text node + answerSpace (reuse; essay `box: true` → open box styled via theme.box).
- Score box: quiz-archetype header renders `Score ____ / <totalPoints>` when `header.scoreBox` — totalPoints supplied by the caller (Task 5 computes from points fields); headerFragment gains the optional field.
- Every new block: per-block v2 render test joins the Phase A matrix-wide render test (extend `blockTargetMatrix.render.test.mjs` fixtures) + structural snapshots + legacy suites untouched.
- [ ] TDD → implement → full rendering suites green → commit.

### Task 5: Bank threading, shuffles, selection + publish pipeline (application/adapter)

**Files:** Modify `RenderPrintDocument.mjs`, `YamlPrintDocumentRepository.mjs`; create `PublishPrintDocument.mjs` + tests.
**Interfaces:**
- Repository gains: `getPublished(id, rev?)` (latest rev default), `getDerivedBank(id, rev)`, `writePublished({document, bank, rev})` — published artifacts under `<directory>/published/<id>@<rev>.yml` and `<directory>/derived-banks/<id>@<rev>.yml` (generated; append-only — refuse overwrite of an existing rev with different content).
- `PublishPrintDocument({repository})`: `execute({id | source})` → validate source → `publishDocument` → persist both → `{id, rev, bankId, warnings}`.
- `RenderPrintDocument` v2 path gains: source-schema inputs are auto-published IN MEMORY (not persisted) for proof renders; published documents resolve their derived bank via repo when blocks carry itemRefs; bank-select sugar resolves `{bankId, select, key}` → `applyShuffle(deriveShuffle(seed, variant, key, items.length))` → first `select` items (base banks resolved via an injected `banks` reader — accept a `{getBank(id)}` dep, defaulting to reading YAML banks from the school content mount question-banks dir; mirror how the CLI/composition resolves content roots); wordbank/matching orders shuffled with their keys; `totalPoints` computed (sum of question points ?? defaultPoints across scored blocks) and threaded to the score box.
- Determinism holds: same `(id, rev, seed, variant)` ⇒ identical bytes (test).
- [ ] TDD → implement → suites green → commit.

### Task 6: Teacher key + CLI publish/--teacher

**Files:** Modify `RenderPrintDocument.mjs`, `DocumentPdfRenderer.mjs`/`measure.mjs` (key section), `cli/school-docs.cli.mjs` + tests.
**Interfaces:**
- `execute({..., context: {teacher: true}})`: renders the SAME student pages (identical shuffles — assert byte-prefix or layout equality) followed by a `page_break` + dense key section: heading "Answer key — <title> (variant N)", then compact numbered lines (question/blank number → answer text; matching → `1-C 2-A …`; multi_select → sorted letter set), styled label/caption, multi-column-ish dense flow is NOT required — a simple two-column matching of number+answer per line is fine v1.
- Answers come ONLY from the derived bank object passed in-memory to the key renderer — the published document object is never mutated (assert: published doc deep-equal before/after teacher render).
- CLI: `school:docs publish <file>` (runs PublishPrintDocument; prints id/rev/bankId; exit 1 on errors incl. postcondition); `render --teacher` flag (requires a source or published+bank resolvable; warning when teacher render of a doc with zero answerable items).
- [ ] TDD (incl. the §12.1-style teacher/student shuffle-match test) → implement → CLI suites green (schoolcalc-catalog untouched) → commit.

### Task 7: Phase B acceptance sweep + evidence

**Files:** Create `backend/src/3_applications/school/documents/acceptance.phaseB.test.mjs` + `docs/_wip/audits/2026-08-04-print-design-phase-b-acceptance.md`.
- [ ] **§12.2**: source with every inline answer shape validates; publish strips (published fails if any answer survives — postcondition test exercised through the real pipeline); teacher key renders from derived bank and matches student shuffles for variants 0..2.
- [ ] **§12.9**: cloze/wordbank/matching render with seeded shuffles pinned by snapshot; editing an unrelated sibling block does NOT change a keyed block's shuffle (the edit-stability property — construct two documents differing by an inserted rich_text and assert identical wordbank order).
- [ ] **§12.10(B)**: quiz archetype now shows the score box with totalPoints; worksheet does not; envelope-only change.
- [ ] Visual evidence: extend the Phase A proof-document approach — one comprehensive assessment worksheet (wordbank+cloze+matching+multi_select+short_answer+essay) rendered to committed PDF/PNG + one pixel-pinned page + its teacher key PDF.
- [ ] Full sweep recorded (Phase A command set + new files); pre-existing failures listed as such; commit `test(school-print): Phase B acceptance + evidence`.

---

## Self-Review Notes

- **Spec coverage (Phase B §13):** source/publish → Tasks 3,5,6; derived banks → 3,5; assessment blocks → 2,4; shuffle keys → 1,2,5; teacher key → 6; points/score box → 2,4,5. §12.2/§12.9/§12.10-B → Task 7.
- **Deliberate decisions encoded:** matching's two-column layout is block-internal (not the cut generic container); wordbank terms are presentation, not answers; essay never carries answers; source documents render only via in-memory publish; derived-bank persistence is append-only.
- **Landmines carried forward:** inset child dispositions for the five new blocks must be audited (Task 2) the F5 way; the matrix-wide render test must grow with every new block (Task 4); `plot`/`geometry` pinned-unrenderable stays.
