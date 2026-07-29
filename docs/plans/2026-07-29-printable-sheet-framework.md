# Printable Sheet Framework Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a config-driven framework that renders printable interaction surfaces — pages of scannable marks (QR, Code 128, labels) that act as input devices — and use it to produce the nutrition fridge sheet.

**Architecture:** YAML (`sheets.yml`) declares page/block/grid *shape*. Items come from **provider functions in code**, never literal payloads in YAML, so a printed code cannot drift from the grammar that parses it. Two string-keyed registries (`source:` → provider, `cell.kind:` → mark renderer) are the extension seams. All non-trivial logic lives in one pure function, `SheetLayout.layout()`, which is the only thing golden-tested; the pdfkit emitter makes no decisions.

**Tech Stack:** Node ESM (`.mjs`), pdfkit, svg-to-pdfkit, existing `QRCodeRenderer` (SVG QR), `bwip-js` for Code 128, vitest.

**Design doc:** [`docs/_wip/plans/2026-07-29-printable-sheet-framework-design.md`](../_wip/plans/2026-07-29-printable-sheet-framework-design.md)

**Worktree:** `.worktrees/sheet-framework` on `feature/printable-sheet-framework`.

---

## Context you need before starting

**Layer rules (this repo is DDD-layered, enforced by `npm run audit:layers`):**

| Layer | Directory | May import from |
|---|---|---|
| domain | `backend/src/2_domains/` | domain only |
| rendering | `backend/src/1_rendering/` | domain, pure libs — **no I/O, no config reads** |
| application | `backend/src/3_applications/` | domain, rendering, adapters |
| composition | `backend/src/5_composition/` | anything (this is the wiring layer) |
| api | `backend/src/4_api/` | applications, composition |

Import aliases exist: `#domains/…`, `#rendering/…`, `#apps/…`, `#composition/…`, `#system/…`. Use them, not relative paths across layers.

**Existing pieces you will reuse, not rebuild:**
- `backend/src/2_domains/nutrition/services/ScanVocabularyService.mjs` — exports `encodeDensity(level)`, `encodeContainer(id)`, `RESET_CODE`, `parseScan(code)`, `MAX_DENSITY_LEVEL`. The encoders throw `ValidationError` on anything the parser would reject.
- `backend/src/1_rendering/qrcode/QRCodeRenderer.mjs` — `createQRCodeRenderer().renderSvg(data, options)` returns an SVG string. Supports `{ label, sublabel, coverData }`.
- `backend/src/3_applications/nutribot/lib/scaleNutribotConfig.mjs` — `normalizeScaleNutribotConfig(raw)` returns `{ densityLevels: [{level, label, emoji, kcal_per_g, …}], containers: { thresholdG, items: [{id, label, emoji, grams}] }, … }`.

**Critical constraint — pdfkit output is not byte-stable.** It stamps `CreationDate: new Date()` and derives the trailer `/ID` from an md5 over the info dict. **Never write a golden/snapshot test against generated PDF bytes.** Test the pure layout function instead.

**Run tests from the worktree root:**
```bash
cd /Users/kckern/Documents/GitHub/DaylightStation/.worktrees/sheet-framework
npx vitest run <path>
```

**Baseline note:** the full suite has ~200 pre-existing failing files (frontend/jsdom), identical to `main`. Ignore them. Your in-scope suites are green (227 tests).

---

## Task 1: Pure layout engine — single block, exact fit

**Files:**
- Create: `backend/src/1_rendering/pdf/SheetLayout.mjs`
- Test: `backend/src/1_rendering/pdf/SheetLayout.test.mjs`

**Step 1: Write the failing test**

```js
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { layout } from './SheetLayout.mjs';

const PAGE = { widthPt: 612, heightPt: 792, marginPt: 36 };

describe('layout — single block', () => {
  it('places a 3x3 block of 9 items on one page, left-to-right then down', () => {
    const result = layout({
      page: PAGE,
      blocks: [{ id: 'density', title: 'Caloric density', cols: 3, rows: 3, count: 9, gapPt: 8 }],
    });

    expect(result.pages).toBe(1);
    expect(result.cells).toHaveLength(9);

    const [c0, c1, c3] = [result.cells[0], result.cells[1], result.cells[3]];
    expect(c0).toMatchObject({ page: 0, block: 'density', index: 0 });
    // second cell is to the RIGHT of the first, same row
    expect(c1.y).toBeCloseTo(c0.y, 5);
    expect(c1.x).toBeGreaterThan(c0.x);
    // fourth cell starts a new row, back at the left edge
    expect(c3.x).toBeCloseTo(c0.x, 5);
    expect(c3.y).toBeGreaterThan(c0.y);
    // all cells identical size, inside the margins
    for (const c of result.cells) {
      expect(c.w).toBeCloseTo(c0.w, 5);
      expect(c.h).toBeCloseTo(c0.h, 5);
      expect(c.x).toBeGreaterThanOrEqual(PAGE.marginPt);
      expect(c.x + c.w).toBeLessThanOrEqual(PAGE.widthPt - PAGE.marginPt + 0.01);
    }
  });
});
```

**Step 2: Run it to verify it fails**

Run: `npx vitest run backend/src/1_rendering/pdf/SheetLayout.test.mjs`
Expected: FAIL — `Failed to resolve import "./SheetLayout.mjs"`.

**Step 3: Write the minimal implementation**

