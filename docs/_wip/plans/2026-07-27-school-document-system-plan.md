# School Curriculum Contract + Document System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement
> this plan task-by-task. Execute in a dedicated worktree on branch
> `feature/school-document-system` (create with superpowers:using-git-worktrees;
> symlink `node_modules` per the parallel-agent shared-checkout playbook).

**Goal:** Build the typed-block learning-document system and the published
curriculum contracts — the roadmap's delivery items 1–2 — validated by the
architecture spec's golden-test bar.

**Architecture:** Pure domain validation for units/documents/manifests
(`2_domains/school/`), a measure-then-place layout engine plus Letter-PDF and
thermal-receipt renderers (`1_rendering/school/documents/`), and a read-only
curriculum catalog port/adapter with a publish-time validation use case
(`3_applications/school/` + `1_adapters/persistence/yaml/`). Per the spec:
closed block set, deterministic seeds, no token minting or persistence inside
renderers. Spec: `docs/superpowers/specs/2026-07-27-school-physical-console-architecture.md`.
Spike recipe (MANDATORY, already verified):
`docs/_wip/plans/2026-07-27-school-math-rendering-spike-results.md`.

**Tech Stack:** Node 20 ESM (`.mjs`), pdfkit ^0.18, svg-to-pdfkit ^0.1.8,
`mathjax-full` ^3.2.2 (NEW dependency), vitest (`npx vitest run <path>`),
poppler `pdftoppm` for golden rasterization (dev-machine dependency; the golden
harness FAILS — not skips — when absent, per the no-vacuous-pass rule).

**Layer rules that bind every task** (from
`docs/reference/core/layers-of-abstraction/`): domain imports nothing but
`core`/`content`/`0_system/utils`; rendering imports only `0_system` + domain +
`1_rendering/lib`; ports live in `3_applications/school/ports/` and datastores
`extends` them; no FileIO in applications; composition wiring only in `app.mjs`.

---

## Phase A — Domain contracts (pure, TDD)

### Task A1: Document block model — closed set + per-block validation

**Files:**
- Create: `backend/src/2_domains/school/documents/blocks.mjs`
- Test: `tests/isolated/domain/school/documents/blocks.test.mjs`

**Step 1: Write failing tests** covering, at minimum:

```javascript
import { describe, it, expect } from 'vitest';
import { BLOCK_TYPES, validateBlock } from '#domains/school/documents/blocks.mjs';

describe('document blocks', () => {
  it('exposes the closed block-type set', () => {
    expect(BLOCK_TYPES).toEqual([
      'rich_text', 'math', 'plot', 'geometry', 'asset',
      'question', 'answer_space', 'omr_response',
      'media_action', 'scan_action',
    ]);
  });
  it('rejects unknown block types', () => {
    expect(validateBlock({ type: 'html' }).errors).toContain('unknown block type: html');
  });
  it('validates a math block requires non-empty tex', () => {
    expect(validateBlock({ type: 'math', tex: '' }).errors.length).toBeGreaterThan(0);
    expect(validateBlock({ type: 'math', tex: '\\frac{1}{2}', display: true }).errors).toEqual([]);
  });
  it('rejects \\require in tex (browser-only macro, spike finding)', () => {
    expect(validateBlock({ type: 'math', tex: '\\require{enclose} x' }).errors)
      .toContain('math tex must not use \\require{} (server rendering loads all packages)');
  });
  it('validates answer_space min/max height bounds', () => {
    expect(validateBlock({ type: 'answer_space', minPt: 40, maxPt: 20 }).errors.length).toBeGreaterThan(0);
  });
  it('validates omr_response requires itemId and choices count 2..8', () => {
    expect(validateBlock({ type: 'omr_response', itemId: 'q1', choices: 4 }).errors).toEqual([]);
    expect(validateBlock({ type: 'omr_response', choices: 1 }).errors.length).toBeGreaterThan(0);
  });
  it('validates question wraps a bank item ref and nested blocks', () => {
    const b = { type: 'question', itemId: 'q1', number: 1,
      blocks: [{ type: 'rich_text', md: 'What is $x$?' }, { type: 'answer_space', minPt: 40, maxPt: 120 }] };
    expect(validateBlock(b).errors).toEqual([]);
  });
});
```

**Step 2:** `npx vitest run tests/isolated/domain/school/documents/blocks.test.mjs` → FAIL (module not found).

