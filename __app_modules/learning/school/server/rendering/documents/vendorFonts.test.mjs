import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDocumentPdfRenderer } from "./DocumentPdfRenderer.mjs";
import { createDocumentReceiptRenderer } from "./DocumentReceiptRenderer.mjs";
import { createWorkbookTheme } from "./workbookTheme.mjs";
import { texToSvg } from "./mathSvg.mjs";
import { MissingVendorAssetError, resetVendorFontWarnings, setDefaultVendorFontDir, vendorFontDirFor, vendorFontDirFromEnv, resolveVendorFont, warnedKeys } from "./vendorFonts.mjs";

const theme = createWorkbookTheme({ typeScale: 'young' });
const doc = (md) => ({
  id: 'vendor-font', title: 'Vendor font', seed: 1, variant: 0, target: ['letter'],
  blocks: [{ type: 'rich_text', md }],
});

describe('missing vendor font (Noto Sans KR not installed)', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'no-vendor-'));
  const vendorFontDir = vendorFontDirFor(empty);
  beforeEach(() => { setDefaultVendorFontDir(null); resetVendorFontWarnings(); });

  it('vendorFontDirFor is <media>/vendor/fonts', () => {
    expect(vendorFontDir).toBe(path.join(empty, 'vendor', 'fonts'));
  });
  it('a non-Korean PDF still renders', async () => {
    const { pdf } = await createDocumentPdfRenderer({ theme, texToSvg, vendorFontDir }).render(doc('Plain English only'), { studentName: 'Learner' });
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.toString('latin1')).not.toMatch(/NotoSansKR/);
  });
  it('a Korean PDF throws an error naming npm run install:assets', async () => {
    const renderer = createDocumentPdfRenderer({ theme, texToSvg, vendorFontDir });
    await expect(renderer.render(doc('What does **가위** mean?'), { studentName: 'Learner' }))
      .rejects.toThrow(/npm run install:assets/);
    await expect(renderer.render(doc('안녕'), { studentName: 'Learner' })).rejects.toBeInstanceOf(MissingVendorAssetError);
  });
  it('a non-Korean receipt renders; a Korean receipt throws naming install:assets', async () => {
    const rasterizeSvg = async () => Buffer.alloc(0);
    const renderer = createDocumentReceiptRenderer({ vendorFontDir, rasterizeSvg });
    const card = (text) => ({ id: 'r', title: text, blocks: [] });
    await expect(renderer.createCanvas(card('Plain'), { tokens: {} })).resolves.toBeDefined();
    await expect(renderer.createCanvas(card('UBKS 비둘기'), { tokens: {} }))
      .rejects.toThrow(/npm run install:assets/);
  });
});

describe('vendorFontDirFromEnv (CLI runs have no composition)', () => {
  it('uses DAYLIGHT_MEDIA_PATH, else DAYLIGHT_BASE_PATH/media, else null', () => {
    expect(vendorFontDirFromEnv({ DAYLIGHT_MEDIA_PATH: '/m' })).toBe('/m/vendor/fonts');
    expect(vendorFontDirFromEnv({ DAYLIGHT_BASE_PATH: '/b' })).toBe('/b/media/vendor/fonts');
    expect(vendorFontDirFromEnv({})).toBeNull();
  });
  it('the warn-once key includes the directory', () => {
    resetVendorFontWarnings();
    expect(resolveVendorFont('x.otf', '/nope-a').missing).toBe(true);
    expect(resolveVendorFont('x.otf', '/nope-b').missing).toBe(true);
    expect(warnedKeys()).toEqual(['/nope-a::x.otf', '/nope-b::x.otf']);
  });
});

describe('every CLI that builds a renderer sets the vendor font dir', () => {
  const cliDir = path.join(path.dirname(new URL(import.meta.url).pathname), '../../../cli');
  for (const f of ['agenda.mjs', 'sim.mjs', 'docs.mjs', 'barcode-workflows.mjs', 'korean-course.cli.mjs']) {
    it(f, () => {
      expect(fs.readFileSync(path.join(cliDir, f), 'utf8')).toMatch(/setDefaultVendorFontDir\(/);
    });
  }
});