```js
/**
 * Pure geometry for printable sheets. No pdfkit, no SVG, no I/O, no clock.
 *
 * This is the ONLY part of the sheet pipeline with non-trivial logic, and that is
 * deliberate: pdfkit stamps CreationDate and derives the trailer /ID from it, so
 * generated PDFs are not byte-stable and a golden test on the output would pin
 * nothing. Extracting the maths puts the testable part somewhere a test can hold.
 *
 * Coordinates are PDF points with the ORIGIN AT TOP-LEFT (y grows downward),
 * which is what pdfkit's drawing calls expect.
 *
 * @module rendering/pdf/SheetLayout
 */

/**
 * @param {object} spec
 * @param {{widthPt:number, heightPt:number, marginPt:number}} spec.page
 * @param {Array<{id:string, title?:string, cols:number, rows:number, count:number, gapPt?:number}>} spec.blocks
 * @returns {{pages:number, cells:Array<{page:number, block:string, index:number, x:number, y:number, w:number, h:number}>, titles:Array<{page:number, block:string, text:string, x:number, y:number, continued:boolean}>}}
 */
export function layout({ page, blocks }) {
  const cells = [];
  const titles = [];
  const contentW = page.widthPt - 2 * page.marginPt;

  let pageIdx = 0;
  let cursorY = page.marginPt;

  for (const block of blocks) {
    const gap = block.gapPt ?? 8;
    const cellW = (contentW - (block.cols - 1) * gap) / block.cols;
    const cellH = cellW; // square cells until Task 3 introduces aspect control

    for (let i = 0; i < block.count; i += 1) {
      const col = i % block.cols;
      const row = Math.floor(i / block.cols);
      cells.push({
        page: pageIdx,
        block: block.id,
        index: i,
        x: page.marginPt + col * (cellW + gap),
        y: cursorY + row * (cellH + gap),
        w: cellW,
        h: cellH,
      });
    }
    const usedRows = Math.ceil(block.count / block.cols);
    cursorY += usedRows * (cellH + gap);
  }

  return { pages: pageIdx + 1, cells, titles };
}
```

**Step 4: Run it to verify it passes**

Run: `npx vitest run backend/src/1_rendering/pdf/SheetLayout.test.mjs`
Expected: PASS (1 test).

**Step 5: Commit**

```bash
git add backend/src/1_rendering/pdf/SheetLayout.mjs backend/src/1_rendering/pdf/SheetLayout.test.mjs
git commit -m "feat(sheets): pure layout engine, single-block exact fit"
```

---

## Task 2: Layout — block titles and title height

**Files:**
- Modify: `backend/src/1_rendering/pdf/SheetLayout.mjs`
- Modify: `backend/src/1_rendering/pdf/SheetLayout.test.mjs`

**Step 1: Write the failing test** (append to the test file)

```js
describe('layout — titles', () => {
  it('emits a title placement per block and pushes cells below it', () => {
    const noTitle = layout({
      page: PAGE,
      blocks: [{ id: 'a', cols: 3, rows: 3, count: 3, gapPt: 8 }],
    });
    const withTitle = layout({
      page: PAGE,
      blocks: [{ id: 'a', title: 'Caloric density', cols: 3, rows: 3, count: 3, gapPt: 8, titleHeightPt: 24 }],
    });

    expect(noTitle.titles).toHaveLength(0);
    expect(withTitle.titles).toHaveLength(1);
    expect(withTitle.titles[0]).toMatchObject({
      page: 0, block: 'a', text: 'Caloric density', continued: false,
    });
    // the title consumes vertical space: cells sit 24pt lower
    expect(withTitle.cells[0].y - noTitle.cells[0].y).toBeCloseTo(24, 5);
  });
});
```

**Step 2: Run to verify it fails**

Expected: FAIL — `expect(received).toHaveLength(1)` got 0.

**Step 3: Implement**

In `layout()`, inside the `for (const block of blocks)` loop, before laying out cells:

```js
    if (block.title) {
      titles.push({
        page: pageIdx,
        block: block.id,
        text: block.title,
        x: page.marginPt,
        y: cursorY,
        continued: false,
      });
      cursorY += block.titleHeightPt ?? 24;
    }
```

**Step 4: Run to verify it passes**

Expected: PASS (2 tests).

**Step 5: Commit**

```bash
git commit -am "feat(sheets): block titles consume layout height"
```

---

## Task 3: Layout — underfull blocks and multi-block stacking

**Files:**
- Modify: `backend/src/1_rendering/pdf/SheetLayout.mjs`
- Modify: `backend/src/1_rendering/pdf/SheetLayout.test.mjs`

Per the design: **`cols` is fixed, `rows` is the per-page maximum.** A 4-item list in a 5x5 block prints one short row and the block ends — it must not error and must not pad.

**Step 1: Write the failing test**

```js
describe('layout — underfull and stacking', () => {
  it('an underfull block ends after its last item and reports capacity', () => {
    const result = layout({
      page: PAGE,
      blocks: [{ id: 'containers', cols: 5, rows: 5, count: 4, gapPt: 8 }],
    });
    expect(result.cells).toHaveLength(4);
    expect(result.cells.every((c) => c.page === 0)).toBe(true);
    expect(result.underfull).toEqual([{ block: 'containers', capacity: 25, items: 4 }]);
  });

  it('stacks a second block below the first, not overlapping it', () => {
    const result = layout({
      page: PAGE,
      blocks: [
        { id: 'a', cols: 3, rows: 3, count: 9, gapPt: 8 },
        { id: 'b', cols: 5, rows: 5, count: 5, gapPt: 8 },
      ],
    });
    const aBottom = Math.max(...result.cells.filter((c) => c.block === 'a').map((c) => c.y + c.h));
    const bTop = Math.min(...result.cells.filter((c) => c.block === 'b').map((c) => c.y));
    expect(bTop).toBeGreaterThanOrEqual(aBottom);
  });
});
```