**Step 3: Implement** `blocks.mjs`: export `BLOCK_TYPES` (frozen array exactly as
tested), `validateBlock(raw)` returning `{ errors: string[] }`. One internal
validator per type (plain functions in a map keyed by type — same shape as
`questionBankValidation.mjs`). Constraints: `rich_text.md` non-empty string
(constrained Markdown — validation only checks type/emptiness here);
`math.tex` non-empty, no `\require{`; `plot`/`geometry` accept a declarative
`spec` object with `kind` field (validated deeply in Task A2's follow-ups only
if needed — YAGNI: presence + object type now); `asset.ref` non-empty +
`alt` required; `question` requires `itemId`, `number`, non-empty nested
`blocks` recursively validated, and may not nest another `question`;
`answer_space` numeric `minPt <= maxPt`; `omr_response` requires `itemId`,
integer `choices` 2–8; `media_action`/`scan_action` require `action` string
and `label` (the printed instruction).

**Step 4:** Run test → PASS.
**Step 5:** `git add -A && git commit -m "feat(school): document block model with closed type set"`

### Task A2: Document validation — whole-document rules + deterministic seed

**Files:**
- Create: `backend/src/2_domains/school/documents/documentValidation.mjs`
- Test: `tests/isolated/domain/school/documents/documentValidation.test.mjs`

**Steps (same TDD rhythm):** failing tests → run → implement → run → commit.

`validateDocument(raw)` rules to test and implement:
- requires `id` (stable artifact base ID, `^[a-z0-9][a-z0-9-]*$`), integer
  `seed >= 0`, optional integer `variant >= 0` (default 0), `target` list
  subset of `['letter','receipt']`, non-empty `blocks[]`, every block valid
  (delegating to `validateBlock`, errors prefixed `blocks[i]:`).
- every `question.itemId` unique within the document.
- an `omr_response` block must sit inside a `question` block.
- answer-key separation is structural: blocks never carry answers — reject a
  document containing an `answer` or `answers` key anywhere (walk the tree);
  keys render from the bank, not the document.

Commit: `feat(school): whole-document validation with seed/variant contract`

### Task A3: Media manifest validation

**Files:**
- Create: `backend/src/2_domains/school/curriculum/manifestValidation.mjs`
- Test: `tests/isolated/domain/school/curriculum/manifestValidation.test.mjs`

`validateManifest(raw)`: requires `id`, `locator` (`plex:<digits>` for now —
one regex, table-driven for future kinds), and durable metadata `title` plus at
least one of `series`/`aliases`; optional `durationSec` positive integer;
`provenance` object required (free-form). Reject a manifest whose only identity
is the locator (that is the anti-goal from spec §3.2).

Commit: `feat(school): media manifest contract validation`

### Task A4: Curriculum unit validation with cross-reference resolution

**Files:**
- Create: `backend/src/2_domains/school/curriculum/unitValidation.mjs`
- Test: `tests/isolated/domain/school/curriculum/unitValidation.test.mjs`

`validateUnit(raw, { bankIds, documentIds, manifestIds })` — pure; reference
sets injected as `Set`s. Rules to test:
- identity: `unitId` (`^[a-z0-9][a-z0-9.-]*$`), `title` non-empty.
- pedagogy: `subject` must be one of the nine subject-wall ids (import the
  existing frontend list? NO — frontend is not importable; declare
  `SUBJECT_IDS` here and add a follow-up note to converge with
  `frontend/src/modules/School/home/subjects.js` at the API seam).
- placement: if `courseId` present then integer `sequence >= 1`; gate policy is
  implied by course membership only (no `gate:` field exists — spec rule
  "only sequential courses gate").
- policy: `passing` (`{ percent: 1..100 }`, default 80), optional `reward`
  (`{ amount > 0, requiresSignoff: boolean }`), optional `retry`
  (`{ variants: int >= 1 }`).
- composition: each of `bank`/`document`/`media`/`review` optional, but at
  least one present; every reference must resolve against the injected sets —
  a dangling ref is an error naming the ref (`document 'math-3.4-ws' not found`).
- `provenance` object with `source` and `reviewState` in
  `['draft','approved']` required; runtime callers may additionally require
  `approved` (the promotion boundary) — expose
  `isPublishable(unit)` helper returning false unless `reviewState === 'approved'`.

Commit: `feat(school): curriculum unit contract with cross-ref resolution`

---

## Phase B — Rendering foundation

### Task B1: Add mathjax-full dependency

