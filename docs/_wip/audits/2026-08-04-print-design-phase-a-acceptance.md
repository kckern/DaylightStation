# Print Design System — Phase A acceptance sweep

**Date:** 2026-08-04
**Branch:** `feat/print-design-system` @ `0b5374cd8`
**Scope:** spec §12 items tagged `[A]` — see
`docs/_wip/plans/2026-08-04-print-design-system-requirements.md` §12, and the
Phase A task plan at
`.superpowers/sdd/2026-08-04-print-design-system-phase-a-plan/`.
**Test file:** `backend/src/3_applications/school/documents/acceptance.phaseA.test.mjs`
(26 tests, all passing on the real pipeline — no stubbed renderer/theme).

This is a falsifiability sweep against the real `RenderPrintDocument` use
case, the real `DocumentPdfRenderer`, real embedded fonts, and real poppler
rasterization — not a re-run of the unit suites (those already exist per
task and stay green; see the full sweep at the bottom).

---

## Carry-over from Task 5's self-review (mandatory per this task's brief)

Task 5's report (`.superpowers/sdd/2026-08-04-print-design-system-phase-a-plan/task-5-report.md`)
flagged: *"Not a pixel golden suite... If a pixel suite is actually wanted
for these blocks, that reads as its own follow-up task (naturally Task 10's
acceptance sweep...)."*

This sweep closes that gap. The "visual proof" describe block renders one
document exercising all seven new block types (`passage`, `figure`, `inset`,
`list`, `divider`, `spacer`, `page_break`) plus page furniture (footer band,
continuation strip, duplex gutter) across 3 pages, at both type-scale
presets (`standard`, `young`). Every page was rasterized with poppler
(`pdftoppm -r 150`) and **I looked at every one of the 6 rendered pages**
before pinning anything (screenshots below). The PDFs and every page PNG are
committed as reviewable evidence at
`docs/_wip/audits/2026-08-04-print-design-phase-a-acceptance/`; page 2 of
the standard render is additionally pinned as a real pixel-diff regression
snapshot inside the test file (0.5% whole-page tolerance, same model as
`tests/isolated/rendering/school/golden/`).

| File | What it shows |
|---|---|
| `proof-standard.pdf` / `proof-standard-p01..03.png` | worksheet archetype, `standard` type scale, flow policy, 3 pages |
| `proof-young.pdf` / `proof-young-p01..03.png` | same document, `young` type scale, 3 pages |

**Page-by-page contents (standard scale; young is the same content at the
larger type scale):**
- **p01** — title/name/date header; `passage` (reprint mode, line numbers 1–5,
  citation "*A Field Guide to Rivers*, by J. Rivers (p. 12)"); `figure`
  (placeholder artwork + `**bold**`-in-italic caption "See **Figure 1** for
  the full diagram." — this is what exercises the bold-italic font face,
  see §12.8 below — + italic credit); `inset` titled "Remember" containing a
  `list` (checklist, square markers, not glyphs); a second top-level `list`
  (numbered); a `divider` rule; a `spacer`; footer "Page 1 of 3" (no
  continuation strip — page 1 has the real header instead).