**Step 2: Run to verify it fails**

Expected: FAIL — `result.underfull` is undefined.

**Step 3: Implement**

Add `const underfull = [];` near the other accumulators. After laying out a block's cells:

```js
    const capacity = block.cols * block.rows;
    if (block.count < capacity) {
      underfull.push({ block: block.id, capacity, items: block.count });
    }
```

Return `{ pages: pageIdx + 1, cells, titles, underfull }`.

**Step 4: Run to verify it passes**

Expected: PASS (4 tests).

**Step 5: Commit**

```bash
git commit -am "feat(sheets): underfull reporting and multi-block stacking"
```

---

## Task 4: Layout — pagination and continued titles

**Files:**
- Modify: `backend/src/1_rendering/pdf/SheetLayout.mjs`
- Modify: `backend/src/1_rendering/pdf/SheetLayout.test.mjs`

**Step 1: Write the failing test**

```js
describe('layout — pagination', () => {
  it('overflows past rows-per-page onto a new page and repeats the title as continued', () => {
    const result = layout({
      page: PAGE,
      blocks: [{ id: 'containers', title: 'Containers', cols: 5, rows: 5, count: 30, gapPt: 8, titleHeightPt: 24 }],
    });

    expect(result.pages).toBe(2);
    expect(result.cells.filter((c) => c.page === 0)).toHaveLength(25);
    expect(result.cells.filter((c) => c.page === 1)).toHaveLength(5);

    // indices stay absolute across the page break — the renderer maps index -> item
    expect(result.cells.find((c) => c.page === 1).index).toBe(25);

    expect(result.titles).toHaveLength(2);
    expect(result.titles[0]).toMatchObject({ page: 0, continued: false });
    expect(result.titles[1]).toMatchObject({ page: 1, continued: true });

    // a full block is NOT reported underfull
    expect(result.underfull).toEqual([]);
  });

  it('starts a block on a new page when it cannot fit under the previous one', () => {
    const result = layout({
      page: PAGE,
      blocks: [
        { id: 'a', cols: 2, rows: 4, count: 8, gapPt: 8 },   // tall: 2 cols => big cells
        { id: 'b', cols: 2, rows: 4, count: 8, gapPt: 8 },
      ],
    });
    expect(result.pages).toBeGreaterThan(1);
    const bPages = new Set(result.cells.filter((c) => c.block === 'b').map((c) => c.page));
    const aPages = new Set(result.cells.filter((c) => c.block === 'a').map((c) => c.page));
    // b must not be drawn on top of a
    for (const c of result.cells.filter((x) => x.block === 'b')) {
      expect(c.y + c.h).toBeLessThanOrEqual(PAGE.heightPt - PAGE.marginPt + 0.01);
    }
    expect([...bPages].some((p) => !aPages.has(p))).toBe(true);
  });
});
```

**Step 2: Run to verify it fails**

Expected: FAIL — `expect(result.pages).toBe(2)` receives 1.

**Step 3: Implement**

Replace the body of the block loop with page-aware chunking:

```js
  for (const block of blocks) {
    const gap = block.gapPt ?? 8;
    const cellW = (contentW - (block.cols - 1) * gap) / block.cols;
    const cellH = cellW;
    const titleH = block.title ? (block.titleHeightPt ?? 24) : 0;
    const perPage = block.cols * block.rows;
    const bottom = page.heightPt - page.marginPt;

    const capacity = block.cols * block.rows;
    if (block.count < capacity) {
      underfull.push({ block: block.id, capacity, items: block.count });
    }

    let placed = 0;
    let continued = false;

    while (placed < block.count) {
      const rowsHere = Math.min(
        block.rows,
        Math.max(0, Math.floor((bottom - cursorY - titleH + gap) / (cellH + gap))),
      );

      // Not enough room under the previous block — start a fresh page.
      if (rowsHere < 1) {
        pageIdx += 1;
        cursorY = page.marginPt;
        continue;
      }

      if (block.title) {
        titles.push({
          page: pageIdx, block: block.id, text: block.title,
          x: page.marginPt, y: cursorY, continued,
        });
        cursorY += titleH;
      }

      const chunk = Math.min(block.count - placed, Math.min(perPage, rowsHere * block.cols));
      for (let i = 0; i < chunk; i += 1) {
        const col = i % block.cols;
        const row = Math.floor(i / block.cols);
        cells.push({
          page: pageIdx,
          block: block.id,
          index: placed + i,           // ABSOLUTE index into the provider's items
          x: page.marginPt + col * (cellW + gap),
          y: cursorY + row * (cellH + gap),
          w: cellW,
          h: cellH,
        });
      }

      const usedRows = Math.ceil(chunk / block.cols);
      cursorY += usedRows * (cellH + gap);
      placed += chunk;
      continued = true;

      if (placed < block.count) {
        pageIdx += 1;
        cursorY = page.marginPt;
      }
    }
  }
```

**Step 4: Run to verify it passes**

Run: `npx vitest run backend/src/1_rendering/pdf/SheetLayout.test.mjs`
Expected: PASS (6 tests). If the "new page" test loops forever, the `rowsHere < 1` guard is wrong — it must advance `pageIdx`, which it does; confirm `cursorY` resets.

**Step 5: Commit**

```bash
git commit -am "feat(sheets): pagination with continued block titles"
```

---

## Task 5: Cell renderer registry — `qr` and `label`

