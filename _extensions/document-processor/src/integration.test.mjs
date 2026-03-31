import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { makeThumbnail, addPageLabel, buildContactSheet, rotateImage, issueToRotation } from './images.mjs';
import { buildPdf, formatFilename } from './pdf.mjs';
import { buildPrompt, parseResponse } from './vision.mjs';

async function makeTestJpg(width = 800, height = 1000, color = { r: 200, g: 200, b: 200 }) {
  return sharp({
    create: { width, height, channels: 3, background: color },
  }).jpeg().toBuffer();
}

describe('integration: full pipeline (no LLM)', () => {
  const TEST_DIR = `/tmp/docproc-integration-${Date.now()}`;

  before(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  after(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test('end-to-end: JPGs → thumbnails → contact sheet → mock LLM response → rotate → PDFs', async () => {
    // 1. Create 5 synthetic scanned pages
    const pages = [];
    for (let i = 0; i < 5; i++) {
      const jpg = await makeTestJpg(800, 1000, { r: 180 + i * 15, g: 200, b: 220 });
      pages.push(jpg);
      await writeFile(join(TEST_DIR, `page-${String(i + 1).padStart(3, '0')}.jpg`), jpg);
    }

    // 2. Generate labeled thumbnails
    const thumbs = [];
    for (let i = 0; i < pages.length; i++) {
      const thumb = await makeThumbnail(pages[i], 300);
      thumbs.push(await addPageLabel(thumb, i + 1));
    }
    assert.equal(thumbs.length, 5);

    // 3. Build contact sheet
    const sheet = await buildContactSheet(thumbs, { columns: 3 });
    const sheetMeta = await sharp(sheet).metadata();
    assert.ok(sheetMeta.width >= 900); // 3 cols * 300px
    assert.ok(sheetMeta.height > 0);

    // 4. Mock LLM response (simulates what analyzeContactSheet would return)
    const mockLlmResponse = JSON.stringify({
      documents: [
        {
          pages: [1, 2, 3],
          category: 'Insurance',
          description: 'State Farm Auto Renewal',
          date: '2026-03-15',
          issues: { '2': 'upside_down' },
        },
        {
          pages: [4, 5],
          category: 'Receipt',
          description: 'Home Depot Purchase',
          date: '2026-03-28',
          issues: {},
        },
      ],
    });
    const documents = parseResponse(mockLlmResponse);
    assert.equal(documents.length, 2);

    // 5. Process each document group: fix orientation + build PDF
    for (const doc of documents) {
      const fixedPages = [];
      for (const pageNum of doc.pages) {
        let buf = pages[pageNum - 1];
        const issue = doc.issues?.[String(pageNum)];
        if (issue) {
          const degrees = issueToRotation(issue);
          if (degrees) {
            buf = await rotateImage(buf, degrees);
          }
        }
        fixedPages.push(buf);
      }

      // Build PDF
      const pdfBytes = await buildPdf(fixedPages);
      const pdfDoc = await PDFDocument.load(pdfBytes);
      assert.equal(pdfDoc.getPageCount(), doc.pages.length);

      // Generate filename
      const filename = formatFilename(doc.date, doc.category, doc.description);
      assert.ok(filename.endsWith('.pdf'));
      assert.ok(filename.includes(doc.category));

      // Write to test dir
      await writeFile(join(TEST_DIR, filename), pdfBytes);
    }

    // 6. Verify output files
    const outputFiles = (await readdir(TEST_DIR)).filter(f => f.endsWith('.pdf'));
    assert.equal(outputFiles.length, 2);
    assert.ok(outputFiles.some(f => f.includes('Insurance')));
    assert.ok(outputFiles.some(f => f.includes('Receipt')));
  });

  test('buildPrompt produces valid prompt for LLM', () => {
    const categories = ['Tax', 'Medical', 'Insurance', 'Receipt'];
    const prompt = buildPrompt(5, categories);
    assert.ok(prompt.includes('5'));
    assert.ok(prompt.includes('Tax'));
    assert.ok(prompt.includes('Receipt'));
    assert.ok(prompt.includes('upside_down'));
  });
});