**Files:** Modify: `package.json` (backend deps section — check whether the
backend has its own `node_modules` per the notification-stack memory; add where
`pdfkit` currently lives).

Steps: `npm install mathjax-full@^3.2.2` at repo root (same tree as pdfkit);
run an existing school isolated suite to confirm nothing broke
(`npx vitest run tests/isolated/domain/school/`); commit
`chore: add mathjax-full for school document math rendering`.

### Task B2: Math SVG module — the spike recipe, productionized

**Files:**
- Create: `backend/src/1_rendering/school/documents/mathSvg.mjs`
- Test: `tests/isolated/rendering/school/mathSvg.test.mjs`

**Implementation is the spike-verified recipe** (copy from the spike results
doc): singleton MathJax document (TeX + SVG, `fontCache:'none'`, AllPackages),
`texToSvg(tex, { display, fontSizePt, ink })` returning
`{ svgString, widthPt, heightPt, depthPt }` with the THREE MANDATORY
normalization rules (viewBox sizing, style→attribute stroke-width promotion,
currentColor replacement) plus `depthPt = ((vbY + vbH) / 1000) * fontSizePt`.
Throws `MathRenderError` (new, in the module) when MathJax emits
`data-mjx-error`/`merror` — a bad TeX string must fail loudly at validation
time, not print a red literal.

Tests: dimensions positive and viewBox-derived (assert `widthPt` ≈
`vbW/1000*12` for a known simple input by parsing the returned svgString's
viewBox); no `width="…ex"` attribute in output; no `style="stroke-width` in
output for `24 \enclose{longdiv}{3768}` but a `stroke-width="67"` attribute
present; no `currentColor` anywhere; `\require{enclose} x` throws; garbage TeX
(`\frac{`) throws.

Commit: `feat(school): MathJax SVG renderer with svg-to-pdfkit normalization`

### Task B3: Layout engine — fragments, measurement interface, placement

**Files:**
- Create: `backend/src/1_rendering/school/documents/layout.mjs`
- Test: `tests/isolated/rendering/school/layout.test.mjs`

Pure functions, no pdfkit import — measurement arrives as data so the engine is
unit-testable without a PDF context (this is the spec's "layout constraint math"
that stays pure even though it lives in the rendering layer).

Contract (write tests first for each):

```javascript
// A fragment: { blocks: [...], heightPt, atomic: true|false, spacingClass: 'heading'|'body'|'question' }
// placeFragments(fragments, { pageHeightPt, marginPt, spacing }) →
//   { pages: [{ fragments: [{...fragment, yPt}] }], errors: [] }
```

Rules under test:
1. **Keep-together:** an `atomic` fragment taller than remaining page space
   moves whole to the next page; an atomic taller than a FULL page returns an
   error (`atomic fragment 'q3' exceeds page height`) — placement never
   silently splits it.
2. **Spacing classes, not accumulation:** inter-fragment gap =
   `spacing[prev.class][next.class]` lookup table passed in; assert two
   different class pairs give the configured different gaps.
3. **Widow/orphan for flowable rich_text fragments:** a flowable fragment
   carries `lines: [{heightPt}]` and `minLinesBefore/AfterBreak` (default 2);
   a break may not leave fewer than that on either side — test a 5-line
   paragraph near a page end splits 3+2, never 4+1.
4. **Answer-space distribution:** after placement, trailing free space on each
   non-final page distributes into that page's `answer_space` fragments up to
   each one's `maxPt`; assert exact arithmetic on a crafted page.
5. Deterministic: same input → identical output (run twice, deep-equal).

Commit: `feat(school): measured layout engine (keep-together, widow/orphan, spacing, answer-space distribution)`

### Task B4: Block measurers — bridge blocks to fragments using pdfkit metrics

**Files:**
- Create: `backend/src/1_rendering/school/documents/measure.mjs`
- Create: `backend/src/1_rendering/school/documents/documentPdfTheme.mjs`
- Test: `tests/isolated/rendering/school/measure.test.mjs`

`measureBlocks(blocks, { doc, theme, texToSvg })` → fragments for `layout.mjs`.
Uses a real `PDFDocument` instance (never added to any file — measurement only:
`doc.font(...).heightOfString(...)`, `widthOfString`). Theme file per the
rendering guidelines: semantic styles (`heading`, `body`, `question`,
`instruction`), font family/sizes/leading, spacing-class table, page metrics
(LETTER, 54pt margins), all constants there — no magic numbers in code.
`question` blocks produce ONE atomic fragment from their nested blocks. `math`
display blocks measure via `texToSvg` (injected — tests pass a stub, no
MathJax needed). Rich text: constrained Markdown subset — split paragraphs,
measure line-by-line into `lines[]` for widow/orphan support; inline
`$...$` math is measured as same-line spans at this stage ONLY if trivially
implementable via width arithmetic — otherwise render inline math as display
for v1 and record the deferral in the plan-completion notes (YAGNI, the
worksheet corpus is display-dominant).

