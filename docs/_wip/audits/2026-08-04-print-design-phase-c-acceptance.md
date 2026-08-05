# Print Design System — Phase C acceptance sweep

**Date:** 2026-08-05
**Branch:** `feat/print-design-phase-c` @ `b63dcc431`
**Scope:** spec §12.3, §12.4, §12.5, and the Phase-C slice of §12.10 — see
`docs/_wip/plans/2026-08-04-print-design-system-requirements.md` §12, and the
Phase C task plan at
`.superpowers/sdd/2026-08-04-print-design-system-phase-c-plan/`.
**Test file:** `backend/src/3_applications/school/documents/acceptance.phaseC.test.mjs`
(19 tests, all passing on the real pipeline — no stubbed renderer/theme/store).

This is a falsifiability sweep against the real `RenderPrintDocument`,
`PublishPrintDocument`, `ResolveCardScan`, and `IssueDocument` use cases, the
real `YamlAllocationStore`, the real `DocumentPdfRenderer`, real embedded
fonts, real poppler text extraction/rasterization, and — for the
bank-boundary scan test — the REAL `decodeQuizSheet` bit decoder (a
hand-built 32-column `marks[]` array, not a hand-assembled `{testId,
answers}` object) — not a re-run of the per-task unit suites (those already
exist and stay green; see the full sweep at the bottom). A fake in-memory
`io` stands in for `YamlAllocationStore`'s filesystem in most tests (the SAME
shape Task 5/6/7's own unit suites already use); the release-card test
additionally drives the real CLI (`school-docs.cli.mjs`'s `runSchoolDocs`)
against a real temp-directory filesystem, per this task's brief ("drive the
CLI function for that leg").

---

## Carry-overs (mandatory per this task's brief)

**(a) Task 6's review gap** — a `superseded`-status allocation record's rows
reaching `unallocatedRows` on scan-back had no test (only `released` did).
Closed by "§12.4 ... CARRY (Task 6's own review gap)" below: a card is
allocated, then re-rendered for the same `(document, learner)` at a
*different* row range on the same card (a genuine supersede), and the
now-unclaimed original rows are scanned — `results: []`,
`unallocatedRows: [1]`, never graded against the stale answer key and never
silently dropped.

**(b) Task 4's deferred pixel coverage** — the card header strip
(`workbookTheme.mjs`'s `card` token group) had zero pixel-level coverage;
`workbookTheme` isn't in the pixel-golden corpus, and Task 4's own report
flagged this explicitly ("no pixel-golden coverage for the card strip's
visual layout"). Closed by the "visual evidence" section below: a real
card-attached sheet is rasterized, I looked at the rendered page directly,
and the seven card-id digits, the "Card" label, the `questions N–M` meta
line, and the reminder/first-use instruction line are all visually confirmed
on a committed PNG — one page additionally pinned as a real pixel-diff
regression snapshot.

---

## §12.3 — Card contract

> *a quiz with a non-row-mappable scored item, >5 choices, or `startRow +
> count − 1 > 50` fails validation with dotted paths; a worksheet rendered
> with `startRow: 18` prints its first question as 18 and a simulated scan
> of rows 18–30 (spanning the bank boundary) resolves through the allocation
> store to the right document rev, learner, and shuffles*

| Check | Result |
|---|---|
| Structural (validate-time, no bank needed): a scored quiz question wrapping non-row-mappable nested content (`short_answer`) fails `documentV2` validation at a dotted block path (`blocks[0]: scored quiz question wraps a non-row-mappable 'short_answer'...`) | ✅ |
| Bank-dependent (render-time): an inline question whose OWN itemId mints a `short_answer` bank item (an `answer`, no `choices`) *passes* `validateDocumentSource` cleanly, then fails card allocation at render time with a dotted block path (`blocks[0]: item type "short_answer" is not row-mappable...`) — the exact two-tier split Task 2's own code comments document | ✅ |
| >5 choices on a row-mapped `multiple_choice` item fails card allocation with a dotted block path (`blocks[0]: 6 choices exceeds the 5-choice row limit`) — legal at plain bank validation (only `multi_select` is capped there), only the CARD row limit rejects it | ✅ |
| `startRow + count − 1 > 50` fails card allocation — a **whole-range** error (`rows 48-52 exceed the 50-row card capacity...`), not block-scoped, since there is no single offending block | ✅ (see note below) |
| A worksheet rendered with `startRow: 18` prints its first question numbered **18**, last numbered **30**, never `1.` | ✅ |
| A simulated scan of rows 18–30 (spanning the 25/26 bank boundary), decoded through the REAL `decodeQuizSheet` bit layout, resolves through the allocation store to the right document rev, learner, and variant, and grades every row correctly (13/13 rows resolved, one deliberately wrong row at the exact bank-boundary seam graded `incorrect`, the rest `correct`) | ✅ |
| Shuffle-correct resolution: two variants of the SAME bank-select-driven document, rendered onto DIFFERENT cards, each grade against their OWN independently-derived (`deriveShuffle`/`applyShuffle`, never read off the code under test) seeded selection — never cross-contaminated | ✅ |

**Note on "dotted paths":** the brief's phrasing groups all three failure
modes together, but only two of them are genuinely block-scoped
(`blocks[N]: ...`) — the non-row-mappable-item and >5-choices errors both
come from `allocation.mjs`'s `planRows`, which walks per-block and reports
the OFFENDING block's own path. The `startRow + count − 1 > 50` case has no
single offending block (the whole row range is what's oversized), so
`planRows` reports a whole-range message instead — this is accurately
described here, not silently written up as something it isn't.

**Bank-boundary scan detail:** the scan was built by hand-assembling a real
32-column `marks[]` array (`encodeMarks` in the test file, implementing spec
§5.1's exact bit layout: digit *d* = bit (9−*d*) for the 7 ID columns; Q1–25
upper bank = bits 10..6; Q26–50 lower bank = bits 4..0, on the SAME 25
physical columns as the upper bank) and decoding it through the real,
unmodified `decodeQuizSheet` (`backend/src/3_applications/quizzes/quizScanRecorder.mjs`)
— the actual production decoder, not a shortcut. Row 25 (the last upper-bank
row) and row 26 (the first lower-bank row) both resolved through the SAME
allocation record, confirming the boundary is purely a decode detail (spec
§5.1), never an allocation seam.

Tests in the file's own `§12.3` describe blocks → **7/7 passed.**

**PASS.**

---

## §12.4 — Collision, supersede, release-card

> *a second render overlapping a `live` range on the same card fails; a
> re-render of the same `(document, learner)` supersedes cleanly;
> `release-card` frees a range*

| Check | Result |
|---|---|
| A second render overlapping a `live` range on the SAME card is rejected — structured `DomainInvariantError` / `ALLOCATION_COLLISION` — regardless of learner (two DIFFERENT documents, two DIFFERENT learners, same card, overlapping rows) | ✅ |
| The colliding attempt never becomes durable — only the original `live` record exists afterward | ✅ |
| A re-render of the same `(document, learner)` — same id, same learner, a genuinely different variant, so a real new record, not the identical-recordId reprint shortcut — supersedes cleanly: the prior record flips to `superseded`, the new one is `live`, and the teacher key's printed numbers match the NEW allocation | ✅ |
| `release-card`, driven through the REAL CLI function (`runSchoolDocs(['release-card', ...])`, the same entry point `school-docs.cli.mjs`'s user runs, against a real temp-directory filesystem after a real `publish` + `render --fresh-card` CLI round trip) frees a range | ✅ |
| After release, a FRESH allocation on the SAME rows of the SAME card no longer collides — proven by a direct `YamlAllocationStore.allocate()` call against the same on-disk directory the CLI just wrote | ✅ |
| **CARRY (Task 6's own review gap):** a `superseded` record's rows are unallocated on scan-back — a card allocated, then re-rendered for the same `(document, learner)` at a DIFFERENT row range (a genuine supersede, not an idempotent reprint), then scanned on its now-unclaimed original row: `results: []`, `unallocatedRows: [1]` — never graded against the stale answer key, never silently dropped either | ✅ |

Tests in the file's own `§12.4` describe block → **4/4 passed.**

**PASS.**

---

## §12.5 — `multi_select` end-to-end + per-row item-type flow

> *a decoded multi-mark row grades exact-set against the derived bank; a
> double-mark on a single-select row reports ambiguous; per-row item type
> demonstrably flows from the derived bank to the resolver*

A single three-row quiz fixture (`multiple_choice`, `true_false`,
`multi_select` in rows 1–3) is scanned multiple ways to isolate each rule:

| Check | Result |
|---|---|
| A decoded multi-mark row (multi_select, 2 marks) grades **exact-set** against the derived bank — a correct 2-of-2 set scores full points | ✅ |
| An incorrect (wrong-member) multi_select set — one right mark, one wrong one — grades `incorrect`, `earned: 0`, NOT ambiguous (multi_select has no "too many marks" special case; it's exact-set-or-nothing) | ✅ |
| A double-mark on a SINGLE-SELECT row (`multiple_choice`) reports `ambiguous`, `earned: 0` — never guessed at as a wrong answer | ✅ |
| The double-mark on row 1 does not poison grading of rows 2/3 in the SAME scan call | ✅ |
| Per-row item type flows from the derived bank to the resolver: in ONE scan, row 1 (`multiple_choice`) grades via the ambiguous-on-double-mark rule, row 2 (`true_false`) grades via the A/B-to-boolean rule (a single 'B' mark → `false`, correctly `incorrect` against a `true` answer key — never "ambiguous", since true_false has no multi-mark concept beyond A/B), and row 3 (`multi_select`) grades via exact-set (a 3-mark set against a 2-correct key is a real WRONG SET, not "too many marks") — three different rules, three different item types, read off the bank, never guessed uniformly | ✅ |

Tests in the file's own `§12.5` describe block → **3/3 passed.**

**PASS.**

---

## §12.10-C — Tracked-quiz slice (envelope/context-only difference)

> *the tracked-quiz slice: same document issues through IssueDocument with
> session+allocation vs loose worksheet render, envelope/context-only
> difference*

One published document (2 `multiple_choice` questions) is rendered two
ways:

- **Tracked leg** — through `IssueDocument.execute()`: a real session
  (`FakeSessionRepository`), a real (fake) laser printer job, resolved via a
  `print/<id>@<rev>` unit reference, rendering via `RenderPrintDocument` with
  a fresh card allocation.
- **Loose leg** — `RenderPrintDocument.execute({document: published,
  context: {}})` directly: no session, no card, no printer.

| Check | Result |
|---|---|
| Both legs produce a real PDF | ✅ |
| The loose leg's `allocation` is `null`; it warns `"quiz '...' rendered without card allocation"` | ✅ |
| Question prompts, their order, and the score box (`Score ____ / 2`) are IDENTICAL text on both legs | ✅ |
| Question numbering is identical (both print `1.`/`2.`) — the card envelope adds a HEADER, it does not renumber this particular sheet | ✅ |
| The card header strip (`"Bubble this number into columns 1–7 of a new card."`) is the ONE envelope-level difference: present on the tracked render, absent on the loose one | ✅ |

Tests in the file's own `§12.10-C` describe block → **1/1 passed.**

**PASS.**

---

## Visual evidence

Two published quiz documents share ONE physical card: document 1
(`freshCard`, `startRow: 1`) is the FIRST-USE sheet; document 2 (`cardId`
from document 1, `startRow: 3`) is the CONTINUATION sheet, plus its teacher
key. Both student pages were rasterized with poppler (`pdftoppm -r 150`) and
**I looked at both directly** before pinning anything. PDFs and the
continuation sheet's PNG are committed as reviewable evidence at
`docs/_wip/audits/2026-08-04-print-design-phase-c-acceptance/`; page 1 of
the continuation sheet is additionally pinned as a real pixel-diff
regression snapshot (0.5% whole-page tolerance, same model as Phase A/B's
proof suites / `tests/isolated/rendering/school/golden/`).

| File | What it shows |
|---|---|
| `card-first-use-student.pdf` | Fresh-card first-use sheet: `Card 4 4 4 4 4 4 4 — questions 1–2`, then *"Bubble this number into columns 1–7 of a new card."*, questions numbered 1/2 |
| `card-continuation-student.pdf` / `card-continuation-student-p01.png` (pinned) | Continuation sheet on the SAME card: `Card 4 4 4 4 4 4 4 — questions 3–4`, then *"Use your card 4444444."*, questions numbered **3/4** (never 1/2) |
| `card-continuation-teacher-key.pdf` | The continuation sheet's teacher key: `3. B` / `4. A`, matching the offset student numbers exactly |

**What I confirmed by looking at the rasterized pages directly:**

- The first-use sheet's header reads `Card` in a small bold label, then
  seven large, evenly-tracked digits (`4 4 4 4 4 4 4` — this fixture's
  constant test rng draws the same digit seven times, which is a legal,
  non-all-zero card id per spec §5.2), then `— questions 1–2` in a smaller
  meta font, then the italic first-use instruction line, then question 1
  ("Q1 prompt", choices Red/Green/Blue) and question 2 ("Q2 prompt", choices
  Cat/Dog/Fish), each with real circle OMR bubbles labeled A/B/C.
- The continuation sheet's header carries the IDENTICAL seven digits (same
  physical card), but a different meta line (`questions 3–4`) and a
  different instruction line (`Use your card 4444444.` — the reminder, not
  the first-use bubbling instruction), and its two questions are numbered
  **3** and **4**, not 1 and 2 — direct visual confirmation of startRow
  offset numbering, not just a text-extraction assertion.
- The teacher key page for the continuation sheet prints `3. B` / `4. A`,
  the exact letters matching each question's correct choice at its printed
  position (`Two` is choice index 1 → `B`; `Up` is choice index 0 → `A`),
  confirming teacher-key/student-sheet numbering parity under a startRow
  offset.

No defects found. This closes CARRY (b) — the card header strip's pixel
layout (label + tracked digits + meta text + instruction line, all
baseline-aligned across different font sizes) is now visually confirmed,
not just structurally asserted.

Tests in the file's own `visual evidence` describe block → **4/4 passed.**

**PASS.**

---

## Full acceptance file run

```
npx vitest run backend/src/3_applications/school/documents/acceptance.phaseC.test.mjs
```
```
 Test Files  1 passed (1)
      Tests  19 passed (19)
```

---

## Full Phase A + B + C regression sweep

```
npx vitest run \
  backend/src/2_domains/school/documents/ \
  backend/src/1_rendering/school/documents/ \
  backend/src/3_applications/school/documents/ \
  backend/src/1_adapters/school/documents/ \
  backend/src/3_applications/school/usecases/ \
  backend/src/3_applications/quizzes/ \
  tests/isolated/domain/school/documents/ \
  tests/isolated/rendering/school/ \
  tests/isolated/application/school/ \
  tests/isolated/composition/schoolLifecycleWiring.test.mjs \
  tests/isolated/composition/schoolPrintScanConsumer.test.mjs \
  tests/isolated/e2e/school/lifecycle.e2e.test.mjs \
  cli/school-docs.cli.test.mjs
```
```
 Test Files  1 failed | 65 passed (66)
      Tests  4 failed | 1676 passed (1680)
```

The one failing file (`tests/isolated/application/school/schoolcalcPlatformConformance.test.mjs`,
4 tests) is pre-existing and unrelated — see below. Includes: Phase A's own
`acceptance.phaseA.test.mjs` (26 tests, unchanged), Phase B's
`acceptance.phaseB.test.mjs` (13 tests, unchanged), this task's
`acceptance.phaseC.test.mjs` (19 tests), the pixel-diff golden suite
(`tests/isolated/rendering/school/golden/golden.test.mjs`, untouched), every
per-task unit/structural suite across all Phase A+B+C tasks (allocation
domain, `true_false`/`omr` validation, the `YamlAllocationStore` adapter,
card header strip + true_false rendering, `RenderPrintDocument`'s allocation
context, `ResolveCardScan`, `IssueDocument`'s tracked-quiz path), and the
CLI's own `release-card`/`render --card` integration tests
(`cli/school-docs.cli.test.mjs`).

**`git status --short` before and after this sweep:**
```
?? backend/src/3_applications/school/documents/acceptance.phaseC.test.mjs
?? docs/_wip/audits/2026-08-04-print-design-phase-c-acceptance/
```
Only new files (this task's own test + the evidence dir). Zero modification
to any pre-existing snapshot file — specifically checked Phase A's own
`__snapshots__/acceptance.phaseA.test.mjs.snap`, Phase B's own
`__snapshots__/acceptance.phaseB.test.mjs.snap`,
`tests/isolated/rendering/school/golden/snapshots/`, and
`backend/src/1_rendering/school/documents/__snapshots__/` (all empty diffs
— this task's test file adds no new snapshot files of its own; every
Phase C visual check uses a committed PNG + pixel-diff comparison instead,
matching Phase A/B's own "visual evidence" sections).

---

## Pre-existing failures (NOT introduced by this work)

Merge base for Phase C (per this task's brief): `git merge-base origin/main
HEAD` → **`19eb34e8d`** ("docs: record merged print-design-phase-b branch")
— the commit immediately after Phase B merged, i.e. immediately before any
of the Phase C task commits. Verified empirically, not by inference: the
main checkout at `/opt/Code/DaylightStation` happened to already be sitting
at exactly this commit (its own `node_modules` present and usable), so the
same failing suite was re-run there directly — no scratch worktree needed
this time.

```
npx vitest run tests/isolated/application/school/schoolcalcPlatformConformance.test.mjs
```

| At `b63dcc431` (this branch, Phase C HEAD) | At `19eb34e8d` (merge-base, pre-Phase-C) |
|---|---|
| 1 file failed, 4 tests failed | 1 file failed, 4 tests failed (identical) |

Identical failure at both commits:

- **`tests/isolated/application/school/schoolcalcPlatformConformance.test.mjs`**
  (4 tests) — `SchoolCalcDevice` validation (`ValidationError: SchoolCalc
  device requires deviceId, label, platformId, catalogId, and createdAt`)
  rejects a fixture the test itself constructs; unrelated SchoolCalc device
  domain, not touched by any Phase C work.

**Confirmed via `git diff --stat` that no Phase C commit touched either
file:**

```
$ git diff --stat 19eb34e8d..HEAD -- \
    backend/src/2_domains/school/schoolcalc/SchoolCalcDevice.mjs \
    tests/isolated/application/school/schoolcalcPlatformConformance.test.mjs
(no output — zero diff)
```

This is the SAME failure Phase A's and Phase B's own acceptance docs already
documented under a wider sweep (`cli/`-rooted, which also picks up several
`node:test`/Jest-runner-mismatch files unrelated to School entirely); this
narrower School-scoped sweep isolates it to the one genuinely relevant
failing file.

---

## Summary

| Spec item | Result |
|---|---|
| §12.3 Card contract (validation split, startRow offset, bank-boundary scan-back, shuffle-correct resolution) | PASS |
| §12.4 Collision, supersede, release-card (incl. CARRY: Task 6's superseded-rows gap) | PASS |
| §12.5 multi_select end-to-end + per-row item-type flow | PASS |
| §12.10-C Tracked-quiz slice (envelope/context-only difference) | PASS |
| Visual evidence (CARRY: Task 4's deferred card-strip pixel coverage) | DONE — 2 real rendered sheets + teacher key reviewed, PDFs+PNG committed, 1 page pinned as pixel-diff regression |
| Legacy + Phase A + Phase B + Phase C suites (all school-document layers, applications, CLI) | 1676/1680 passed; the 4 failures are pre-existing and unrelated, confirmed identical at the merge-base commit |
| Pre-existing failures | 1 file / 4 tests, confirmed identical at merge-base `19eb34e8d`, confirmed untouched by any Phase C commit |

No §12 item failed. No concerns.
