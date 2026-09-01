/**
 * Golden page harness for the School Letter PDF target.
 *
 * WHAT IT DOES
 *   Renders each corpus document, rasterizes every page with poppler's
 *   `pdftoppm -png -r 150`, and compares the result pixel-by-pixel against a
 *   committed snapshot. A page differing by more than 0.5% of its pixels fails,
 *   and the failure writes `<snapshot>.diff.png` beside the snapshot so the
 *   change can be looked at rather than guessed at.
 *
 * WHY PIXELS
 *   Layout defects — a fraction overlapping the line below it, a bubble row
 *   creeping past the margin, math sized 1.4x too large — are invisible to
 *   structural assertions and obvious in an image. Both spike-round-one bugs
 *   were of exactly this kind.
 *
 * WHY THERE ARE TWO TOLERANCES
 *   A whole-page budget has to be loose enough to absorb antialiasing jitter
 *   across a corpus of prose, and 0.5% of a Letter page is a LOT of ink: adding
 *   the QR symbol to the action box — turning an empty reserved box into a
 *   scannable ticket — moved 0.33% of a page and failed nothing. Tightening the
 *   page number instead would make every prose snapshot brittle, and the next
 *   person to hit a flake would loosen it again.
 *
 *   So marks a MACHINE reads are held to their own, far tighter budget inside
 *   their own small boxes (`MARK_MAX_DIFF_RATIO`), while prose keeps the page
 *   budget (`MAX_DIFF_RATIO`). A bubble row is ~1.5% of a page; the QR box is
 *   ~0.3%; a defect that is invisible as a fraction of a page is enormous as a
 *   fraction of the box it happened in.
 *
 *   The boxes are DERIVED from what the renderer says it drew (`formMap` rows
 *   and `codeMap` entries), padded generously so a mark that moved is compared
 *   against its old position rather than following the box. That the renderer's
 *   claims match the ink at all is a different question, and the optical suite
 *   (`../optical.test.mjs`) is what answers it.
 *
 * REGENERATING SNAPSHOTS
 *   UPDATE_GOLDEN=1 npx vitest run tests/isolated/rendering/school/golden/
 *   Regenerate ONLY after looking at the new pages. A snapshot updated to match
 *   a defect pins the defect.
 *
 * REQUIREMENTS
 *   `pdftoppm` (poppler) must be on PATH. When it is missing the harness
 *   THROWS — a golden suite that skips itself is worse than none, because it
 *   reports green while checking nothing.
 *     macOS: brew install poppler   Debian/Ubuntu: apt install poppler-utils
 *
 * @module tests/isolated/rendering/school/golden/goldenHarness
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { createDocumentPdfRenderer } from '#rendering/school/documents/DocumentPdfRenderer.mjs';
import { createWorkbookTheme } from '#rendering/school/documents/workbookTheme.mjs';
import { texToSvg } from '#rendering/school/documents/mathSvg.mjs';
import { requirePdftoppm as requirePoppler, rasterizePdfPages } from '#testlib/school/rasterize.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = path.join(HERE, 'corpus');
const SNAPSHOT_DIR = path.join(HERE, 'snapshots');
const FIXTURE_DIR = path.join(HERE, '..', '..', '..', '..', '_fixtures', 'school', 'curriculum');

/** Rasterization density. 150dpi is legible enough to judge and small enough to commit. */
export const RENDER_DPI = 150;
/**
 * PROSE tier: a page differing by more than this fraction of its pixels fails.
 * Loose on purpose — it has to absorb antialiasing across a whole corpus.
 */
export const MAX_DIFF_RATIO = 0.005;
/**
 * MACHINE-READ tier: inside a bubble row or a code box, this fraction. Five
 * times tighter than the page, and applied to a box one or two orders of
 * magnitude smaller, so a mark that moved or vanished cannot hide in a page's
 * worth of pixels. Not zero: a poppler or freetype version bump legitimately
 * re-shades edge pixels, and a gate that fails on that gets switched off.
 */
export const MARK_MAX_DIFF_RATIO = 0.001;
/** Padding around a derived mark box, in points. */
const MARK_REGION_PAD_PT = 6;
/** Per-channel tolerance, to absorb nothing more than encoder rounding. */
const CHANNEL_TOLERANCE = 8;

export const UPDATE_GOLDEN = process.env.UPDATE_GOLDEN === '1';