Commit: `feat(school): block measurers and document PDF theme`

### Task B5: Letter PDF renderer — draw pass + artifact output

**Files:**
- Create: `backend/src/1_rendering/school/documents/DocumentPdfRenderer.mjs`
- Test: `tests/isolated/rendering/school/documentPdfRenderer.test.mjs`

`createDocumentPdfRenderer({ theme, texToSvg })` → `{ render(documentData, { answers }) }`
returning `{ pdf: Buffer, pageCount, formMap }`. Draw pass walks placed pages:
text via pdfkit, math via `SVGtoPDF(doc, svgString, x, y, {width, height, assumePt:true})`,
`answer_space` as ruled lines at theme line pitch, `omr_response` as bubble
rows (vector circles + letter labels) whose exact centers/radii are recorded
into `formMap: { formVersion, marks: [{ itemId, choice, xPt, yPt, rPt, page }] }`,
`media_action`/`scan_action` as a labeled box with a placeholder code area
(QR integration is a later task — draw the reserved rect + token text for
now), `asset` via SVGtoPDF for `.svg` refs (resolver callback injected).
Answer keys: `render(doc, { answers })` renders a SEPARATE document with the
key content appended per question — never mixed into the learner copy.

Tests (structural, no pixels yet): pageCount > 0; formMap mark count ==
choices × omr items; every mark within page bounds minus margins; renders the
stress document from the spike corpus without throwing; determinism — same
input twice → byte-identical PDF buffers EXCEPT pdfkit's /CreationDate — pass
`{ info: { CreationDate: new Date(0) } }`-style pinning or strip the field
before comparing (verify pdfkit accepts a fixed date option; if not, normalize
both buffers with a regex on `/CreationDate`).

Commit: `feat(school): Letter PDF document renderer with numeric form map`

### Task B6: Golden page harness + stress corpus

**Files:**
- Create: `tests/isolated/rendering/school/golden/corpus/stress-math.document.yml`
  (the spike's 12 cases as `math` blocks + rich_text + questions + answer
  spaces + one omr_response question — a real worksheet shape)
- Create: `tests/isolated/rendering/school/golden/goldenHarness.mjs`
- Create: `tests/isolated/rendering/school/golden/golden.test.mjs`
- Create: `tests/isolated/rendering/school/golden/snapshots/` (generated PNGs, committed)

Harness: render document → `pdftoppm -png -r 150` into a temp dir (use
`node:child_process.execFile`; if `pdftoppm` is missing, `throw` — the test
FAILS with an actionable message, never skips) → compare page PNGs to committed
snapshots pixel-by-pixel (read PNGs with the repo's existing `canvas` dep;
fail if >0.5% pixels differ; write a `*.diff.png` beside the failure).
`UPDATE_GOLDEN=1 npx vitest run …` regenerates snapshots.
Also assert the formMap NUMERICALLY against a committed
`stress-math.formmap.json` (exact values, no tolerance) — the OMR contract.

Commit: `test(school): golden page harness + stress corpus snapshots`

### Task B7: Thermal receipt renderer (minimal viable target)

**Files:**
- Create: `backend/src/1_rendering/school/documents/DocumentReceiptRenderer.mjs`
- Create: `backend/src/1_rendering/school/documents/documentReceiptTheme.mjs`
- Test: `tests/isolated/rendering/school/documentReceiptRenderer.test.mjs`

Follows the existing thermal pattern (canvas PNG like
`FitnessReceiptRenderer`; register Roboto Condensed via `CanvasFactory`).
Subset of blocks meaningful on paper tape: `rich_text`, `scan_action`
(barcode/QR placeholder rect + code text for now), `media_action`, simple
`math` (rasterize the MathJax SVG onto the canvas at 2× for tape legibility —
receipts are the one target where raster is acceptable; the no-rasterize rule
binds the PDF path). Single column, keep-together only (no pages — cut
points), width from `documentReceiptTheme`. Reject (throw) on `omr_response`
(never valid on tape). Structural tests only; receipt goldens can join B6's
harness later if churn appears.

