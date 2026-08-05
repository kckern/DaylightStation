# Print Design System — Phase B acceptance sweep

**Date:** 2026-08-04
**Branch:** `feat/print-design-phase-b` @ `b6248e0fd`
**Scope:** spec §12 items tagged `[B]`, plus the Phase-B slice of §12.10 — see
`docs/_wip/plans/2026-08-04-print-design-system-requirements.md` §12, and the
Phase B task plan at
`.superpowers/sdd/2026-08-04-print-design-system-phase-b-plan/`.
**Test file:** `backend/src/3_applications/school/documents/acceptance.phaseB.test.mjs`
(13 tests, all passing on the real pipeline — no stubbed renderer/theme).

This is a falsifiability sweep against the real `RenderPrintDocument` and
`PublishPrintDocument` use cases, the real `DocumentPdfRenderer`, real
embedded fonts, and real poppler text extraction/rasterization — not a
re-run of the per-task unit suites (those already exist and stay green; see
the full sweep at the bottom). A fake in-memory repository (the same shape
`PublishPrintDocument.test.mjs`/`RenderPrintDocument.test.mjs` already use)
stands in for the filesystem; its own on-disk append-only contract is
`YamlPrintDocumentRepository.test.mjs`'s job, not this sweep's.

---

## Carry-over from Task 6's review (mandatory per this task's brief)

Task 6's review flagged that the answer-key collection's nested paths were
lightly covered. This sweep closes that gap with one **kitchen-sink source
document** (`kitchenSinkSource` in the test file) that puts every Phase B
answer-bearing shape in the SAME tree:

- standalone `cloze`, blank 1 **with** a `wordbank` ref, blank 2 **without** one
- `wordbank`
- `matching`
- standalone `short_answer`
- `essay` — one `box: true` variant, one `lines: 6` variant (essay never
  carries an answer either way)
- an inline `question` with `multiple_choice` shape (`choices`+`answer`)
- an inline `question` with `multi_select` shape (`choices`+`answers`)
- a bank-select (`select`) `question` against an **external** bank

The teacher key is asserted correct for **every one of these**, across
variants 0, 1, and 2 (three full round trips, not just variant 0) — see
§12.2 below. This same document is also Task 7's visual-evidence document
(see "Visual evidence" below) — I rendered it, rasterized every student
page, and looked at both pages directly before pinning anything.

---

## §12.2 — Answer split

> *a source file with inline answers validates; its published document fails
> the answer-scan if answers survive (publish postcondition test); the
> teacher key renders from the derived bank and matches the shuffles*

| Check | Result |
|---|---|
| kitchen-sink source (every inline answer shape) validates as `school.document-source/v1` | ✅ |
| publish strips every answer field — deep scan of the REAL published artifact (via `PublishPrintDocument`, not the raw domain fn) finds zero `answer`/`answers`/`pairs` keys anywhere in the tree | ✅ — derived bank has exactly 6 items (`cloze`×2, `matching`, `multiple_choice`, `multi_select`, `short_answer`); `wordbank` and the bank-select question correctly mint nothing of their own |
| publish postcondition FAILURE path runs through the real `PublishPrintDocument` use case (a 1-choice `multiple_choice`, known-invalid per `validateQuestionBank`) | ✅ — rejects `INVALID_DOCUMENT_SOURCE`; `repository.store.size === 0`, nothing persisted |
| a PERSISTED (repository round-tripped) publish resolves its teacher key via `repository.getDerivedBank` — the same path `school-docs.cli.mjs`'s `publish` + `render --teacher` actually use, not the in-memory source auto-publish shortcut | ✅ |
| teacher key matches student shuffles, **variant 0** — every one of the 8 answerable items (2 cloze blanks, matching, short_answer, inline MC, inline MS, 2 bank-selected items) asserted correct | ✅ |
| teacher key matches student shuffles, **variant 1** — same 8 items, different wordbank/matching/bank-select shuffle order | ✅ |
| teacher key matches student shuffles, **variant 2** — same 8 items, a third distinct shuffle order | ✅ |