const readYaml = (file) => yaml.load(fs.readFileSync(file, 'utf8'));

/** The committed strip diagram, so the resolved-asset path is exercised for real. */
const STRIPS_SVG = fs.readFileSync(path.join(CORPUS_DIR, 'fraction-strips.svg'), 'utf8');

const resolveAsset = (ref) => (ref === 'school/math/fraction-strips'
  ? { svg: STRIPS_SVG, widthPt: 400, heightPt: 120 }
  : null);

const omrBank = () => readYaml(path.join(FIXTURE_DIR, 'banks', 'math-fractions-03-bank.yml'));

const answerSheetQuestion = (number) => ({
  type: 'question',
  itemId: `answer-sheet-q${number}`,
  number,
  blocks: [
    { type: 'rich_text', md: `Solve practice problem ${number} and show your work.` },
    { type: 'answer_space', minPt: 30, maxPt: 30 },
  ],
});

const answerSheetDocument = ({ id, count = 3 }) => ({
  id,
  title: 'Answer Sheet Identity Practice',
  seed: 8684155,
  variant: 0,
  target: ['letter'],
  archetype: 'worksheet',
  blocks: Array.from({ length: count }, (_, index) => answerSheetQuestion(index + 1)),
});

const answerSheetOptions = (card) => ({
  card,
  furniture: { gutter: false, duplex: false },
});

/**
 * The corpus: the spike's math stress cases, the three real curriculum
 * worksheets, and two documents built to break pages in specific ways.
 */
export const GOLDEN_CASES = [
  { name: 'stress-math', document: () => readYaml(path.join(CORPUS_DIR, 'stress-math.yml')) },
  { name: 'widow-bait', document: () => readYaml(path.join(CORPUS_DIR, 'widow-bait.yml')) },
  { name: 'page-break', document: () => readYaml(path.join(CORPUS_DIR, 'page-break.yml')) },
  {
    name: 'fixture-02-worksheet',
    document: () => readYaml(path.join(FIXTURE_DIR, 'documents', 'math-fractions-02-worksheet.yml')),
  },
  {
    name: 'fixture-03-omr',
    document: () => readYaml(path.join(FIXTURE_DIR, 'documents', 'math-fractions-03-omr.yml')),
    options: () => ({ bank: omrBank() }),
    /** Bubble geometry is pinned numerically as well as visually. */
    formMapSnapshot: 'fixture-03-omr.formmap.json',
  },
  {
    name: 'fixture-04-worksheet',
    document: () => readYaml(path.join(FIXTURE_DIR, 'documents', 'math-fractions-04-worksheet.yml')),
  },
  {
    // The SECOND form of the same worksheet, as a retry hands it over. The only
    // difference on the page is the footer's "Form B" — which is the point:
    // that label is the whole record of which sheet a child was given, so it
    // has to be legible, and a picture is the only thing that can check that.
    name: 'fixture-02-worksheet-form-b',
    document: () => readYaml(path.join(FIXTURE_DIR, 'documents', 'math-fractions-02-worksheet.yml')),
    options: () => ({ variant: 1 }),
  },
  {
    // These four workbook-theme cases are the visual contract for the
    // child-facing answer-sheet identity cues. They intentionally use one
    // card number for new/reused/reprinted so a reviewer can see that the
    // identicon stays constant while the instruction and row ownership
    // change. The row-1 reprint is distinct from first use: it must say KEEP.
    name: 'answer-sheet-new',
    workbook: true,
    document: () => answerSheetDocument({ id: 'answer-sheet-new' }),
    options: () => answerSheetOptions({
      cardId: '8684155', startRow: 1, endRow: 3, firstUse: true, identiconVersion: 'v1',
    }),
  },
  {
    name: 'answer-sheet-reused',
    workbook: true,
    document: () => answerSheetDocument({ id: 'answer-sheet-reused' }),
    options: () => answerSheetOptions({
      cardId: '8684155', startRow: 22, endRow: 24, firstUse: false, identiconVersion: 'v1',
    }),
  },
  {
    name: 'answer-sheet-row-1-reprint',
    workbook: true,
    document: () => answerSheetDocument({ id: 'answer-sheet-row-1-reprint' }),
    options: () => answerSheetOptions({
      cardId: '8684155', startRow: 1, endRow: 3, firstUse: false, identiconVersion: 'v1',
    }),
  },
  {
    name: 'answer-sheet-multi-page',
    workbook: true,
    document: () => answerSheetDocument({ id: 'answer-sheet-multi-page', count: 20 }),
    options: () => answerSheetOptions({
      cardId: '8424408', startRow: 1, endRow: 20, firstUse: true, identiconVersion: 'v1',
    }),
    minimumPages: 2,
  },
];

