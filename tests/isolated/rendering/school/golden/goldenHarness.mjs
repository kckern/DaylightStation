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
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { createDocumentPdfRenderer } from '#rendering/school/documents/DocumentPdfRenderer.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = path.join(HERE, 'corpus');
const SNAPSHOT_DIR = path.join(HERE, 'snapshots');
const FIXTURE_DIR = path.join(HERE, '..', '..', '..', '..', '_fixtures', 'school', 'curriculum');

/** Rasterization density. 150dpi is legible enough to judge and small enough to commit. */
export const RENDER_DPI = 150;
/** A page differing by more than this fraction of its pixels is a failure. */
export const MAX_DIFF_RATIO = 0.005;
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
];

/** Every case renders with the same injected deps, so a diff means a code change. */
export function createGoldenRenderer() {
  return createDocumentPdfRenderer({ resolveAsset });
}

export async function renderCase(testCase) {
  const renderer = createGoldenRenderer();
  const options = { studentName: 'learner-two', ...(testCase.options?.() ?? {}) };
  return renderer.render(testCase.document(), options);
}

export function requirePdftoppm() {
  try {
    execFileSync('pdftoppm', ['-v'], { stdio: 'pipe' });
  } catch (err) {
    throw new Error(
      'The School golden page suite needs poppler\'s `pdftoppm` to rasterize PDFs, and it is not '
      + 'on PATH. Install it (macOS: `brew install poppler`; Debian/Ubuntu: `apt install '
      + 'poppler-utils`) and re-run. This suite deliberately fails instead of skipping: a golden '
      + `test that quietly passes is checking nothing. (${err.message})`,
    );
  }
}

/**
 * Rasterize a PDF buffer to one PNG buffer per page.
 * @returns {Buffer[]} page images in order
 */
export function rasterizePages(pdf, name) {
  requirePdftoppm();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `school-golden-${name}-`));
  try {
    const pdfPath = path.join(workDir, `${name}.pdf`);
    fs.writeFileSync(pdfPath, pdf);
    execFileSync('pdftoppm', ['-png', '-r', String(RENDER_DPI), pdfPath, path.join(workDir, 'page')], { stdio: 'pipe' });
    return fs.readdirSync(workDir)
      .filter((file) => file.startsWith('page') && file.endsWith('.png'))
      .sort()
      .map((file) => fs.readFileSync(path.join(workDir, file)));
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
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

/**
 * Compare one rendered page against its committed snapshot.
 *
 * @returns {Promise<{ ok: boolean, reason?: string, diffRatio?: number, diffPath?: string }>}
 */
export async function comparePage(name, pageNumber, png) {
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

  let differing = 0;
  for (let i = 0; i < actual.data.length; i += 4) {
    if ([0, 1, 2].some((c) => Math.abs(actual.data[i + c] - expected.data[i + c]) > CHANNEL_TOLERANCE)) differing += 1;
  }
  const diffRatio = differing / (actual.width * actual.height);
  if (diffRatio <= MAX_DIFF_RATIO) return { ok: true, diffRatio };

  const diffPath = target.replace(/\.png$/, '.diff.png');
  await writeDiffImage(actual, expected, diffPath);
  return {
    ok: false,
    diffRatio,
    diffPath,
    reason: `${(diffRatio * 100).toFixed(3)}% of pixels differ (limit ${(MAX_DIFF_RATIO * 100).toFixed(1)}%); diff written to ${path.relative(process.cwd(), diffPath)}`,
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