**How the per-variant check works:** for each variant, `wordbank`/`matching`
left/right/`bank-select` expected orders are computed independently via
`deriveShuffle`/`applyShuffle` (never read off the code under test), then:

- the STUDENT page is checked to print wordbank/matching in that exact
  shuffled order, and to show exactly the 2 (of 3) shuffled-selected
  external bank items — the omitted one never appears;
- the TEACHER key section (sliced from `"Answer key —"` onward, so a
  same-numbered entry on the student page can never be confused for a key
  entry) is checked to contain the correct answer text for all 8 items,
  including the matching block's per-variant `"N-L …"` string and the
  bank-select items' answers at their correct (shuffle-order-dependent)
  printed numbers 3/4;
- essay (**both** the `box` and `lines` variants) is asserted to have **no**
  key entry in any variant — confirmed by checking its prompt text does not
  appear anywhere in the key section.

Actual extracted teacher-key section (variant 0, real render):

```
Answer key — Phase B Kitchen Sink (variant 0)
1. Photosynthesis
2. Mitosis
m1: 1-B 2-C 3-A
"Name a state capital." — Olympia
1. C
2. A, B, D
3. A
4. Paris
```

8 entries, matching all 8 answerable items — no essay, no wordbank-terms
leakage, no internal path-based ids.

Tests in the file's own describe `§12.2 answer split…` → **7/7 passed.**

**PASS.**

---

## §12.9 — Blocks (seeded shuffles + edit-stability)

> *cloze/wordbank/matching render with seeded shuffles pinned by snapshot;
> editing an unrelated sibling block does not change a keyed block's
> shuffle*

| Check | Result |
|---|---|
| cloze + wordbank + matching render together in one document; extracted page text pinned via `toMatchSnapshot()` | ✅ |
| edit-stability: a document with `wordbank` + `cloze` + `matching`, vs. the SAME document with an unrelated `rich_text` block inserted BETWEEN the wordbank and the cloze — wordbank AND matching (both left and right) print in the identical shuffled order in both documents | ✅ |
| the unchanged order is cross-checked directly against `deriveShuffle`/`applyShuffle` (not just "a equals b", which a shared bug could satisfy trivially) | ✅ |

This extends the existing unit-level edit-stability test (`RenderPrintDocument
.test.mjs`, wordbank only) to an acceptance-level check spanning wordbank
AND matching together, with a real mid-document sibling insertion (not just
prepended) and a real-pipeline snapshot pin.

Tests in the file's own describe `§12.9 seeded shuffles…` → **2/2 passed.**

**PASS.**

---

## §12.10(B) — Archetype dial, the score-box slice

> *quiz archetype now shows the score box with totalPoints; worksheet does
> not; envelope-only diff*

Phase A (`acceptance.phaseA.test.mjs`, §12.10-A) already proved
`header.scoreBox` differs `true`/`false` purely from `archetype`, with every
other header field identical — but explicitly could not render the box
itself, since `DocumentPdfRenderer` didn't consume it yet (spec: the visible
box is Phase B's job). This sweep proves the now-VISIBLE box:

