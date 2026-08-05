# Print Design System — Phase A ("the page") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/_wip/plans/2026-08-04-print-design-system-requirements.md` (rev 2). Phase A scope is §13 "Phase A — the page"; acceptance items §12.1, §12.6, §12.7, §12.8, §12.10(A-part). Read the spec before any task.

**Goal:** Envelope v2 with v1 passthrough, the workbook theme (Atkinson Hyperlegible, two type scales × two densities), fit policies (`flow`/`one-page`/`fill`) with page furniture, seven new content blocks, the block×target matrix, and a `school:docs validate|render` CLI — no banks, no cards (Phases B/C).

**Architecture:** The existing engine stays: `measure.mjs` produces typed nodes, `layout.mjs` places measured fragments, `DocumentPdfRenderer` draws nodes — all theme-parameterized already. Phase A adds a *parallel theme* (`workbookTheme`) used only by the v2 pipeline, so **existing v1 documents, the legacy `documentPdfTheme`, and every existing golden snapshot stay byte-identical**. New blocks join the closed registry; the v2 envelope validator wraps the shared core; `fill`'s last-page growth and `one-page`'s density fallback are options threaded through the pure layout layer.

**Tech Stack:** Node ESM (`.mjs`), vitest from repo root (`npx vitest run <path>` — node_modules present in this worktree), pdfkit (embedded TTFs, CreationDate-neutralized goldens per the existing pattern), js-yaml.

## Global Constraints (from spec rev 2)

- **v1 documents unchanged:** a document without a `schema` field validates and renders through the existing path with byte-identical output; every pre-existing golden snapshot must remain green untouched.
- **Envelope v2** (§4): `schema: 'school.document/v2'` literal; `id` (existing pattern `^[a-z0-9][a-z0-9-]*$` — NOT `documentId`); `seed` required countable; `variant` non-negative integer default 0; `target` array of `letter|receipt`; new `archetype: quiz|worksheet|infopage`, `header`, `fit {policy: flow|one-page|fill, typeScale: standard|young}`, `defaultPoints` (number ≥0), `source` sugar → `scan_action`.
- **Answers ban stands:** `collectAnswerKeys` runs on v2 documents exactly as on v1 (Phase A documents carry no answers anyway; the source-stage relaxation is Phase B).
- **Block×target matrix** (§4.1/§7): checked in v2 validation only; `one-page`/`fill` + `target` containing `receipt` = validation error.
- **Fit** (§7): `one-page` tries normal density then compact (two discrete, fully measured), then fails with the overset amount **at compact**; `fill` enables last-page growth (inverting the existing `growAnswerSpaces` last-page exclusion) **iff** `policy: fill`.
- **Theme** (§8): Atkinson Hyperlegible, 4 styles, OFL, embedded; `*italic*` inline span is enabled ONLY for the v2 pipeline (an option, default off, so v1 measurement never changes); tokens for footer band, continuation strip, gutter margin, badge geometry; pure black + one grayscale tint.
- **Page furniture** (§7): `page x of y` footer; continuation strip (title + name line) on pages 2+; optional gutter margin; duplex-aware placement for worksheets.
- **Determinism:** same inputs ⇒ byte-identical PDF, using the existing CreationDate-fixing pattern from the current golden tests (find it in the existing `DocumentPdfRenderer`/QRSheet test files and reuse it exactly).
- No subject vocabulary in framework code. Commit after every task; end commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File Structure

```
backend/assets/fonts/atkinson-hyperlegible/     # Task 1 — four TTFs (OFL license file included)
backend/src/1_rendering/school/documents/
  workbookTheme.mjs                             # Task 1 — createWorkbookTheme({typeScale, density})
  furniture.mjs                                 # Task 6 — footer/continuation-strip/gutter drawing
backend/src/2_domains/school/documents/
  documentV2.mjs                                # Task 2 — v2 envelope validation + dispatch + target matrix (Task 3)
  blocks.mjs                                    # Task 4 — modify: register 7 new block validators
backend/src/1_rendering/school/documents/
  measure.mjs                                   # Task 5 — modify: measure cases for new blocks + italic option
  DocumentPdfRenderer.mjs                       # Task 5/6 — modify: draw cases + furniture hook
  layout.mjs                                    # Task 7 — modify: growLastPage option
backend/src/3_applications/school/documents/
  RenderPrintDocument.mjs                       # Task 8 — v2 render use case (fit orchestration)
backend/src/1_adapters/school/documents/
  YamlPrintDocumentRepository.mjs               # Task 8 — content/school/print-documents/*.yml
cli/school-docs.cli.mjs                         # Task 9 — validate|render (+ package.json script)
```