/** Every case renders with the same injected deps, so a diff means a code change. */
export function createGoldenRenderer(testCase = {}) {
  return testCase.workbook
    ? createDocumentPdfRenderer({ resolveAsset, theme: createWorkbookTheme(), texToSvg })
    : createDocumentPdfRenderer({ resolveAsset });
}

export async function renderCase(testCase) {
  const renderer = createGoldenRenderer(testCase);
  const options = { studentName: 'Test Learner', ...(testCase.options?.() ?? {}) };
  return renderer.render(testCase.document(), options);
}

export const requirePdftoppm = requirePoppler;

/**
 * Rasterize a PDF buffer to one PNG buffer per page, at golden density.
 * @returns {Buffer[]} page images in order
 */
export function rasterizePages(pdf, name) {
  return rasterizePdfPages(pdf, { dpi: RENDER_DPI, name });
}

/**
 * The machine-read boxes on a rendered document, in points.
 *
 * One box per BUBBLE ROW rather than per bubble: a row is what the reader
 * treats as a single column, the bubbles in it share a y, and a box that spans
 * the row catches a bubble that slid sideways as well as one that vanished.
 * One box per printed code, padded past its quiet zone.
 *
 * @param {{formMap: Object|null, codeMap: Array}} rendered
 * @returns {Array<{name:string, page:number, xPt:number, yPt:number, widthPt:number, heightPt:number}>}
 */
export function markRegionsFor(rendered) {
  const regions = [];
  const rows = new Map();
  for (const mark of rendered.formMap?.marks ?? []) {
    const key = `${mark.page ?? 1}:${mark.yPt.toFixed(2)}`;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(mark);
  }
  for (const [key, marks] of rows) {
    const page = marks[0].page ?? 1;
    const radius = Math.max(...marks.map((m) => m.rPt));
    const left = Math.min(...marks.map((m) => m.xPt)) - radius - MARK_REGION_PAD_PT;
    const right = Math.max(...marks.map((m) => m.xPt)) + radius + MARK_REGION_PAD_PT;
    const centreY = marks[0].yPt;
    regions.push({
      name: `bubble-row ${key} (${marks[0].itemId})`,
      page,
      xPt: left,
      yPt: centreY - radius - MARK_REGION_PAD_PT,
      widthPt: right - left,
      heightPt: 2 * (radius + MARK_REGION_PAD_PT),
    });
  }
  for (const code of rendered.codeMap ?? []) {
    regions.push({
      name: `code-box (${code.text})`,
      page: code.page ?? 1,
      xPt: code.xPt - MARK_REGION_PAD_PT,
      yPt: code.yPt - MARK_REGION_PAD_PT,
      widthPt: code.sizePt + 2 * MARK_REGION_PAD_PT,
      heightPt: code.sizePt + 2 * MARK_REGION_PAD_PT,
    });
  }
  return regions;
}

const snapshotPath = (name, pageNumber) => path.join(SNAPSHOT_DIR, `${name}-p${String(pageNumber).padStart(2, '0')}.png`);