| Check | Result |
|---|---|
| `header.scoreBox` is the ONLY header field differing between quiz/worksheet (re-confirms Phase A's envelope-only finding still holds post-Phase-B) | ✅ |
| quiz (5 questions × `defaultPoints` 1) prints `"Score ____ / 5"` — real extracted text | ✅ |
| worksheet (identical body) prints no `"Score ____"` text at all | ✅ |
| both pinned via `toMatchSnapshot()` (pageCount + SHA-256), so a future regression collapsing the visible box shows up as a diff | ✅ |

Tests in the file's own describe `§12.10(B) archetype dial…` → **2/2 passed.**

**PASS.**

---

## Visual evidence

The kitchen-sink source document (archetype `worksheet`, described above)
was rendered as both the student worksheet and its teacher key, at
`standard` type scale, `flow` fit policy. Both pages of the student render
were rasterized with poppler (`pdftoppm -r 150`) and **I looked at both
pages directly** before pinning anything. PDFs and every student-page PNG
are committed as reviewable evidence at
`docs/_wip/audits/2026-08-04-print-design-phase-b-acceptance/`; page 1 is
additionally pinned as a real pixel-diff regression snapshot inside the test
file (0.5% whole-page tolerance, same model as Phase A's proof suite /
`tests/isolated/rendering/school/golden/`).

| File | What it shows |
|---|---|
| `kitchen-sink-student.pdf` / `kitchen-sink-student-p01..02.png` | worksheet archetype, `standard` type scale, `flow` policy, 2 pages |
| `kitchen-sink-teacher-key.pdf` | the same 2 student pages + a `page_break` + the dense answer-key page |

**Page-by-page contents:**
- **p01 (pinned)** — title/name/date header; intro `rich_text`; `wordbank`
  box (4 shuffled terms, bold, boxed); `cloze` sentence with two fixed-width
  numbered blanks (`Plants convert light into energy through ¹___; cells
  divide by ²___.`); `matching` two-column write-the-letter grid (numbered
  left, lettered right, ruled ID blanks); standalone `short_answer` (prompt
  + 3 ruled lines); `essay` #1 with `box: true` (a real drawn rounded
  rectangle); `essay` #2 with `lines: 6` (prompt only — its ruled lines
  continue onto page 2, the natural flow-policy pagination point); footer
  "Page 1 of 2".