**Files:**
- Create: `backend/src/1_rendering/pdf/cellRenderers.mjs`
- Test: `backend/src/1_rendering/pdf/cellRenderers.test.mjs`

A cell renderer is `(item, rect, opts) => svgString`. It never decides *where* — only *what*.

**Step 1: Write the failing test**

```js
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createCellRenderers } from './cellRenderers.mjs';

describe('cell renderers', () => {
  const rect = { x: 0, y: 0, w: 108, h: 108 };

  it('qr renderer embeds the item code and its label', async () => {
    const { qr } = createCellRenderers();
    const svg = await qr({ code: 'dl:4', label: 'Mixed' }, rect, {});
    expect(svg).toContain('<svg');
    expect(svg).toContain('Mixed');
  });

  it('label renderer produces text with no QR payload', async () => {
    const { label } = createCellRenderers();
    const svg = await label({ code: 'rs:clear', label: 'Reset' }, rect, {});
    expect(svg).toContain('Reset');
    expect(svg).not.toContain('<rect'); // no QR modules
  });

  it('an unknown kind is absent so the caller can fail loudly', () => {
    const renderers = createCellRenderers();
    expect(renderers.definitely_not_a_kind).toBeUndefined();
  });
});
```

**Step 2: Run to verify it fails**

Expected: FAIL — cannot resolve `./cellRenderers.mjs`.

**Step 3: Implement**

```js
/**
 * Cell renderers — the `cell.kind` seam.
 *
 * Each is `(item, rect, opts) => Promise<string>|string` returning an SVG that
 * fills `rect`. They decide WHAT a cell looks like; SheetLayout decides WHERE.
 * Adding a mark type means adding a key here and nothing else.
 *
 * @module rendering/pdf/cellRenderers
 */
import { createQRCodeRenderer } from '#rendering/qrcode/QRCodeRenderer.mjs';

const esc = (s) => String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

export function createCellRenderers({ qrRenderer = createQRCodeRenderer() } = {}) {
  return {
    qr(item, rect, opts = {}) {
      return qrRenderer.renderSvg(item.code, {
        size: opts.sizePt ?? Math.min(rect.w, rect.h),
        label: item.label,
        sublabel: item.sublabel,
        coverData: opts.cover ? item.cover : null,
      });
    },

    label(item, rect) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${rect.w}" height="${rect.h}" viewBox="0 0 ${rect.w} ${rect.h}">`
        + `<text x="${rect.w / 2}" y="${rect.h / 2}" text-anchor="middle" dominant-baseline="middle"`
        + ` font-family="Helvetica" font-size="14">${esc(item.label)}</text></svg>`;
    },

    blank() {
      return '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';
    },
  };
}
```

**Step 4: Run to verify it passes**

Expected: PASS (3 tests). If `qr` throws, check `QRCodeRenderer.renderSvg`'s option names against `backend/src/1_rendering/qrcode/qrcodeTheme.mjs` and adjust — do not change the theme.

**Step 5: Commit**

```bash
git add backend/src/1_rendering/pdf/cellRenderers.mjs backend/src/1_rendering/pdf/cellRenderers.test.mjs
git commit -m "feat(sheets): cell renderer registry with qr, label, blank"
```

---

## Task 6: Nutrition providers + the anti-drift property test

**Files:**
- Create: `backend/src/5_composition/modules/sheetProviders.mjs`
- Test: `backend/src/5_composition/modules/sheetProviders.test.mjs`

**This is the most important test in the plan.** Every code the sheet prints must parse back to the thing it claims to be. If this fails, something would have been laminated wrong.

**Step 1: Write the failing test**

```js
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseScan } from '#domains/nutrition/services/ScanVocabularyService.mjs';
import { createNutritionProviders } from './sheetProviders.mjs';

const cfg = {
  densityLevels: [
    { level: 1, label: 'Watery', kcal_per_g: 0.2 },
    { level: 9, label: 'Oil', kcal_per_g: 8.5 },
  ],
  containers: { thresholdG: 150, items: [{ id: 'dinner-bowl', label: 'Dinner bowl', grams: 250 }] },
};

describe('nutrition sheet providers', () => {
  const providers = createNutritionProviders({ getScaleConfig: () => cfg });

  it('every printed density code parses back to the same level', () => {
    const items = providers['nutrition.density']();
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(parseScan(item.code)).toEqual({ kind: 'density', level: expect.any(Number) });
      expect(parseScan(item.code).level).toBe(item.meta.level);
    }
  });

  it('every printed container code parses back to the same id', () => {
    const items = providers['nutrition.containers']();
    for (const item of items) {
      expect(parseScan(item.code)).toEqual({ kind: 'container', id: item.meta.id });
    }
  });

  it('the control code parses as a reset', () => {
    const items = providers['nutrition.controls']();
    expect(items).toHaveLength(1);
    expect(parseScan(items[0].code)).toEqual({ kind: 'reset' });
  });

  it('labels come from config so the sheet reads like the keyboard', () => {
    expect(providers['nutrition.density']()[1].label).toBe('Oil');
  });
});
```

**Step 2: Run to verify it fails**

Expected: FAIL — cannot resolve `./sheetProviders.mjs`.

**Step 3: Implement**

```js
/**
 * Sheet item providers — the `source:` seam.
 *
 * A provider answers "what goes in this block", and it lives HERE rather than in
 * YAML for one reason: a printed code must not be able to drift from the grammar
 * that parses it. Codes are produced by ScanVocabularyService's encoders, the same
 * module that parses them, so the sheet and the scanner cannot disagree.
 *
 * @module composition/modules/sheetProviders
 */
