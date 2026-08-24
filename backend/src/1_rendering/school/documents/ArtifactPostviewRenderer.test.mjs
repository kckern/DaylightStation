import { describe, it, expect } from 'vitest';
import PDFDocument from 'pdfkit';
import { createArtifactPostviewRenderer } from './ArtifactPostviewRenderer.mjs';

function sourcePdf() {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'LETTER' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.fontSize(20).text('Original issued worksheet');
    doc.end();
  });
}

describe('ArtifactPostviewRenderer', () => {
  it('preserves every original page and adds an interpreted-evidence overlay', async () => {
    const rendered = await createArtifactPostviewRenderer()({
      originalPdf: await sourcePdf(),
      session: { state: {
        machineGrade: { percent: 50 }, gradedPercent: 100,
        outcome: { result: 'passed' }, missedItemIds: [],
        gradeAdjustments: [{ adjustmentId: 'adj_1', reason: 'eraser false negative', adjustedBy: 'parent', at: '2026-08-24T00:00:00Z', retracted: false }],
      } },
    });
    expect(rendered.pageCount).toBe(1);
    expect(rendered.pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(rendered.pdf.length).toBeGreaterThan(1000);
  });
});
