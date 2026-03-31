import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { buildPdf, formatFilename } from './pdf.mjs';

async function makeTestJpg() {
  return sharp({ create: { width: 800, height: 1000, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .jpeg()
    .toBuffer();
}

describe('pdf', () => {
  let pages;

  before(async () => {
    pages = [await makeTestJpg(), await makeTestJpg(), await makeTestJpg()];
  });

  test('buildPdf creates valid PDF with correct page count', async () => {
    const pdfBytes = await buildPdf(pages);
    const doc = await PDFDocument.load(pdfBytes);
    assert.equal(doc.getPageCount(), 3);
  });

  test('formatFilename builds correct name with date and category', () => {
    const name = formatFilename('2026-03-15', 'Insurance', 'State Farm Auto Renewal');
    assert.equal(name, '2026-03-15 - Insurance - State Farm Auto Renewal.pdf');
  });

  test('formatFilename uses scan date when document date is null', () => {
    const name = formatFilename(null, 'Receipt', 'Unknown Purchase', '2026-03-30');
    assert.equal(name, '2026-03-30 - Receipt - Unknown Purchase.pdf');
  });

  test('formatFilename sanitizes unsafe characters', () => {
    const name = formatFilename('2026-01-01', 'Tax', 'W-2 Form: Federal/State');
    assert.ok(!name.includes('/'));
    assert.ok(!name.includes(':'));
  });
});
