# Print Design System — Phase C ("the cards") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/_wip/plans/2026-08-04-print-design-system-requirements.md` (rev 2). Phase C scope is §13 "Phase C — the cards" + §5 (the OMR card contract); acceptance §12.3, §12.4, §12.5, and §12.10's C slice. Phases A+B are merged.

**Goal:** Card-instance identity (random 7-digit student-bubbled IDs), row allocation with shared-card offsets, the allocation store + lifecycle, quiz/worksheet row-mapping validation, scan-back resolution through the existing `createQuizScanRecorder` decode into grading, `IssueDocument` integration for tracked quizzes, and the `release-card`/render-card CLI surface.

**Architecture:** Pure domain row-planning + lifecycle rules (`allocation.mjs`); a YAML allocation store adapter; `RenderPrintDocument` gains allocation context (card header strip, startRow-offset numbering, record writes); a `ResolveCardScan` use case joins decoded scans to allocation records → derived banks → grading (exact-set multi_select, ambiguous-vs-answer via per-row item type); `IssueDocument` resolves `print/<id>@<rev>` document references and writes the allocation record in the slot the form map holds today. `true_false` joins the item registry (spec §5.3 row-mappable set).

**Tech Stack & conventions:** exactly Phases A/B (vitest from repo root, dotted-path errors, closed registries, deterministic renders, legacy byte-safety, commit trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`).

## Global Constraints (spec §5)

- **Card ID:** 7 numeric digits, leading zeros legal, never all-zero, RANDOM (opaque handles), collision-checked against the store at allocation. The decoded scan `testId` IS the card ID; `'?'` digits or null ⇒ unresolvable scan error, never a guess.
- **Rows:** printed question numbers ARE card rows; contiguous from `startRow` in document order across OMR-answered items; `startRow + count − 1 ≤ 50`; ≤5 choices per row-mapped item; row-mappable types = `multiple_choice`, `true_false` (rendered Ⓐ True / Ⓑ False, graded as A/B), `multi_select`. Bank-boundary (row 25/26) is a decode detail, never an allocation constraint.
- **Archetype rules:** quiz ⇒ every scored item row-mappable (validation error otherwise); worksheet ⇒ items marked `omr: true` consume rows, write-on blocks coexist without consuming rows.
- **Lifecycle:** `live → satisfied | released | superseded`; collision = overlap with ANY live range on the same card (regardless of learner); re-render of same `(documentId, learner)` on the same card supersedes its prior record; anonymous renders legal (no learnerId).
- **Numbering truth:** the allocation record is authoritative; the teacher key renders per allocation (numbers match the sheet including offsets).
- **Scan grading:** per-row item type from the derived bank (via pinned rev): double-mark on a single-select row = `ambiguous` (never wrong-answer); multi_select = exact-set full-points-or-zero; scans resolving to a superseded rev grade normally + flag `revisionSuperseded`.
- **Phases A/B regressions forbidden**; `plot`/`geometry` stay pinned; no dispatch/v2-spec features.

## File Structure

```
backend/src/2_domains/school/documents/
  allocation.mjs                  # Task 1 — card ids, row planning, lifecycle rules (pure)
  blocks.mjs / documentV2.mjs     # Task 2 — omr flag semantics + archetype row-mapping validation
backend/src/2_domains/school/questionBankValidation.mjs + grading.mjs  # Task 2 — true_false item
backend/src/1_adapters/school/documents/YamlAllocationStore.mjs        # Task 3
backend/src/1_rendering/school/documents/   # Task 4 — card header strip, true_false row, startRow numbering
backend/src/3_applications/school/documents/
  RenderPrintDocument.mjs         # Task 5 — allocation context + record writes
  ResolveCardScan.mjs             # Task 6 — scan → allocation → bank → grade
backend/src/3_applications/school/usecases/IssueDocument.mjs           # Task 7 — print-document refs + allocation slot
cli/school-docs.cli.mjs           # Task 7 — release-card, --card/--start-row/--fresh-card
```

---

### Task 1: Card IDs + row planning + lifecycle rules (pure domain)

**Files:** Create `backend/src/2_domains/school/documents/allocation.mjs` + test (isolated domain dir).
**Interfaces:**
- `generateCardId(rng)` → 7-digit string (rng injected, `mulberry32`-compatible 0..1 function); never `'0000000'`; leading zeros preserved.
- `CARD_ROWS = 50`, `ROW_CHOICES = 5`, `ROW_MAPPABLE_TYPES = ['multiple_choice','true_false','multi_select']`.
- `planRows({document, bank, startRow = 1})` → `{errors} | {rows: [{row, blockPath, itemId, itemType, choiceCount}]}` — walks the PREPARED document (post bank-select expansion; Task 5 supplies it) in order; quiz ⇒ all scored items must be row-mappable; worksheet ⇒ only `omr: true` questions consume rows; errors: non-mappable scored item on quiz (dotted path), >5 choices, `startRow + rows − 1 > 50`, startRow < 1 or non-int.
- `ALLOCATION_STATUSES`; `checkCollision(existing, candidateRange)` → colliding live records; `supersedes(existing, candidate)` → the prior live record for same `(documentId, learnerId)` or null; `rangesOverlap(a, b)`.
- [ ] TDD (id generation distribution/edges; planRows matrix incl. quiz/worksheet modes, bank-boundary spanning is NOT an error; collision/supersede truth tables) → implement → commit.

### Task 2: `true_false` item + `omr` flag + archetype row-mapping validation (domain)

**Files:** Modify `questionBankValidation.mjs`, `grading.mjs`, `blocks.mjs`, `documentV2.mjs`, `documentSource.mjs` + tests.
**Interfaces:**
- `true_false` in ITEM_TYPES: `{prompt, answer: true|false}` (bank form; source-stage inline `answer` legal per the existing gating); grading: given `'A'|'B'` (or boolean) → A=true/B=false exact; `givenShapeError` accepts those shapes.
- `question` blocks accept `omr: true|false` (default: quiz archetype ⇒ effectively true for scored items; worksheet ⇒ default false) — validation only here; row consumption lives in Task 1's planner. Publish passes `omr` through untouched; inline true_false questions mint `true_false` items.
- `documentV2` quiz-archetype validation calls `planRows` shape-level checks where possible WITHOUT a bank (structural: scored non-mappable block types on quiz = error at validate time; choice-count checks needing resolved banks defer to render-time planning — state this split in comments).
- [ ] TDD → implement → all domain suites green → commit.

### Task 3: Allocation store (adapter)

**Files:** Create `backend/src/1_adapters/school/documents/YamlAllocationStore.mjs` + test.
**Interfaces:** READ `IFormMapStore`'s implementation/persistence home first and mirror its conventions. Store per-card YAML under the print-documents data root (`allocations/<cardId>.yml`, one file per card holding its records array).
- `allocate({cardId?, request})` — no cardId ⇒ generate fresh (injected rng; retry on store collision, bounded attempts); collision check per Task 1 rules against live records; supersede handling (marks prior, appends new); returns the persisted record.
- `get(cardId)`, `findByCard(cardId)`, `updateStatus({cardId, recordId, status})`, `release({cardId, rows?})`.
- Records carry `recordId` (deterministic: `<documentId>@<rev>:<variant>:<start>-<end>` or similar — state scheme), timestamps supplied by caller (no Date in adapter logic beyond persistence conventions — match house style).
- [ ] TDD (fresh-id retry on collision, live-overlap refusal, supersede, release, round-trip) → implement → commit.

### Task 4: Card header strip + true_false rendering + startRow numbering (rendering)

**Files:** Modify `measure.mjs`, `DocumentPdfRenderer.mjs`, `workbookTheme.mjs` + snapshot tests.
**Interfaces:**
- Card header strip (below the document header, above body): `Card  4 8 2 9 3 0 6  —  questions 18–30` in large spaced digits (theme tokens: `card` group — digit size/tracking/band height), plus first-use instruction line (`Bubble this number into columns 1–7 of a new card.`) when `cardFirstUse: true`; drawn only when allocation context present. Thread via render options like totalPoints.
- `true_false` question rows: two badges Ⓐ True Ⓑ False (reuse badge geometry).
- Numbering base: measurement/draw already receive positional numbers — Task 5 assigns them from `startRow`; rendering just prints what's given (verify nothing re-derives from 1).
- [ ] TDD (snapshots for header strip w/ and w/o first-use, true_false row; matrix render test still green) → implement → commit.

### Task 5: Allocation context in RenderPrintDocument (application)

**Files:** Modify `RenderPrintDocument.mjs` + tests.
**Interfaces:**
- Context gains `{cardId?, startRow?, freshCard?, allocationStore?}` (store injectable; absent store + card context = error). Flow for a card-attached render: prepare document → `planRows` (with resolved banks) → allocate via store (fresh or supplied cardId; supersede semantics) → number questions from the RECORD's startRow → render with card header (first-use = fresh card) → return `{..., allocation: {cardId, rowRange, recordId}}`.
- Quiz archetype with NO card context: tracked path expects issuance (Task 7) — plain render() without card stays legal for proofs but warns (`quiz rendered without card allocation`).
- Teacher key: numbers from the same record (render the key with the allocation context — assert key numbers match offset sheet numbers).
- Determinism: same context incl. cardId/startRow ⇒ identical bytes; record write idempotency via supersede rules.
- [ ] TDD (offset numbering incl. teacher key match; fresh-card first-use header; worksheet omr-mixed rows; collision surfaced as structured error) → implement → commit.

### Task 6: Scan-back resolution + grading (application)

**Files:** Create `backend/src/3_applications/school/documents/ResolveCardScan.mjs` + test.
**Interfaces:** READ `backend/src/3_applications/quizzes/quizScanRecorder.mjs` (decoded record shape `{testId, answers: {row: letter|letters[]}}`) and how app.mjs consumes its records (wire-in point for composition — identify it; actual composition wiring lands in Task 7).
- `ResolveCardScan({allocationStore, repository, banks?})`: `execute({testId, answers})` →
  - testId null or containing `'?'` ⇒ `{error: {code: 'CARD_ID_UNREADABLE'}}`.
  - Lookup records for card; for each live/satisfied range covered by answered rows: resolve published rev + derived bank; per row: map to item; grade — single-select: letter match, array given ⇒ `ambiguous`; `true_false`: A/B; `multi_select`: exact-set; points from block/defaultPoints; unanswered rows in range = `blank`.
  - Returns `[{cardId, recordId, documentId, rev, variant, learnerId?, revisionSuperseded, results: [{row, itemId, status: correct|incorrect|ambiguous|blank, given, points, earned}], totalPoints, earnedPoints}]`; rows outside any allocation ⇒ listed in `unallocatedRows` (never guessed).
  - Marks records `satisfied` (via store) when their range is covered by the scan (partial coverage stays live — state rule).
- [ ] TDD (multi-doc shared card spanning bank boundary; ambiguous vs multi_select; superseded rev flag; unreadable id; unallocated rows) → implement → commit.

### Task 7: IssueDocument integration + CLI (application + composition)

**Files:** Modify `IssueDocument.mjs` (careful — read fully; existing tests must stay green), `cli/school-docs.cli.mjs`, the composition site wiring school documents; + tests.
**Interfaces:**
- `IssueDocument` gains optional deps `{printDocuments?, renderPrintDocument?, allocationStore?}`: when the session's unit document reference matches `print/<id>@<rev>` (extend the unit-document resolution — READ how `curriculum.getDocument` resolves today and add the prefix branch WITHOUT touching legacy resolution), render via `RenderPrintDocument` with a fresh-card allocation (learner from the session), and **write the allocation record in the exact slot the form map is written today** (before the issue event — preserve the ordering guarantee; legacy units keep writing form maps unchanged).
- CLI: `school:docs release-card <cardId> [--rows a-b]`; `render --card <id> --start-row <n> | --fresh-card` (requires the allocation store; prints the allocation result; warnings preserved). `resolve-scan` NOT in CLI (scan-back flows through the existing recorder pipeline; composition wires ResolveCardScan where quiz scan records are consumed — wire it, feature-flag-free, with a log line per resolution).
- [ ] TDD (issue path with print-document ref writes allocation before issue event — assert ordering via a spy store; legacy unit path untouched byte-for-byte; CLI flows) → implement → all school application + CLI suites green → commit.

### Task 8: Phase C acceptance + evidence

**Files:** `acceptance.phaseC.test.mjs` + `docs/_wip/audits/2026-08-04-print-design-phase-c-acceptance.md`.
- [ ] **§12.3:** quiz with non-mappable scored item / >5 choices / range past 50 fails validation with dotted paths; worksheet with `startRow: 18` prints first question numbered 18; simulated scan of rows 18–30 (spanning the 25/26 bank boundary) resolves through the store to the right document rev, learner, and shuffles.
- [ ] **§12.4:** overlap-on-live collision rejected; same-(doc,learner) re-render supersedes cleanly; `release-card` frees a range.
- [ ] **§12.5:** decoded multi-mark row grades exact-set from the derived bank; double-mark on single-select reports `ambiguous`; per-row item type demonstrably flows bank→resolver.
- [ ] **§12.10-C:** the tracked-quiz slice — same document issues through IssueDocument with session+allocation vs loose worksheet render, envelope/context-only difference.
- [ ] Visual evidence: card-attached quiz sheet PDF/PNG (header digits + offset numbering) + its teacher key + a fresh-card first-use sheet; pixel-pin one page.
- [ ] Full Phases A+B+C sweep recorded; pre-existing failures listed w/ merge-base check; commit `test(school-print): Phase C acceptance + evidence`.

---

## Self-Review Notes
- Spec §13-C coverage: allocation store+lifecycle → 1,3; card-ID workflow → 1,3,4,5; render-context attachment → 5; scan-back via createQuizScanRecorder → 6,7; IssueDocument → 7; release-card → 7. §12.3/.4/.5/.10-C → 8.
- Deliberate splits: structural row-mapping checks at validate time vs bank-dependent checks at render/planning time (Task 2 comment rule); scan resolution wired at composition, not a CLI command.
- Carried landmines: IssueDocument's ordering guarantee (allocation record in the form-map slot); teacher-key numbering must come from the allocation record; `'?'` testIds never guessed.