- **p02** — forced by `page_break`: a `rich_text` line mixing `**bold**` and
  `*italic*`, then 9 of 10 padding questions (numbered, ruled 30pt answer
  spaces); continuation strip ("phase-a-proof" title + "Name: Proof
  Learner") and footer "Page 2 of 3". **This is the pinned page.**
- **p03** — the 10th question; continuation strip + footer "Page 3 of 3".

I visually confirmed (viewed all three standard pages, young p01, and young
p02 directly): line numbers render correctly and stay 1:1 with wrapped
lines; the figure/caption/credit stack never separates; the inset box draws
a real rounded rectangle with checkbox squares (not fallback glyphs); the
numbered list, divider, and spacer read correctly; the continuation strip
and footer band both paint on pages 2–3 and are absent on page 1; bold and
italic render as distinct faces at both type scales; `young` prints visibly
larger with the same line-count-per-page reduction you'd expect. No defects
found.

Screenshots (page 2, the pinned regression snapshot) are viewable directly
at `docs/_wip/audits/2026-08-04-print-design-phase-a-acceptance/proof-standard-p02.png`.

---

## §12.1 — Determinism

> *identical (document rev, seed, variant, learner) renders byte-identical
> PDFs*

| Check | Result |
|---|---|
| v2 doc, same use-case instance, 2 runs | byte-identical ✅ |
| v2 doc, 2 **fresh** `RenderPrintDocument` instances | byte-identical ✅ (rules out shared mutable state / caching) |
| v1 (legacy) doc, same instance, 2 runs | byte-identical ✅ |

Tests 1–3 in the file's own describe `§12.1 determinism` (see full run below)
→ 3/3 passed.

**PASS.**

---

## §12.6 — Fit: the three-policy matrix + the receipt-target rejection

> *an overlong one-pager fails with an overset amount at compact density;
> `flow` paginates with correct footers and continuation strips; a short
> `fill` worksheet bottoms out its last page; `one-page` + `target: [receipt]`
> fails validation*

| Fixture | Result |
|---|---|
| `fit.policy: 'one-page'`, 12 fixed 30pt questions (overflows both densities) | rejects `FIT_OVERSET`, `details.oversetPt > 0` ✅ |
| `fit.policy: 'flow'`, 10 fixed questions → 2 pages | footer reads "Page 1 of 2" / "Page 2 of 2" (verified via real `pdftotext -layout` extraction, not a structural guess); continuation strip ("Name: Riley" a 2nd time, title "acceptance-fixture") appears only on page 2; `theme.furniture.footerBandPt`/`continuationStripPt` both > 0 and `contentBox` reserves them; extracted page text pinned via `toMatchSnapshot()` ✅ |
| `fit.policy: 'fill'`, one growable question (40–400pt answer space) | unfilled last fragment lands at `answerSpace.minPt`; filled lands at `answerSpace.maxPt`; `RenderPrintDocument` threads `growLastPage: true` into the real renderer call (spy-verified) ✅ |
| `fit.policy: 'one-page'` + `target: ['receipt']` | `validateAnyDocument` reports `"fit policy 'one-page' requires letter target"`; `RenderPrintDocument.execute` rejects `INVALID_DOCUMENT` before any measurement; same conflict reproduced for `'fill'` ✅ |

Tests in the file's own describe `§12.6 fit — the three-policy matrix...`
→ 11/11 passed.

**PASS.**

---

## §12.7 — Targets: block×target matrix fails at validation

> *a wordbank document with `target: [receipt]` fails at validation
> (block×target matrix), not render*

No `wordbank` block exists yet (Phase B). The Phase A equivalent is any
letter-only block (`math`, `plot`, `geometry`, `asset`, `question`,
`answer_space`, `omr_response`, or any of the 7 new blocks — all
letter-only per `BLOCK_TARGET_SUPPORT`, see `documentV2.mjs`) combined with
`target: ['receipt']`.

Fixture: `{ target: ['receipt'], blocks: [{ type: 'math', tex: '...' }] }`.

- `BLOCK_TARGET_SUPPORT.math` is `['letter']` (does not contain `'receipt'`).
- `validateAnyDocument` reports `"blocks[0]: block type 'math' does not
  support target 'receipt'"` at a dotted path.
- `RenderPrintDocument.execute` rejects `INVALID_DOCUMENT` with that same
  message — validation-only, never reaches measurement/render.

Tests in the file's own describe `§12.7 targets — a letter-only block...`
→ 3/3 passed.

**PASS.**

---

## §12.8 — Type

> *four font styles embed; `*italic*` renders; both type-scale presets and
> both densities produce distinct, snapshot-pinned output*

- **Four styles embedded:** a document mixing `**bold**`/`*italic*` rich
  text with a `figure` caption (`"See **Figure 1** for detail."` — bold
  nested inside the figure caption's italic base face) embeds all four
  PostScript names in the raw PDF bytes: `AtkinsonHyperlegible-Regular`,
  `-Bold`, `-Italic`, `-BoldItalic`. (Note: a bare `**bold**`/`*italic*` pair
  in plain `rich_text` never reaches the bold-italic face — `measure.mjs`'s
  `inlineRuns` only selects `boldItalic` for a bold span nested inside an
  already-italic base, i.e. figure/passage captions/credits/citations. This
  is why the fixture needs a figure, not just rich_text.)
- ***italic* v2 vs v1 inertness:** the same markdown
  (`"Mix **bold** and *emphasis* words."`) rendered through
  `RenderPrintDocument` on a v2 document embeds `AtkinsonHyperlegible-Italic`;
  rendered on a v1 (schema-less) document is byte-identical to calling the
  legacy renderer directly with no italic option, and the byte stream
  contains no `-Italic` face at all — the asterisks stay literal text.
- **Scale × density distinct, pinned output:** `createWorkbookTheme` at all
  4 combinations of `{standard, young} × {normal, compact}`, rendered
  directly through `createDocumentPdfRenderer` (bypassing the auto-density
  fit solver, so density is a controlled variable rather than an emergent
  one), produces 4 pairwise-distinct SHA-256 hashes, pinned via
  `toMatchSnapshot()`.

Tests in the file's own describe `§12.8 type`
→ 3/3 passed.

**PASS.**

---

## §12.10 — Archetype dial (Phase A "A-part" only)

> *the same body blocks render as a quiz (score box, tracked issue,
> all-scored-row-mapped) and as a worksheet (loose print, mixed OMR/write-on)
> purely by changing envelope fields*

**Scoping note (read before treating this as a partial fail):** §12.10 itself
is tagged `[A/B/C]` — a full-lifecycle item spanning all three phases. Only
the **envelope-only, Phase A slice** is in scope for this task, per the
brief: *"one body rendered under `archetype: quiz` (scoreBox header) vs
`archetype: worksheet` (no scoreBox) purely by envelope change — snapshot
both."*

I verified `document.header.scoreBox` (the validated envelope field) is
**not yet consumed anywhere in the renderer** — grepped
`DocumentPdfRenderer.mjs`/`measure.mjs`/`furniture.mjs` for `scoreBox`: zero
hits outside `documentV2.mjs` and its own test. A visible score box is
explicitly Phase B's "points/score box" (spec §13). So Phase A cannot (and
should not) render a score box that doesn't exist yet — doing so would be
fabricating scope. What Phase A DOES wire end-to-end, purely from the
`archetype` field, is:

1. **`header.scoreBox`** — `true` for `quiz`, `false` for `worksheet`,
   every other header field (`name`, `date`) identical between the two.
2. **`duplex`** — `RenderPrintDocument`'s `DUPLEX_ARCHETYPES` set makes
   `worksheet` alternate its gutter side by page parity (bound for a
   physical binder) while `quiz` keeps a fixed left gutter (simplex) — the
   one archetype-driven difference actually wired into the render pipeline
   today.

Fixture: the identical 10-question body, rendered once as `quiz` and once as
`worksheet` (`fit.policy: flow`, `standard` type scale) — both produce ≥2
pages (empirically 2), and the rendered bytes differ (`quizBytes.equals
(worksheetBytes) === false`) purely from the archetype field. Pinned via
`toMatchSnapshot()` (page counts + SHA-256 hashes for both archetypes).

Tests in the file's own describe `§12.10-A archetype dial...`
→ 2/2 passed.

**PASS (Phase A scope).** Full §12.10 (visible score box, tracked issue,
row-mapping) remains open for Phases B/C as spec'd.

---

## Full acceptance file run

```
npx vitest run backend/src/3_applications/school/documents/acceptance.phaseA.test.mjs
```
```
 Test Files  1 passed (1)
      Tests  26 passed (26)
```
Re-run 3 times (including once after regenerating the pinned snapshot) —
stable every time, confirming the pixel-diff snapshot isn't a same-run
self-compare fluke.

---

## Full Phase A regression sweep (legacy + new, zero snapshot drift)

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
 Test Files  25 passed (25)
      Tests  678 passed (678)
```
Includes the pixel-diff golden suite (`tests/isolated/rendering/school/golden/golden.test.mjs`,
comparing against its committed PNGs, untouched) and every pre-existing
structural/unit test across all 5 layers (domain, rendering, application,
adapter) plus the CLI.

**`git status` on every snapshot dir, before and after this sweep:**
```
$ git status --short
?? backend/src/3_applications/school/documents/__snapshots__/
?? backend/src/3_applications/school/documents/acceptance.phaseA.test.mjs
?? docs/_wip/audits/2026-08-04-print-design-phase-a-acceptance/
```
Only new files (this task's own test + its own new snapshot dir + the
evidence dir). Zero modification to any pre-existing snapshot file —
specifically checked `tests/isolated/rendering/school/golden/snapshots/`
and `backend/src/1_rendering/school/documents/__snapshots__/` (both empty
diffs).

---

## Pre-existing failures (NOT introduced by this work)

The following fail identically on this branch's HEAD (`0b5374cd8`) and at
the Phase A plan's merge-base (`54ef595f1`, pre-dating all 10 Phase A
tasks) — verified by checking out the merge-base into a scratch worktree and
re-running the exact same command:

```
npx vitest run cli/ \
  tests/isolated/application/school/schoolcalcPlatformConformance.test.mjs \
  tests/isolated/application/fitness/playlistSorter.test.mjs
```

| At `0b5374cd8` (this branch) | At `54ef595f1` (merge-base) |
|---|---|
| 10 files failed, 6 tests failed, 366 passed | 10 files failed, 6 tests failed, 347 passed |

Identical failure set both commits (only the passing count differs — this
branch added more passing tests elsewhere in `cli/`/`tests/isolated/`
unrelated to these failures):

- **`cli/backfill-media-durations.test.mjs`**, **`cli/midi-ingest/*.test.mjs`**
  (5 files: `enrichEntry`, `enrichIndex`, `harmonicClassify`, `ingestCore`,
  `loopMeta`) — `"No test suite found"`. These files are written for a
  different runner (Node's built-in `node:test`, per their internal
  `describe`/`it` imports) and vitest's collector finds zero vitest-shaped
  tests in them; not a code regression, a runner mismatch pre-dating this
  branch.
- **`tests/unit/suite/cli/newsreporter.cli.test.mjs`** — `"Do not import
  '@jest/globals' outside of the Jest test environment"`. Matches the known
  issue in project memory ("Dead vitest tests under backend/tests/unit/suite/
  — import vitest/jest, fail under the other runner").
- **`cli/lib/fitness/heal.test.mjs`** (2 tests) — `Set` iteration-order
  assertion (`[...removedOccupants].sort()` expected order literally
  swapped in the assertion vs. received) — a pre-existing test bug unrelated
  to `Set` semantics, nothing to do with print documents.
- **`tests/isolated/application/school/schoolcalcPlatformConformance.test.mjs`**
  (4 tests) — `SchoolCalcDevice` validation now requires
  `deviceId/label/platformId/catalogId/createdAt`, and the conformance
  fixture's enrollment payload doesn't supply all of them; unrelated
  SchoolCalc device domain, not print documents.
- **`tests/isolated/application/fitness/playlistSorter.test.mjs`** — 0 tests
  collected (same "no vitest-shaped suite" pattern as the CLI files above).

None of these touch `school/documents/` or `school/print-documents` in any
way; confirmed via `git log` that none of the 10 Phase A task commits
touched `SchoolCalcDevice.mjs`, `cli/lib/fitness/heal.mjs`, or any
`midi-ingest`/`backfill`/`playlistSorter` file.

---

## Summary

| Spec item | Result |
|---|---|
| §12.1 Determinism | PASS |
| §12.6 Fit (3-policy matrix + receipt rejection) | PASS |
| §12.7 Targets (block×target matrix) | PASS |
| §12.8 Type (4 fonts, italic, scale×density) | PASS |
| §12.10-A Archetype dial (envelope-only) | PASS (Phase A scope; visible score box explicitly deferred to Phase B) |
| Visual verification (Task 5 CARRY) | DONE — 6 real rendered pages reviewed, PDFs+PNGs committed, 1 page pinned as pixel-diff regression |
| Legacy suites (all 5 layers + CLI) | 678/678 passed, zero snapshot drift |
| Pre-existing failures | 10 files / 6 tests, identical at merge-base, unrelated to print documents |

No §12[A] item failed. No concerns beyond the scoping note on §12.10 (which
is intentional, spec-directed phasing, not a gap).