import {
  encodeDensity, encodeContainer, RESET_CODE,
} from '#domains/nutrition/services/ScanVocabularyService.mjs';

/**
 * @param {object} deps
 * @param {() => object} deps.getScaleConfig normalised nutribot config
 */
export function createNutritionProviders({ getScaleConfig }) {
  return {
    'nutrition.density': () =>
      (getScaleConfig().densityLevels || []).map((l) => ({
        code: encodeDensity(l.level),
        label: l.label,
        sublabel: `${l.kcal_per_g} kcal/g`,
        icon: l.icon || null,
        meta: { level: l.level },
      })),

    'nutrition.containers': () =>
      (getScaleConfig().containers?.items || []).map((c) => ({
        code: encodeContainer(c.id),
        label: c.label,
        sublabel: `${c.grams} g`,
        icon: c.icon || null,
        meta: { id: c.id },
      })),

    'nutrition.controls': () => ([
      { code: RESET_CODE, label: 'Reset', sublabel: 'clear selection', meta: { kind: 'reset' } },
    ]),
  };
}
```

**Step 4: Run to verify it passes**

Expected: PASS (4 tests).

**Step 5: Commit**

```bash
git add backend/src/5_composition/modules/sheetProviders.mjs backend/src/5_composition/modules/sheetProviders.test.mjs
git commit -m "feat(sheets): nutrition providers with anti-drift property test"
```

---

## Task 7: SheetService — config + providers → render model

**Files:**
- Create: `backend/src/3_applications/sheets/SheetService.mjs`
- Test: `backend/src/3_applications/sheets/SheetService.test.mjs`

**Step 1: Write the failing test**

```js
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createSheetService } from './SheetService.mjs';

const config = {
  defaults: { page: { size: 'letter', margin_pt: 36 }, cell: { kind: 'qr', gap_pt: 8 } },
  sheets: {
    fridge: {
      title: 'Kitchen scale',
      blocks: [
        { title: 'Density', source: 'demo.two', grid: { cols: 3, rows: 3 }, cell: { kind: 'qr' } },
      ],
    },
  },
};
const providers = { 'demo.two': () => ([{ code: 'a', label: 'A' }, { code: 'b', label: 'B' }]) };
const cellKinds = { qr: () => '<svg/>' };

describe('SheetService', () => {
  const svc = createSheetService({ getConfig: () => config, providers, cellKinds });

  it('builds a model with resolved items and placements', async () => {
    const model = await svc.build('fridge', {});
    expect(model.title).toBe('Kitchen scale');
    expect(model.blocks[0].items).toHaveLength(2);
    expect(model.placements.cells).toHaveLength(2);
    expect(model.fingerprint).toMatch(/^[0-9a-f]{6}$/);
  });

  it('refuses an unknown sheet id rather than emitting a partial page', async () => {
    await expect(svc.build('nope', {})).rejects.toThrow(/unknown sheet/i);
  });

  it('refuses an unknown source — structural failures never print', async () => {
    const bad = { ...config, sheets: { s: { blocks: [{ source: 'missing.provider', grid: { cols: 1, rows: 1 } }] } } };
    const s2 = createSheetService({ getConfig: () => bad, providers, cellKinds });
    await expect(s2.build('s', {})).rejects.toThrow(/unknown source/i);
  });

  it('refuses an unknown cell kind', async () => {
    const bad = { ...config, sheets: { s: { blocks: [{ source: 'demo.two', grid: { cols: 1, rows: 1 }, cell: { kind: 'runes' } }] } } };
    const s2 = createSheetService({ getConfig: () => bad, providers, cellKinds });
    await expect(s2.build('s', {})).rejects.toThrow(/unknown cell kind/i);
  });

  it('the fingerprint changes when the items change', async () => {
    const a = await svc.build('fridge', {});
    const other = { 'demo.two': () => ([{ code: 'a', label: 'A' }, { code: 'z', label: 'Z' }]) };
    const s2 = createSheetService({ getConfig: () => config, providers: other, cellKinds });
    const b = await s2.build('fridge', {});
    expect(b.fingerprint).not.toBe(a.fingerprint);
  });
});
```

**Step 2: Run to verify it fails**

Expected: FAIL — cannot resolve `./SheetService.mjs`.

**Step 3: Implement**

```js
/**
 * SheetService — resolve a sheet's config + providers into a render model.
 *
 * Failure policy splits on whether the defect would be VISIBLE ON PAPER:
 * structural problems (unknown sheet/source/cell kind, a provider that throws)
 * reject and emit NO PDF, because a laminated page with a silently missing bank
 * is discovered at the fridge rather than at the printer. Cosmetic problems (a
 * missing icon) are the renderer's business and degrade there.
 *
 * @module applications/sheets/SheetService
 */
import { createHash } from 'node:crypto';
import { layout } from '#rendering/pdf/SheetLayout.mjs';

const PAGE_SIZES = { letter: { widthPt: 612, heightPt: 792 }, a4: { widthPt: 595, heightPt: 842 } };