async function toImageData(png) {
  const { createCanvas: create, loadImage } = await import('canvas');
  const image = await loadImage(png);
  const canvas = create(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  return { data: ctx.getImageData(0, 0, image.width, image.height).data, width: image.width, height: image.height };
}

/** Red where the pages disagree, over a faded copy of the actual render. */
async function writeDiffImage(actual, expected, target) {
  const { createCanvas: create } = await import('canvas');
  const canvas = create(actual.width, actual.height);
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(actual.width, actual.height);
  for (let i = 0; i < actual.data.length; i += 4) {
    const differs = [0, 1, 2].some((c) => Math.abs(actual.data[i + c] - expected.data[i + c]) > CHANNEL_TOLERANCE);
    out.data[i] = differs ? 255 : 255 - (255 - actual.data[i]) / 4;
    out.data[i + 1] = differs ? 0 : 255 - (255 - actual.data[i + 1]) / 4;
    out.data[i + 2] = differs ? 0 : 255 - (255 - actual.data[i + 2]) / 4;
    out.data[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  fs.writeFileSync(target, canvas.toBuffer('image/png'));
}

/** Fraction of differing pixels inside a pixel-space box (whole image when null). */
function diffRatioIn(actual, expected, box) {
  const x0 = box ? Math.max(0, Math.floor(box.x)) : 0;
  const y0 = box ? Math.max(0, Math.floor(box.y)) : 0;
  const x1 = box ? Math.min(actual.width, Math.ceil(box.x + box.width)) : actual.width;
  const y1 = box ? Math.min(actual.height, Math.ceil(box.y + box.height)) : actual.height;
  let differing = 0;
  let total = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * actual.width + x) * 4;
      total += 1;
      if ([0, 1, 2].some((c) => Math.abs(actual.data[i + c] - expected.data[i + c]) > CHANNEL_TOLERANCE)) differing += 1;
    }
  }
  return { differing, total, ratio: total ? differing / total : 0 };
}

/**
 * Compare one rendered page against its committed snapshot.
 *
 * Two gates, deliberately: the whole page against the prose budget, and each
 * machine-read box on this page against the much tighter mark budget. See the
 * file header for why one number cannot serve both.
 *
 * @param {string} name
 * @param {number} pageNumber
 * @param {Buffer} png
 * @param {Object} [options]
 * @param {Array<Object>} [options.regions] - from `markRegionsFor`, all pages
 * @param {number} [options.maxDiffRatio] - per-snapshot override of the prose budget
 * @returns {Promise<{ ok: boolean, reason?: string, diffRatio?: number, diffPath?: string }>}
 */
export async function comparePage(name, pageNumber, png, { regions = [], maxDiffRatio = MAX_DIFF_RATIO } = {}) {
  const target = snapshotPath(name, pageNumber);
  if (UPDATE_GOLDEN) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    fs.writeFileSync(target, png);
    return { ok: true, updated: true };
  }
  if (!fs.existsSync(target)) {
    return { ok: false, reason: `no snapshot at ${path.relative(process.cwd(), target)} — run UPDATE_GOLDEN=1 after reviewing the render` };
  }

  const actual = await toImageData(png);
  const expected = await toImageData(fs.readFileSync(target));
  if (actual.width !== expected.width || actual.height !== expected.height) {
    return {
      ok: false,
      reason: `page size changed: ${actual.width}x${actual.height} vs snapshot ${expected.width}x${expected.height}`,
    };
  }

  const scale = RENDER_DPI / 72;
  const problems = [];
  const { ratio: diffRatio } = diffRatioIn(actual, expected, null);
  if (diffRatio > maxDiffRatio) {
    problems.push(`${(diffRatio * 100).toFixed(3)}% of the page differs (prose limit ${(maxDiffRatio * 100).toFixed(1)}%)`);
  }
  for (const region of regions.filter((r) => (r.page ?? 1) === pageNumber)) {
    const box = {
      x: region.xPt * scale, y: region.yPt * scale, width: region.widthPt * scale, height: region.heightPt * scale,
    };
    const { ratio, differing, total } = diffRatioIn(actual, expected, box);
    if (ratio > MARK_MAX_DIFF_RATIO) {
      problems.push(
        `${region.name}: ${(ratio * 100).toFixed(3)}% of that box differs `
        + `(${differing}/${total} px, machine-read limit ${(MARK_MAX_DIFF_RATIO * 100).toFixed(2)}%)`,
      );
    }
  }
  if (problems.length === 0) return { ok: true, diffRatio };

  const diffPath = target.replace(/\.png$/, '.diff.png');
  await writeDiffImage(actual, expected, diffPath);
  return {
    ok: false,
    diffRatio,
    diffPath,
    reason: `${problems.join('; ')}; diff written to ${path.relative(process.cwd(), diffPath)}`,
  };
}

/** Read or (under UPDATE_GOLDEN) write the committed form map. */
export function compareFormMap(file, formMap) {
  const target = path.join(SNAPSHOT_DIR, file);
  if (UPDATE_GOLDEN) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(formMap, null, 2)}\n`);
    return formMap;
  }
  return JSON.parse(fs.readFileSync(target, 'utf8'));
}