- **p02** — the tail of essay #2's 6 ruled lines; inline `multiple_choice`
  question (circle bubbles ⭕, "Red"/"Green"/"Blue"); inline `multi_select`
  question (square bubbles ☐ + italic "Mark all that apply." note,
  "2"/"3"/"4"/"5"); bank-select-expanded question 3 (external
  `multiple_choice`, "Paris"/"Lyon"/"Nice"); bank-select-expanded question 4
  (external `short_answer`, 3 ruled lines); continuation strip ("Phase B
  Kitchen Sink" + "Name: Proof Learner") and footer "Page 2 of 2".

I visually confirmed: the wordbank box and cloze blanks render correctly and
independently of each other; the matching grid's numbered/lettered columns
line up with real ruled write-in blanks, not glyphs; the `essay` box variant
draws a real bordered rectangle (distinct from the `lines` variant's plain
ruled lines); multiple_choice renders circle bubbles, multi_select renders
square bubbles with the "Mark all that apply." note — the OMR contract
(§5.1) staying visually distinct between the two item types; bank-select
questions 3–4 render identically to hand-authored ones (no visual "this came
from a different bank" tell). No defects found.

Screenshot (page 1, the pinned regression snapshot) is viewable directly at
`docs/_wip/audits/2026-08-04-print-design-phase-b-acceptance/kitchen-sink-student-p01.png`.

Tests in the file's own describe `visual evidence…` → **2/2 passed.**

---

## Full acceptance file run

```
npx vitest run backend/src/3_applications/school/documents/acceptance.phaseB.test.mjs
```
```
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

---

## Full Phase A + Phase B regression sweep (zero snapshot drift)

```
npx vitest run backend/src/2_domains/school/documents/ \
  backend/src/1_rendering/school/documents/ \
  backend/src/3_applications/school/documents/ \
  backend/src/1_adapters/school/documents/ \
  tests/isolated/domain/school/documents/ \
  tests/isolated/rendering/school/ \
  cli/school-docs.cli.test.mjs
```
```
 Test Files  31 passed (31)
      Tests  1003 passed (1003)
```

Includes: Phase A's own `acceptance.phaseA.test.mjs` (26 tests, unchanged),
this task's `acceptance.phaseB.test.mjs` (13 tests), the pixel-diff golden
suite (`tests/isolated/rendering/school/golden/golden.test.mjs`, untouched),
every per-task unit/structural suite across all Phase A+B tasks (shuffle
primitive, assessment validators, source/publish transform, assessment
rendering, bank threading, teacher key + CLI), and the CLI's own
`publish`/`render --teacher` integration tests
(`cli/school-docs.cli.test.mjs`).

**`git status` before and after this sweep:**
```
$ git status --short
?? backend/src/3_applications/school/documents/__snapshots__/acceptance.phaseB.test.mjs.snap
?? backend/src/3_applications/school/documents/acceptance.phaseB.test.mjs
?? docs/_wip/audits/2026-08-04-print-design-phase-b-acceptance/
```
Only new files (this task's own test + its own new snapshot file + the
evidence dir). Zero modification to any pre-existing snapshot file —
specifically checked Phase A's own `__snapshots__/acceptance.phaseA.test.mjs.snap`,
`tests/isolated/rendering/school/golden/snapshots/`, and
`backend/src/1_rendering/school/documents/__snapshots__/` (all empty
diffs).

---

## Pre-existing failures (NOT introduced by this work)

Merge base for Phase B (per this task's brief): `git merge-base origin/main
HEAD` → **`a224e09d7`** ("docs: record merged print-design-system Phase A
branch") — the commit immediately after Phase A merged, i.e. immediately
before any of the 10 Phase B task commits. Verified empirically, not by
inference: checked out `a224e09d7` into a scratch worktree (symlinking this
worktree's `node_modules` in, per the project's documented worktree-vitest
pattern) and re-ran the exact same command there.

```
npx vitest run cli/ \
  tests/isolated/application/school/schoolcalcPlatformConformance.test.mjs \
  tests/isolated/application/fitness/playlistSorter.test.mjs
```

| At `b6248e0fd` (this branch, Phase B HEAD) | At `a224e09d7` (merge-base, pre-Phase-B, scratch worktree) |
|---|---|
| 10 files failed, 6 tests failed, 376 passed | 10 files failed, 6 tests failed, 366 passed |

Identical failure SET at both commits (only the passing count differs — this
branch added 10 more passing tests elsewhere in `cli/`/`tests/isolated/`,
unrelated to these failures):

- **`cli/backfill-media-durations.test.mjs`**, **`cli/midi-ingest/*.test.mjs`**
  (5 files) — `"No test suite found"` (written for `node:test`, not vitest).
- **`tests/unit/suite/cli/newsreporter.cli.test.mjs`** — imports
  `@jest/globals` outside Jest.
- **`cli/lib/fitness/heal.test.mjs`** (2 tests) — pre-existing `Set`
  iteration-order assertion bug.
- **`tests/isolated/application/school/schoolcalcPlatformConformance.test.mjs`**
  (4 tests) — `SchoolCalcDevice` validation requires fields the fixture
  doesn't supply; unrelated SchoolCalc device domain.
- **`tests/isolated/application/fitness/playlistSorter.test.mjs`** — 0 tests
  collected (same runner-mismatch pattern).

**Confirmed via `git diff --stat` that none of the 10 Phase B task commits
touched any of these files:**

```
$ git diff --stat a224e09d7..HEAD -- cli/lib/fitness/heal.mjs \
    cli/backfill-media-durations.mjs cli/midi-ingest \
    tests/unit/suite/cli/newsreporter.cli.test.mjs \
    tests/isolated/application/school/schoolcalcPlatformConformance.test.mjs \
    backend/src/2_domains/school/schoolcalc/SchoolCalcDevice.mjs \
    tests/isolated/application/fitness/playlistSorter.test.mjs
(no output — zero diff)
```

None of these touch `school/documents/` in any way.

---

## Summary

| Spec item | Result |
|---|---|
| §12.2 Answer split (validates / strips / teacher key matches shuffles v0–v2) | PASS |
| §12.9 Blocks (cloze/wordbank/matching pinned; edit-stability) | PASS |
| §12.10(B) Archetype dial (visible score box, envelope-only diff) | PASS |
| Visual evidence (CARRY: Task 6 review — nested answer-key paths) | DONE — 2 real rendered pages reviewed, PDFs+PNGs committed, 1 page pinned as pixel-diff regression, teacher-key PDF committed |
| Legacy + Phase A + Phase B suites (all 5 layers + CLI) | 1003/1003 passed, zero snapshot drift |
| Pre-existing failures | 10 files / 6 tests, identical set Phase A already documented, confirmed untouched by any Phase B commit |

No §12[B] item failed. No concerns.