export function createSheetService({ getConfig, providers, cellKinds, logger = console }) {
  async function build(sheetId, params = {}) {
    const config = getConfig() || {};
    const spec = config.sheets?.[sheetId];
    if (!spec) throw new Error(`unknown sheet "${sheetId}"`);

    const defaults = config.defaults || {};
    const sizeKey = spec.page?.size || defaults.page?.size || 'letter';
    const size = PAGE_SIZES[sizeKey];
    if (!size) throw new Error(`unknown page size "${sizeKey}"`);
    const page = { ...size, marginPt: spec.page?.margin_pt ?? defaults.page?.margin_pt ?? 36 };

    const blocks = [];
    for (const [i, b] of (spec.blocks || []).entries()) {
      const provider = providers[b.source];
      if (!provider) throw new Error(`unknown source "${b.source}" in sheet "${sheetId}"`);

      const kind = b.cell?.kind || defaults.cell?.kind || 'qr';
      if (!cellKinds[kind]) throw new Error(`unknown cell kind "${kind}" in sheet "${sheetId}"`);

      const items = await provider(params, { sheetId });
      blocks.push({
        id: b.id || b.source || `block-${i}`,
        title: b.title,
        cols: b.grid?.cols ?? 3,
        rows: b.grid?.rows ?? 5,
        gapPt: b.cell?.gap_pt ?? defaults.cell?.gap_pt ?? 8,
        kind,
        cellOpts: b.cell || {},
        items,
      });
    }

    const placements = layout({
      page,
      blocks: blocks.map((b) => ({
        id: b.id, title: b.title, cols: b.cols, rows: b.rows, count: b.items.length, gapPt: b.gapPt,
      })),
    });

    for (const u of placements.underfull || []) {
      logger.debug?.('sheet.block.underfull', { sheet: sheetId, ...u });
    }

    // Fingerprint the CODES, not the config file: what matters when comparing a
    // laminated page to the running system is whether the payloads still match.
    const fingerprint = createHash('sha256')
      .update(blocks.flatMap((b) => b.items.map((i) => i.code)).join(' '))
      .digest('hex').slice(0, 6);

    return { sheetId, title: spec.title || sheetId, page, blocks, placements, fingerprint };
  }

  return { build };
}
```

**Step 4: Run to verify it passes**

Expected: PASS (5 tests).

**Step 5: Commit**

```bash
git add backend/src/3_applications/sheets/SheetService.mjs backend/src/3_applications/sheets/SheetService.test.mjs
git commit -m "feat(sheets): SheetService resolves config + providers to a render model"
```

---

## Task 8: QRSheetRenderer — the thin pdfkit emitter

**Files:**
- Create: `backend/src/1_rendering/pdf/QRSheetRenderer.mjs`
- Test: `backend/src/1_rendering/pdf/QRSheetRenderer.test.mjs`

This makes no decisions. Smoke test only — **do not snapshot the bytes.**

**Step 1: Write the failing test**

```js
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { renderSheetPdf } from './QRSheetRenderer.mjs';