Rollout is bottom-up; every task leaves `npx vitest run backend/src/2_domains/school/documents/ backend/src/1_rendering/school/documents/` green including the pre-existing goldens.

---

### Task 1: Atkinson Hyperlegible + `workbookTheme`

**Files:**
- Create: `backend/assets/fonts/atkinson-hyperlegible/` (AtkinsonHyperlegible-Regular.ttf, -Bold.ttf, -Italic.ttf, -BoldItalic.ttf + OFL.txt)
- Create: `backend/src/1_rendering/school/documents/workbookTheme.mjs`
- Test: `backend/src/1_rendering/school/documents/workbookTheme.test.mjs`

**Interfaces:**
- Consumes: the structural contract of `documentPdfTheme.mjs` (READ IT FIRST — page/ink/fonts/styles/spacing shape, `spacingClass` + `leading` conventions) and `registerDocumentFonts(doc, {theme, fontDir})` in `measure.mjs:98` which reads `theme.fonts` entries `{name, file}`.
- Produces: `createWorkbookTheme({typeScale = 'standard', density = 'normal'} = {})` → frozen theme object structurally compatible with `documentPdfTheme` (same key families: `page`, `ink`, `fonts`, `styles`, `spacing`) PLUS `fonts.italic`/`fonts.boldItalic`, and new token groups `furniture` (`footerBandPt`, `continuationStripPt`, `gutterPt` default 0), `badge` (glyph circle geometry for later phases), `box` (inset radius/padding). Also `WORKBOOK_TYPE_SCALES = ['standard','young']`, `WORKBOOK_DENSITIES = ['normal','compact']`. Font aliases must be distinct from the legacy theme's (`workbook-regular` etc.) so both register in one process.
- Font acquisition: download the four TTFs from the official Atkinson Hyperlegible source (Braille Institute's GitHub release or Google Fonts github repo — `curl -L` the raw TTFs); commit them with `OFL.txt`. If network access fails, STOP and report BLOCKED (do not substitute a different font).

- [ ] **Step 1: Write the failing test**

```js
// backend/src/1_rendering/school/documents/workbookTheme.test.mjs
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkbookTheme, WORKBOOK_TYPE_SCALES, WORKBOOK_DENSITIES } from './workbookTheme.mjs';
import { createMeasurementDocument } from './measure.mjs';

const FONT_DIR = fileURLToPath(new URL('../../../../assets/fonts', import.meta.url));

describe('workbookTheme', () => {
  it('ships all four Atkinson Hyperlegible faces plus the OFL license', () => {
    const dir = path.join(FONT_DIR, 'atkinson-hyperlegible');
    for (const file of ['AtkinsonHyperlegible-Regular.ttf', 'AtkinsonHyperlegible-Bold.ttf',
      'AtkinsonHyperlegible-Italic.ttf', 'AtkinsonHyperlegible-BoldItalic.ttf', 'OFL.txt']) {
      expect(fs.existsSync(path.join(dir, file)), file).toBe(true);
    }
  });

  it('produces a structurally theme-compatible frozen object with four font styles', () => {
    const theme = createWorkbookTheme();
    expect(Object.isFrozen(theme)).toBe(true);
    for (const key of ['page', 'ink', 'fonts', 'styles', 'spacing', 'furniture']) expect(theme[key], key).toBeDefined();
    for (const style of ['regular', 'bold', 'italic', 'boldItalic']) {
      expect(theme.fonts[style]?.name, style).toMatch(/^workbook-/);
      expect(theme.fonts[style]?.file).toMatch(/^atkinson-hyperlegible\//);
    }
    expect(theme.page.widthPt).toBe(612); // US Letter stays
  });

  it('registers its fonts in a real pdfkit measurement document', () => {
    const doc = createMeasurementDocument({ theme: createWorkbookTheme() });
    expect(() => doc.font('workbook-italic')).not.toThrow();
  });

  it('young scale is larger than standard; compact density is tighter than normal', () => {
    const std = createWorkbookTheme({ typeScale: 'standard', density: 'normal' });
    const young = createWorkbookTheme({ typeScale: 'young', density: 'normal' });
    const compact = createWorkbookTheme({ typeScale: 'standard', density: 'compact' });
    expect(young.styles.body.size).toBeGreaterThan(std.styles.body.size);
    expect(young.styles.body.leading).toBeGreaterThan(std.styles.body.leading);
    const someGap = (t) => Object.values(t.spacing)[0];
    expect(JSON.stringify(compact.spacing)).not.toBe(JSON.stringify(std.spacing));
    expect(someGap(compact)).toBeDefined();
  });

  it('rejects unknown presets', () => {
    expect(() => createWorkbookTheme({ typeScale: 'giant' })).toThrow(/typeScale/);
    expect(() => createWorkbookTheme({ density: 'sardine' })).toThrow(/density/);
  });

  it('leaves the legacy theme and its goldens alone', async () => {
    const { documentPdfTheme } = await import('./documentPdfTheme.mjs');
    expect(documentPdfTheme.fonts.regular.file).toMatch(/roboto-condensed/);
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npx vitest run backend/src/1_rendering/school/documents/workbookTheme.test.mjs`.
- [ ] **Step 3: Download fonts** (curl into the assets dir; verify each file is a real TTF: `file *.ttf` shows TrueType, sizes > 30KB) **and implement** `workbookTheme.mjs` (~150 lines): mirror `documentPdfTheme`'s style/spacing structure; four styles per scale (body/heading1-3/label/caption at minimum, each `{font, size, leading, spacingClass}`); density varies the spacing table, scale varies sizes+leading; validate preset args; freeze deeply.
- [ ] **Step 4: Run to verify PASS**, then run the whole rendering folder to prove no legacy impact: `npx vitest run backend/src/1_rendering/school/documents/` — pre-existing goldens must be green untouched.
- [ ] **Step 5: Commit** — `git add backend/assets/fonts/atkinson-hyperlegible backend/src/1_rendering/school/documents/ && git commit -m "feat(school-print): Atkinson Hyperlegible + workbookTheme (scales × densities)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 2: Envelope v2 validation + dispatch

**Files:**
- Create: `backend/src/2_domains/school/documents/documentV2.mjs`
- Test: `backend/src/2_domains/school/documents/documentV2.test.mjs`

**Interfaces:**
- Consumes (READ FIRST): `documentValidation.mjs` — `validateDocument(raw)` (the v1 gate, returns `{errors, document?}` with normalized `{id, seed, variant, target, blocks, title?}`), `walkBlocks`, `collectAnswerKeys` behavior; `validateBlock` from `blocks.mjs`.
- Produces:
  - `DOCUMENT_V2_SCHEMA = 'school.document/v2'`; `ARCHETYPES = ['quiz','worksheet','infopage']`; `FIT_POLICIES = ['flow','one-page','fill']`.
  - `validateDocumentV2(raw)` → `{errors, document?}` where the normalized document extends the v1 shape with `{schema, archetype, header, fit: {policy, typeScale}, defaultPoints}` — archetype presets applied (quiz ⇒ `header: {name:true,date:true,scoreBox:true}`, worksheet ⇒ `{name:true,date:true,scoreBox:false}`, infopage ⇒ all false; explicit `header` fields override), `fit` defaults `{policy:'flow', typeScale:'standard'}`, `defaultPoints` default 1; envelope `source: {action,label}` desugared into a prepended `scan_action` block (exactly one canonical form — the normalized document has no `source` field).
  - `validateAnyDocument(raw)` → dispatch: `raw.schema === DOCUMENT_V2_SCHEMA` → v2; `raw.schema === undefined` → the existing `validateDocument` untouched; any other schema value → error `unknown document schema`.
  - Reuses the v1 core checks by CALLING `validateDocument` on the v1-shaped subset (id/seed/variant/target/blocks/title) rather than duplicating them — one validator core (spec §2).
- v2 additionally rejects: unknown archetype/policy/typeScale; non-boolean header flags; non-string header.instructions; `defaultPoints` not a number ≥ 0; `fit.policy` of `one-page`/`fill` combined with `target` containing `receipt` (spec §7 — validation error, exact message `fit policy '<p>' requires letter target`).

- [ ] **Step 1: Failing tests** — cover: minimal valid v2 quiz (defaults applied, frozen-ish normalized output asserted field-by-field); v1 passthrough (a schema-less document validates identically to calling `validateDocument` directly — assert deep-equal results); unknown schema error; archetype preset + override; `source` desugar (normalized `blocks[0].type === 'scan_action'`, envelope field absent); each rejection case incl. `one-page`+receipt; answers still banned (a v2 doc with `answer` on a node fails with the existing message).
- [ ] **Step 2: FAIL → Step 3: implement (~120 lines) → Step 4: PASS**, plus `npx vitest run backend/src/2_domains/school/documents/` all green.
- [ ] **Step 5: Commit** — `feat(school-print): document envelope v2 with v1 passthrough and archetype presets`.

---

### Task 3: Block×target matrix

**Files:**
- Modify: `backend/src/2_domains/school/documents/documentV2.mjs` (+ its test)

**Interfaces:**
- Produces: `BLOCK_TARGET_SUPPORT` — frozen map blockType → Set of targets. Seed values: everything currently renderable on receipt per `DocumentEscPosRenderer` (READ IT — it throws "block type '…' has no receipt rendering" for unsupported; enumerate what it DOES support) keeps `letter+receipt`; every Task 4 block is `letter`-only initially. `validateDocumentV2` walks blocks (via `walkBlocks`) and errors `blocks[i]: block type '<t>' does not support target '<x>'` for any block×target miss. Exported so Task 4 registers its new types here in the same change that adds them.
- [ ] **Steps:** failing test (a v2 doc with target `[letter,receipt]` and a letter-only block fails naming the block path and target; letter-only doc passes) → implement → PASS → commit `feat(school-print): block-target compatibility matrix in v2 validation`.

---

### Task 4: Seven content-block validators (domain)

**Files:**
- Modify: `backend/src/2_domains/school/documents/blocks.mjs` (register in `VALIDATORS`), `documentV2.mjs` (extend `BLOCK_TARGET_SUPPORT`)
- Test: extend `backend/src/2_domains/school/documents/blocks.test.mjs` (READ the existing test file's per-block pattern first and match it)

**Interfaces (spec §6.2):** new `VALIDATORS` entries, all letter-only in the matrix:
- `passage`: `{text (non-empty string, markdown), source?: {title (req non-empty), author?, locator?}, mode: 'reprint'|'cite' (default reprint), lineNumbers?: boolean}`.
- `figure`: `{asset (non-empty string id), caption (non-empty), credit?}`.
- `inset`: `{title?, blocks (non-empty array)}` — children validated recursively via `validateBlock`; children may not be `inset` (one level deep, exact error `inset blocks must not nest insets`).
- `list`: `{style: 'bullet'|'numbered'|'checklist', items: non-empty array of non-empty strings}`.
- `divider`: `{}` (no fields; unknown fields rejected if the existing validator convention rejects extras — MATCH the existing convention, check how current validators treat unknown fields and do likewise).
- `spacer`: `{minPt (positive number), maxPt (≥ minPt)}` — mirrors `answer_space`'s shape convention.
- `page_break`: `{}`.
- REQUIRE_MACRO ban applies to `passage.text` (it reaches the math-capable rich-text path).
- [ ] **Steps:** failing tests per block (valid + each invalid field, dotted paths) → implement → PASS (`npx vitest run backend/src/2_domains/school/documents/`) → commit `feat(school-print): passage, figure, inset, list, divider, spacer, page_break validators`.

---

### Task 5: Measure + draw for the new blocks (+ italic option)

**Files:**
- Modify: `backend/src/1_rendering/school/documents/measure.mjs`, `DocumentPdfRenderer.mjs`
- Test: `backend/src/1_rendering/school/documents/workbookBlocks.render.test.mjs` (new; golden snapshots for the new blocks under `workbookTheme` — follow the existing golden pattern in this directory's tests EXACTLY, including the CreationDate neutralization)

**Interfaces:**
- READ FIRST: `measure.mjs` (`measureBlocks` switch, typed-node shapes, `parseRichText`), `DocumentPdfRenderer.mjs` (node-kind draw switch ~line 344, how `render(source, options)` flows), one existing golden test file for the snapshot mechanics.
- Measurement: new cases producing existing node kinds where possible (`text` nodes for passage/list; `asset` node for figure + a `text` caption node) and new node kinds where needed (`inset` → a box node wrapping child nodes with padding from `theme.box`; `divider` → rule node; `spacer` → elastic node reusing the `answerSpace` fragment mechanics `{minPt,maxPt}` WITHOUT ruled lines — check how answer_space fragments carry `answerSpace` and mirror it; `page_break` → a fragment flagged `forceBreak` consumed by layout in Task 7). Passage: optional line numbers in the left margin (small muted labels), keep-with-next affinity `minLinesAfterBreak` per spec §7 atomics; `mode: cite` renders the citation line only (no body reprint) — cite mode emits the source line styled `caption`.
- `parseRichText` gains `*italic*` and `**bold**`-vs-`*italic*` disambiguation ONLY when called with `{italic: true}` (new option threaded from v2 measurement; default false so v1 measurement/goldens are untouched — assert that in the test by measuring the same markdown with and without the option).
- Draw: implement the new node kinds in the renderer's switch; inset draws a rounded box (radius from `theme.box.radius`) behind its children; figure draws asset + caption + optional credit (muted, caption style).
- [ ] **Steps:** failing render tests (one snapshot per block, rendered via the existing renderer entry with `theme: createWorkbookTheme()`; plus the italic on/off measurement assertion; plus `npx vitest run backend/src/1_rendering/school/documents/` proving legacy goldens untouched) → implement → PASS → commit `feat(school-print): measure+draw for content blocks, v2 italic span`.

---

### Task 6: Page furniture

**Files:**
- Create: `backend/src/1_rendering/school/documents/furniture.mjs`
- Modify: `DocumentPdfRenderer.mjs` (furniture hook), `workbookTheme.mjs` (tokens if missing)
- Test: `backend/src/1_rendering/school/documents/furniture.test.mjs` (+ snapshot)

**Interfaces:**
- Produces: `drawFurniture(doc, {theme, page, pageCount, title, nameLine, duplex, gutter})` called once per page after placement: page-x-of-y footer (skip on receipt target — furniture is letter-only); continuation strip (title + "Name ____" line) on pages ≥ 2; gutter margin applied as an x-offset for odd/even pages when `duplex` (worksheet default) else fixed side. Page content area must account for footer band + gutter — that means `measure`/`place` receive an adjusted content box: add `contentBox(theme, {gutter, duplex, pageIndex})` helper consumed by the render pipeline (Task 8 threads it; this task proves it via direct render tests).
- Layout interaction: footer band reduces usable `pageHeightPt` uniformly; continuation strip reduces it further on pages 2+ — `placeFragments` already takes `{pageHeightPt, marginPt}`; the v2 pipeline passes the furniture-adjusted values (per-page differing available height is NOT supported by `placeFragments` — so reserve the strip height on ALL pages for v2 documents and draw the strip only on 2+; state this simplification in a comment; the first page shows title header instead, so the reservation is symmetric in practice).
- [ ] **Steps:** failing tests (3-page fixture: footer on all pages reading `page n of 3`, strip on 2-3 only, gutter flips sides under duplex; snapshot one furnished page) → implement → PASS (legacy suite still green) → commit `feat(school-print): page furniture — footers, continuation strips, gutter`.

---

### Task 7: Fit policies + densities (pure layout + solver)

**Files:**
- Modify: `backend/src/1_rendering/school/documents/layout.mjs` (options: `growLastPage`, `forceBreak` fragments)
- Create: `backend/src/2_domains/school/documents/fit.mjs` (pure fit decision) — NOTE: the fit *solver* orchestrates measurement, which lives in rendering; the pure part in the domain is the policy decision function; the orchestration goes in Task 8's use case. This task delivers layout options + the pure policy helper.
- Test: extend `layout.test.mjs` (find it; if layout tests live elsewhere, colocate `layout.fit.test.mjs`)

**Interfaces:**
- `layout.mjs`: `placeFragments(fragments, {pageHeightPt, marginPt, spacing, growLastPage = false})` — when true, the last page participates in answer-space/spacer growth (READ lines ~225-228: the existing exclusion "Trailing space on the last page belongs to the document" — invert ONLY under the flag; default behavior byte-identical, proven by the untouched existing layout tests). `forceBreak` fragments end the current page unconditionally.
- `fit.mjs`: `resolveFitPlan({policy, attempts}) → {attempt | error}` — pure: given ordered measured attempts `[{density:'normal', pageCount, oversetPt}, {density:'compact', ...}]`, returns which attempt satisfies the policy (`one-page`: first with pageCount === 1; error `{code:'FIT_OVERSET', oversetPt}` reporting the COMPACT attempt's overset when none fits; `flow`/`fill`: always the normal-density attempt, `fill` marks `growLastPage: true`).
- [ ] **Steps:** failing tests (growLastPage inversion — same fragments place with grown last-page spaces only under the flag; forceBreak; resolveFitPlan matrix incl. overset-at-compact reporting) → implement → PASS + whole rendering/domain folders green → commit `feat(school-print): fit policy primitives — last-page growth, force breaks, density plan`.

---

### Task 8: `RenderPrintDocument` use case + YAML repository

**Files:**
- Create: `backend/src/3_applications/school/documents/RenderPrintDocument.mjs`, `backend/src/1_adapters/school/documents/YamlPrintDocumentRepository.mjs`
- Test: `backend/src/3_applications/school/documents/RenderPrintDocument.test.mjs`

**Interfaces:**
- Repository: `YamlPrintDocumentRepository({directory})` — `list()`, `get(id)` (parse YAML, return raw), mirroring the directory-walk conventions of `backend/src/1_adapters/school/catalog/YamlSurfaceProfileRepository.mjs` (READ for style).
- Use case: `RenderPrintDocument({repository?, renderer?, measure?, layout?})` with `async execute({document | id, context = {}})`:
  1. `validateAnyDocument` (v2 or v1 — v1 documents render through the legacy path untouched: delegate straight to the existing renderer entry).
  2. v2 pipeline: build theme via `createWorkbookTheme({typeScale: doc.fit.typeScale, density})`; measure at normal density (compact only if `one-page` needs the fallback); place with furniture-adjusted content box (Task 6) + `growLastPage` per `fit.mjs` plan; draw with furniture per page.
  3. Render context: `{learnerName?, date?}` — pre-fills the header name/date lines when present (blank ruled lines otherwise); no cards, no teacher mode (Phases B/C).
  4. Returns `{bytes, pageCount, density, warnings}`; `FIT_OVERSET` surfaces as a structured error (never a throw with a bare string — match the house error style in the school application layer).
- Determinism: the use case pins the CreationDate exactly the way the existing golden tests do (find and reuse the mechanism — likely an option or env the renderer already honors; if the existing pattern lives only in tests, thread an explicit `{creationDate}` option through the renderer instead, defaulting to `new Date()` in production and fixed in tests).
- [ ] **Steps:** failing tests — (a) v2 worksheet fixture renders; two runs byte-identical (fixed creationDate) [spec §12.1]; (b) `one-page` doc that fits normal returns density normal; a padded fixture falls back to compact; an overlong one returns FIT_OVERSET with the compact overset amount [§12.6]; (c) `fill` fixture's last page bottoms out (assert grown answer-space/spacer in the layout result, not pixel-diff); (d) v1 document round-trips through the legacy path (byte-identical to calling the legacy renderer directly); (e) name/date prefill renders (snapshot) → implement (~150 lines) → PASS → commit `feat(school-print): RenderPrintDocument v2 pipeline + YAML repository`.

---

### Task 9: `school:docs` CLI

**Files:**
- Create: `cli/school-docs.cli.mjs`; modify `package.json` (script `"school:docs": "node cli/school-docs.cli.mjs"`)
- Test: `cli/school-docs.cli.test.mjs` (vitest; exemplar `cli/schoolcalc-catalog.cli.test.mjs` — exported-function tests on tmp dirs; NOT node:test)

**Interfaces:**
- `export async function runSchoolDocs(argv, deps)` → `{exitCode, report}`; bin entry prints + exits.
- `validate <file|dir>`: parse YAML → `validateAnyDocument` → dotted-path errors; exit 0 clean / 1 errors. Directory form walks `*.yml`.
- `render <file> --out <pdf> [--learner-name s] [--date s] [--type-scale s] [--density d]` (flags override document fit fields for proofing): writes the PDF, prints `{pages, density}`; exit 1 on validation/fit errors with the structured overset message.
- Content root: `--data-dir` / `$DAYLIGHT_BASE_PATH` with default `content/school/print-documents` (same resolution pattern as `cli/schoolcalc-catalog.cli.mjs` — READ IT).
- [ ] **Steps:** failing tests (validate ok / errors / dir walk; render writes a PDF ≥ 1KB and byte-stable across two runs with a fixed `--creation-date` test flag; overset doc exits 1 naming overset pt) → implement → PASS → commit `feat(school-print): school:docs validate/render CLI`.

---

### Task 10: Phase A acceptance sweep + evidence

**Files:**
- Create: `backend/src/3_applications/school/documents/acceptance.phaseA.test.mjs`, `docs/_wip/audits/2026-08-04-print-design-phase-a-acceptance.md`

Covers spec §12 items tagged [A]:
- [ ] **§12.1 determinism:** already tested per-task; acceptance test renders one fixture twice byte-identical AND across two fresh process-level module loads (dynamic import twice with vitest isolation, or just two use-case instances).
- [ ] **§12.6 fit:** the three-policy matrix in one test file with three fixtures (overset error at compact; flow with correct footers/continuation strips — assert via pdf text extraction if a helper exists, else via the layout result + one snapshot; fill bottoms out); `one-page`+receipt validation error.
- [ ] **§12.7 targets:** letter-only block + receipt target fails at validation.
- [ ] **§12.8 type:** four styles embed (assert the rendered PDF bytes contain the four font names); `*italic*` renders in v2 and is inert in v1 measurement; standard-vs-young and normal-vs-compact snapshots differ.
- [ ] **§12.10 (A-part):** one body rendered under `archetype: quiz` (scoreBox header) vs `archetype: worksheet` (no scoreBox) purely by envelope change — snapshot both.
- [ ] **Legacy intact:** full `npx vitest run backend/src/2_domains/school/documents/ backend/src/1_rendering/school/documents/` green with zero modifications to pre-existing snapshot files (`git status` on the snapshot dirs is clean).
- [ ] Record all runs in the evidence doc; commit `test(school-print): Phase A acceptance + evidence`.

---

## Self-Review Notes

- **Spec coverage (Phase A):** §4 envelope → Tasks 2–3; §6.2 content blocks → Tasks 4–5; §7 fit+furniture → Tasks 6–7 (orchestration in 8); §8 theme/type → Task 1 (+5 for italic); §10 CLI → Task 9; §12[A] → Task 10. Deliberately absent (later phases): source/publish, derived banks, assessment blocks, shuffle keys, cards/allocation, IssueDocument, teacher mode.
- **Legacy-safety invariant** appears in Tasks 1, 5, 7, 8, 10: existing goldens byte-identical, v1 validation results deep-equal, italic off by default.
- **Type consistency:** `createWorkbookTheme({typeScale, density})`, `validateAnyDocument`, `BLOCK_TARGET_SUPPORT`, `resolveFitPlan`, `growLastPage`, `drawFurniture`/`contentBox`, `RenderPrintDocument.execute({document|id, context})` used consistently across tasks 5–10.
- **Known simplification:** continuation-strip height reserved on all pages (per-page variable height unsupported by `placeFragments`) — stated in Task 6 with rationale.