Commit: `feat(school): thermal receipt document renderer`

---

## Phase C — Catalog seam

### Task C1: Curriculum catalog port + YAML datastore

**Files:**
- Create: `backend/src/3_applications/school/ports/ICurriculumCatalog.mjs`
  (`listUnits()`, `getUnit(unitId)`, `listDocuments()`, `getDocument(id)`,
  `listManifests()`, `getManifest(id)` — all return raw parsed YAML)
- Create: `backend/src/1_adapters/persistence/yaml/YamlCurriculumDatastore.mjs`
  (`extends ICurriculumCatalog`, D7) reading
  `<dataDir>/content/school/curriculum/{units,documents,manifests}/*.yml`
- Test: `tests/isolated/adapter/school/yamlCurriculumDatastore.test.mjs`
  (temp-dir fixtures; malformed YAML in one file → that entry reported in an
  `errors` side-channel, siblings still load — one bad unit never blanks the catalog)

Commit: `feat(school): curriculum catalog port + YAML datastore`

### Task C2: ValidateCatalog use case (the promotion gate)

**Files:**
- Create: `backend/src/3_applications/school/usecases/ValidateCatalog.mjs`
- Test: `tests/isolated/application/school/validateCatalog.test.mjs` (fake catalog)

Constructor `{ catalog, bankIds }` (bank ID set injected — supplier is
composition, not this class). `execute()` loads everything, runs the three
domain validators with resolved reference sets, additionally render-probes
every document that declares `target: letter` through the measure pass with a
stub texToSvg replaced by the real one ONLY when `{ renderProbe: true }`
(D2 allows the rendering import; keep it injected as `measureProbe` callback
for testability), and returns
`{ ok, unitErrors: {…}, documentErrors: {…}, manifestErrors: {…} }`.
Nothing writes; nothing mutates. This is what CI/the ingestion pipeline calls
before promoting drafts.

Commit: `feat(school): ValidateCatalog promotion gate`

### Task C3: CLI entry for catalog validation

**Files:**
- Create: `cli/school-catalog.cli.mjs` (`node cli/school-catalog.cli.mjs validate`)
- Test: manual run documented in the file header (CLI shells are thin; the
  use case already has isolated coverage)

Wire ConfigService dataDir + real bank listing (reuse
`YamlSchoolDatastore.readAllBankRaws` summary path for IDs). Exit 1 on any
error with a readable per-file report. Commit:
`feat(school): catalog validation CLI`

### Task C4: Sample catalog — the anchor math unit, hand-authored

**Files:**
- Create (data, in repo as fixtures AND copied to the live data tree when
  deploying): `tests/_fixtures/school/curriculum/units/math-fractions-01.yml`,
  `documents/math-fractions-01-ws.yml`, plus a matching minimal bank fixture.

The anchor unit from the spec (A2): a fractions worksheet with rich_text
instructions, 6 question blocks (2 with display math, 1 with an
omr_response, 3 with answer_space), one scan_action footer. Must pass
`ValidateCatalog` and render through both targets in a final integration test:
`tests/isolated/application/school/anchorUnit.integration.test.mjs` (fake
catalog pointed at the fixtures; assert ok + pageCount + formMap present).

Commit: `feat(school): anchor math unit fixtures + end-to-end validation test`

---

## Completion gate

1. `npx vitest run tests/isolated/domain/school tests/isolated/rendering/school tests/isolated/application/school tests/isolated/adapter/school` — all green, zero skips.
2. Golden snapshots committed; `UPDATE_GOLDEN` workflow documented in harness header.
3. `node cli/school-catalog.cli.mjs validate` clean against the fixture catalog.
4. Print one rendered fixture worksheet on the kitchen laser printer (manual,
   physical acceptance — REQUIRED before merging; use the existing
   `/api/v1/school/print` path manually or a throwaway script, do not wire new
   API routes in this slice).
5. Update `docs/reference/school/README.md` (new "Document system" section:
   built pieces, layer table rows, the three SVG rules) and mark delivery
   item 2 progress in the roadmap.
6. Merge per superpowers:finishing-a-development-branch (merge to main directly,
   delete branch, log in `docs/_archive/deleted-branches.md`).

**Explicitly out of scope (spec keeps them in later slices):** work sessions,
token minting/QR generation (B5/B7 draw placeholder code areas only), OMR scan
ingestion, planner/agenda content, Admin surface, any new HTTP routes.
