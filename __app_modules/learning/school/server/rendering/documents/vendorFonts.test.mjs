import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDocumentPdfRenderer } from "./DocumentPdfRenderer.mjs";
import { createDocumentReceiptRenderer } from "./DocumentReceiptRenderer.mjs";
import { createWorkbookTheme } from "./workbookTheme.mjs";
import { texToSvg } from "./mathSvg.mjs";
import { MissingVendorAssetError, resetVendorFontWarnings, setDefaultVendorFontDir, vendorFontDirFor } from "./vendorFonts.mjs";

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