describe('QRSheetRenderer', () => {
  const model = {
    title: 'Test sheet',
    fingerprint: 'abc123',
    page: { widthPt: 612, heightPt: 792, marginPt: 36 },
    blocks: [{ id: 'b', kind: 'label', cellOpts: {}, items: [{ code: 'x', label: 'X' }] }],
    placements: {
      pages: 1,
      cells: [{ page: 0, block: 'b', index: 0, x: 36, y: 60, w: 100, h: 100 }],
      titles: [],
    },
  };
  const cellKinds = { label: () => '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text x="1" y="8">X</text></svg>' };

  it('emits a non-trivial PDF', async () => {
    const buf = await renderSheetPdf(model, { cellKinds });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(800);
  });

  it('a cell renderer that throws does not abort the page', async () => {
    const boom = { label: () => { throw new Error('nope'); } };
    const buf = await renderSheetPdf(model, { cellKinds: boom, logger: { warn() {} } });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
```

**Step 2: Run to verify it fails**

Expected: FAIL — cannot resolve `./QRSheetRenderer.mjs`.

**Step 3: Implement**

```js
/**
 * QRSheetRenderer — walk placements, draw cells, emit a PDF.
 *
 * Deliberately dumb: every geometric decision was already made by SheetLayout and
 * every visual decision by a cell renderer. There is nothing here worth a golden
 * test, and pdfkit's output is not byte-stable anyway (CreationDate + a trailer
 * /ID derived from it), so this is smoke-tested only.
 *
 * @module rendering/pdf/QRSheetRenderer
 */
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';

export async function renderSheetPdf(model, { cellKinds, logger = console } = {}) {
  const doc = new PDFDocument({ size: [model.page.widthPt, model.page.heightPt], margin: 0 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', resolve));

  const byId = new Map(model.blocks.map((b) => [b.id, b]));
  const pages = model.placements.pages;

  for (let p = 0; p < pages; p += 1) {
    if (p > 0) doc.addPage();

    if (p === 0 && model.title) {
      doc.font('Helvetica-Bold').fontSize(18)
        .text(model.title, model.page.marginPt, model.page.marginPt / 2, { lineBreak: false });
    }

    for (const t of model.placements.titles.filter((x) => x.page === p)) {
      doc.font('Helvetica-Bold').fontSize(12)
        .text(t.continued ? `${t.text} (cont.)` : t.text, t.x, t.y, { lineBreak: false });
    }

    for (const cell of model.placements.cells.filter((c) => c.page === p)) {
      const block = byId.get(cell.block);
      const item = block?.items?.[cell.index];
      if (!item) continue;
      try {
        const svg = await cellKinds[block.kind](item, cell, block.cellOpts);
        SVGtoPDF(doc, svg, cell.x, cell.y, {
          width: cell.w, height: cell.h, preserveAspectRatio: 'xMidYMid meet',
        });
      } catch (err) {
        // Cosmetic: one bad cell must not cost the whole sheet.
        logger.warn?.('sheet.cell.failed', { block: cell.block, index: cell.index, error: err.message });
      }
    }
  }

  // Provenance footer: lets you tell whether a laminated page still matches the
  // codes the backend now believes in.
  doc.font('Helvetica').fontSize(7).fillColor('#777')
    .text(`${model.sheetId || ''} · ${model.fingerprint}`,
      model.page.marginPt, model.page.heightPt - model.page.marginPt + 8, { lineBreak: false });

  doc.end();
  await done;
  return Buffer.concat(chunks);
}
```

**Step 4: Run to verify it passes**

Expected: PASS (2 tests).

**Step 5: Commit**

```bash
git add backend/src/1_rendering/pdf/QRSheetRenderer.mjs backend/src/1_rendering/pdf/QRSheetRenderer.test.mjs
git commit -m "feat(sheets): thin pdfkit emitter with provenance footer"
```

---

## Task 9: Route — `GET /api/v1/sheets/:id.pdf`

**Files:**
- Create: `backend/src/4_api/v1/routers/sheets.mjs`
- Modify: `backend/src/4_api/v1/routers/api.mjs` — add `'/sheets': 'sheets',` to `routeMap` (near `'/catalog'`, ~line 120)
- Modify: `backend/src/app.mjs` — register alongside the catalog router (~line 1940)
- Test: `backend/src/4_api/v1/routers/sheets.test.mjs`

**Step 1: Write the failing test**

```js
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSheetsRouter } from './sheets.mjs';

const svc = {
  build: async (id) => {
    if (id !== 'ok') throw new Error(`unknown sheet "${id}"`);
    return { sheetId: 'ok', title: 'OK', fingerprint: 'aaa111', page: { widthPt: 612, heightPt: 792, marginPt: 36 }, blocks: [], placements: { pages: 1, cells: [], titles: [] } };
  },
};

function app() {
  const a = express();
  a.use('/sheets', createSheetsRouter({ sheetService: svc, cellKinds: {}, logger: { warn() {}, info() {} } }));
  return a;
}

describe('sheets router', () => {
  it('serves a PDF', async () => {
    const res = await request(app()).get('/sheets/ok.pdf');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
  });

  it('404s an unknown sheet instead of emitting a partial page', async () => {
    const res = await request(app()).get('/sheets/nope.pdf');
    expect(res.status).toBe(404);
  });
});
```

**Step 2: Run to verify it fails**

Run: `npx vitest run backend/src/4_api/v1/routers/sheets.test.mjs`
Expected: FAIL — cannot resolve `./sheets.mjs`. (If `supertest` is missing, check `package.json`; other router tests in this repo use it.)

**Step 3: Implement**

```js
/**
 * Printable sheet router.  GET /api/v1/sheets/:id.pdf
 *
 * Query params are forwarded verbatim to the sheet's providers, which is what
 * lets a data-driven sheet (e.g. the content catalog) be configuration instead of
 * a bespoke router.
 *
 * @module api/v1/routers/sheets
 */
import express from 'express';
import { renderSheetPdf } from '#rendering/pdf/QRSheetRenderer.mjs';

export function createSheetsRouter({ sheetService, cellKinds, logger = console }) {
  const router = express.Router();

  router.get('/:id.pdf', async (req, res) => {
    const { id } = req.params;
    try {
      const model = await sheetService.build(id, req.query);
      const pdf = await renderSheetPdf(model, { cellKinds, logger });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${id}-${model.fingerprint}.pdf"`);
      res.send(pdf);
    } catch (err) {
      const unknown = /unknown (sheet|source|cell kind|page size)/i.test(err.message);
      logger.warn?.('sheet.render.failed', { sheet: id, error: err.message });
      res.status(unknown ? 404 : 500).json({ error: err.message });
    }
  });

  return router;
}
```

Then wire it. In `backend/src/4_api/v1/routers/api.mjs`, add to `routeMap`:

```js
    '/sheets': 'sheets',
```

In `backend/src/app.mjs`, next to the catalog router registration (~line 1940):

```js
  // Printable sheets (QR/barcode interaction surfaces)
  const { createSheetService } = await import('#apps/sheets/SheetService.mjs');
  const { createCellRenderers } = await import('#rendering/pdf/cellRenderers.mjs');
  const { createNutritionProviders } = await import('#composition/modules/sheetProviders.mjs');
  const { createSheetsRouter } = await import('./4_api/v1/routers/sheets.mjs');

  const sheetCellKinds = createCellRenderers();
  const sheetProviders = {
    ...createNutritionProviders({
      getScaleConfig: () => normalizeScaleNutribotConfig(
        configService.getHouseholdAppConfig(householdId, 'scales') || {},
      ),
    }),
  };
  v1Routers.sheets = createSheetsRouter({
    sheetService: createSheetService({
      getConfig: () => configService.getHouseholdAppConfig(householdId, 'sheets') || {},
      providers: sheetProviders,
      cellKinds: sheetCellKinds,
      logger: rootLogger.child({ module: 'sheets' }),
    }),
    cellKinds: sheetCellKinds,
    logger: rootLogger.child({ module: 'sheets' }),
  });
```

`normalizeScaleNutribotConfig` is already imported in `app.mjs` for the nutribot bridge — verify with `grep -n normalizeScaleNutribotConfig backend/src/app.mjs` and add the import only if missing.

**Step 4: Run to verify it passes**

Expected: PASS (2 tests).

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/sheets.mjs backend/src/4_api/v1/routers/sheets.test.mjs backend/src/4_api/v1/routers/api.mjs backend/src/app.mjs
git commit -m "feat(sheets): GET /api/v1/sheets/:id.pdf"
```

---

## Task 10: Ship the fridge sheet config

**Files:**
- Create: `_extensions/…` no. Create: `docs/reference/nutrition/sheets.example.yml`
- Create (outside the repo, household data): `$DAYLIGHT_BASE_PATH/data/household/config/sheets.yml`

**Step 1: Write the example config** (committed; documents the schema)

```yaml
# Example schema for the printable sheet framework. The REAL file lives in
# household data (private), NOT in this repo:
#   data/household/config/sheets.yml
#
# Blocks declare SHAPE. Items come from a provider registered in code (`source:`),
# never from literal codes here — that is what stops a printed code from drifting
# from the grammar that parses it.
#
# Config is cached at startup: edits need a backend restart.
defaults:
  page: { size: letter, margin_pt: 36 }
  cell: { kind: qr, gap_pt: 8 }

sheets:
  fridge:
    title: "Kitchen scale"
    blocks:
      - title: "Caloric density"
        source: nutrition.density
        grid:  { cols: 3, rows: 3 }
        cell:  { kind: qr, size_pt: 108 }
      - title: "Containers"
        source: nutrition.containers
        grid:  { cols: 5, rows: 5 }
        cell:  { kind: qr, size_pt: 64 }
      - title: "Controls"
        source: nutrition.controls
        grid:  { cols: 2, rows: 1 }
        cell:  { kind: qr, size_pt: 96 }
```

**Step 2: Copy it into household data**

```bash
source .env
cp docs/reference/nutrition/sheets.example.yml "$DAYLIGHT_BASE_PATH/data/household/config/sheets.yml"
```

**Step 3: Restart the backend and fetch the sheet**

```bash
curl -s -o /tmp/fridge.pdf -w '%{http_code} %{content_type} %{size_download}\n' \
  http://localhost:3112/api/v1/sheets/fridge.pdf
```
Expected: `200 application/pdf <a few thousand>`.

**Step 4: LOOK AT IT.** Render and inspect — do not declare success from a status code.

```bash
pdftoppm -r 150 -png /tmp/fridge.pdf /tmp/fridge && open /tmp/fridge-1.png
```
Check: three labelled blocks, 9 density + N containers + 1 reset, nothing overlapping, footer fingerprint present.

**Step 5: Verify the codes actually scan** — this is the whole point of the artifact. Scan a density code with the kitchen gun and confirm the backend logs `barcode_relay.scan` followed by a `nutriscan` decision.

**Step 6: Commit** (the example only; household data is not in the repo)

```bash
git add docs/reference/nutrition/sheets.example.yml
git commit -m "docs(sheets): example sheets.yml schema"
```

---

## Task 11: Migrate `catalog.mjs` onto the framework

**Files:**
- Modify: `backend/src/4_api/v1/routers/catalog.mjs`
- Modify: `backend/src/5_composition/modules/sheetProviders.mjs` — add `content.catalog`

**Do this last.** `catalog.mjs` works today; its output is not byte-stable and it fetches thumbnails over internal HTTP, so no test will catch a regression — only your eyes will.

**Step 1:** Add a `content.catalog` provider that takes `(params)` = `{ source, id, screen, options }` and returns items with `{ code, label, cover }`, reusing the existing internal-HTTP item fetch from `catalog.mjs` lines ~40-100.

**Step 2:** Add a `content-catalog` sheet to `sheets.example.yml` and the household config, with `params: [source, id, screen, options]` and `cell: { kind: qr, cover: true }`.

**Step 3:** Replace `catalog.mjs`'s body with a delegate that maps `/:source/:id` onto `sheetService.build('content-catalog', { source, id, ...query })`. **Keep the existing URL** — it is referenced by printed workflows.

**Step 4: Retain the Resvg step.** `svg-to-pdfkit` cannot render SVG-in-SVG, so cover art embedded in a QR SVG must still be rasterized by `convertEmbeddedSvgsToPng` before `SVGtoPDF`. The fridge sheet has no covers and stays fully vector; only this path rasterizes.

**Step 5: Verify by eyeball, against the old output.** Generate a catalog PDF from `main` and from this branch for the same container and compare rendered pages side by side. State plainly in the commit that this was an eyeball check.

**Step 6: Commit**

```bash
git commit -am "refactor(catalog): serve the content catalog through the sheet framework"
```

---

## Definition of done

- [ ] `npx vitest run backend/src/1_rendering/pdf backend/src/3_applications/sheets backend/src/5_composition/modules/sheetProviders.test.mjs backend/src/4_api/v1/routers/sheets.test.mjs` — all green
- [ ] In-scope regression suites still green (227 baseline): `npx vitest run tests/unit/domains/nutrition tests/unit/composition backend/src/2_domains/nutrition backend/src/3_applications/nutribot backend/src/3_applications/hardware`
- [ ] `npm run audit:layers` passes (no layer violations)
- [ ] A generated `fridge.pdf` has been **looked at**, and at least one code from it **scanned successfully** on the kitchen gun
- [ ] Catalog PDF compared by eyeball against `main`
- [ ] `docs/reference/nutrition/README.md` implementation-status table updated — its `QRSheetRenderer + sheet endpoint | not started` row is now done, and several other rows in it are already stale

## Known follow-ups (do NOT fix here)

- An unknown `ct:` id yields a **silent zero tare** in `computeNet` — an orphaned laminated code under-reports instead of refusing. Parser fix, separate change.
- The live `scales.yml` has no `nutribot:` block, so the sheet prints hardcoded fallbacks (4 containers; macro splits the source itself calls unmeasured). Real tare weights are a data task.
- ~14 food icons to source as SVG; `cell: { icon: true }` and the icon-resolution path are not built in this plan.
