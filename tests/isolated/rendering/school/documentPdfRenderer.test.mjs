/**
 * Letter PDF renderer — structural contract.
 *
 * Pixels are pinned by the golden harness (golden/golden.test.mjs); this suite
 * pins the things a picture cannot check: the numeric form map the OMR reader
 * grades against, answer-key separation, and byte-for-byte determinism.
 */
import { describe, it, expect } from 'vitest';
import { createDocumentPdfRenderer } from '#rendering/school/documents/DocumentPdfRenderer.mjs';
import { documentPdfTheme as theme } from '#rendering/school/documents/documentPdfTheme.mjs';
import { texToSvg } from '#rendering/school/documents/mathSvg.mjs';
import { UnsupportedBlockError, MissingChoicesError, UnresolvedAssetError } from '#rendering/school/documents/measure.mjs';
import { VirtualOmrReader } from '#adapters/hardware/omr/VirtualOmrReader.mjs';

const renderer = createDocumentPdfRenderer({ theme, texToSvg });

/** PDF page objects, to prove the reported page count is the printed one. */
function countPdfPages(pdf) {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

const doc = (blocks, extra = {}) => ({
  id: 'test-doc', title: 'Test Doc', seed: 4242, variant: 0, target: ['letter'], blocks, ...extra,
});

const omrQuestion = (n) => ({
  type: 'question',
  itemId: `q${n}`,
  number: n,
  blocks: [
    { type: 'math', tex: `\\frac{1}{${n + 1}} + \\frac{1}{2}`, display: true },
    { type: 'omr_response', itemId: `q${n}`, choices: 4 },
  ],
});

/** Choice text lives in the bank, never in the document. */
const bank = {
  id: 'test-bank',
  items: [1, 2, 3].map((n) => ({
    id: `q${n}`,
    type: 'multiple_choice',
    choices: [`${n}/2`, `${n}/3`, `${n}/4`, `${n} 3/4`],
    answer: `${n}/2`,
  })),
};

const worksheet = doc([
  { type: 'rich_text', md: '## Fractions\n\nWork each problem and show your steps.' },
  {
    type: 'question',
    itemId: 'w1',
    number: 1,
    blocks: [
      { type: 'rich_text', md: 'Add. Write the result in **simplest form**.' },
      { type: 'math', tex: '\\frac{2}{3} + \\frac{1}{4}', display: true },
      { type: 'answer_space', minPt: 54, maxPt: 90 },
    ],
  },
  { type: 'scan_action', action: 'scan-worksheet', label: 'Scan this page when you finish' },
]);

describe('createDocumentPdfRenderer', () => {
  it('produces a real PDF with at least one page', async () => {
    const { pdf, pageCount } = await renderer.render(worksheet, { studentName: 'learner-two' });
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pageCount).toBeGreaterThanOrEqual(1);
  });

  it('paginates a document longer than one page', async () => {
    const long = doc(Array.from({ length: 12 }, (_, i) => ({
      type: 'question',
      itemId: `q${i}`,
      number: i + 1,
      blocks: [
        { type: 'rich_text', md: `Problem ${i + 1}. Work it out and show the common denominator.` },
        { type: 'answer_space', minPt: 60, maxPt: 90 },
      ],
    })));
    const { pageCount } = await renderer.render(long);
    expect(pageCount).toBeGreaterThan(1);
  });

  it('reports the page count the PDF actually contains', async () => {
    const { pdf, pageCount } = await renderer.render(worksheet, { studentName: 'learner-two' });
    expect(countPdfPages(pdf)).toBe(pageCount);
  });

  it('refuses a block type it cannot draw instead of printing a gap', async () => {
    await expect(renderer.render(doc([{ type: 'plot', spec: { kind: 'line' } }])))
      .rejects.toThrow(UnsupportedBlockError);
  });

  it('refuses an asset it cannot resolve instead of printing an empty box', async () => {
    const withAsset = doc([{ type: 'asset', ref: 'school/math/strips', alt: 'Fraction strips.' }]);
    await expect(renderer.render(withAsset)).rejects.toThrow(UnresolvedAssetError);
  });

  it('draws a resolved SVG asset', async () => {
    const svg = '<svg viewBox="0 0 200 100"><rect x="0" y="0" width="200" height="50" fill="#000"/></svg>';
    const withResolver = createDocumentPdfRenderer({
      theme, texToSvg, resolveAsset: () => ({ svg, widthPt: 200, heightPt: 100 }),
    });
    const { pdf, pageCount } = await withResolver.render(
      doc([{ type: 'asset', ref: 'school/math/strips', alt: 'Fraction strips.' }]),
    );
    expect(pageCount).toBe(1);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('defaults texToSvg to the real MathJax renderer', async () => {
    const bare = createDocumentPdfRenderer();
    const { pageCount } = await bare.render(doc([{ type: 'math', tex: '\\frac{1}{2}', display: true }]));
    expect(pageCount).toBe(1);
  });
});

describe('form map', () => {
  const sheet = doc([
    { type: 'rich_text', md: '## Checkpoint\n\nFill in ONE bubble per question.' },
    omrQuestion(1), omrQuestion(2), omrQuestion(3),
  ]);

  it('refuses to print a bubble sheet with no bank — an unanswerable sheet', async () => {
    await expect(renderer.render(sheet)).rejects.toThrow(MissingChoicesError);
  });

  it('refuses when the bank is missing the item the sheet bubbles', async () => {
    const partial = { id: 'partial', items: bank.items.slice(0, 2) };
    await expect(renderer.render(sheet, { bank: partial })).rejects.toThrow(/not in bank 'partial'/);
  });

  it('refuses when the bank choice count disagrees with the printed bubble count', async () => {
    const short = { id: 'short', items: bank.items.map((i) => ({ ...i, choices: i.choices.slice(0, 3) })) };
    await expect(renderer.render(sheet, { bank: short })).rejects.toThrow(/3 bank choices but the sheet prints 4/);
  });

  it('prints the bank choice text beside each bubble and records it on the mark', async () => {
    const { formMap } = await renderer.render(sheet, { bank });
    expect(formMap.marks.slice(0, 4).map((m) => m.label)).toEqual(bank.items[0].choices);
  });

  it('records one mark per bubble, tagged with the document identity', async () => {
    const { formMap } = await renderer.render(sheet, { bank });
    expect(formMap.documentId).toBe('test-doc');
    expect(formMap.seed).toBe(4242);
    expect(formMap.variant).toBe(0);
    expect(typeof formMap.formVersion).toBe('string');
    expect(formMap.marks).toHaveLength(3 * 4);
    expect(formMap.marks.map((m) => m.choice).slice(0, 4)).toEqual(['A', 'B', 'C', 'D']);
    expect(new Set(formMap.marks.map((m) => m.itemId))).toEqual(new Set(['q1', 'q2', 'q3']));
  });

  it('places every bubble inside the printable area of its page', async () => {
    const { formMap, pageCount } = await renderer.render(sheet, { bank });
    const { marginPt, widthPt, heightPt } = theme.page;
    for (const mark of formMap.marks) {
      expect(mark.page).toBeGreaterThanOrEqual(1);
      expect(mark.page).toBeLessThanOrEqual(pageCount);
      expect(mark.rPt).toBeGreaterThan(0);
      expect(mark.xPt - mark.rPt).toBeGreaterThanOrEqual(marginPt);
      expect(mark.xPt + mark.rPt).toBeLessThanOrEqual(widthPt - marginPt);
      expect(mark.yPt - mark.rPt).toBeGreaterThanOrEqual(marginPt);
      expect(mark.yPt + mark.rPt).toBeLessThanOrEqual(heightPt - marginPt);
    }
  });

  it('gives each question its own reader row, left to right by choice', async () => {
    const { formMap } = await renderer.render(sheet, { bank });
    const layout = new VirtualOmrReader().formLayout(formMap);
    expect(layout).toHaveLength(3);
    for (const row of layout) {
      expect(row.choices.map((c) => c.choice)).toEqual(['A', 'B', 'C', 'D']);
      expect(new Set(row.choices.map((c) => c.itemId)).size).toBe(1);
    }
  });

  it('grades through the virtual reader — a chosen bubble sets exactly one bit', async () => {
    const { formMap } = await renderer.render(sheet, { bank });
    const reader = new VirtualOmrReader({ logger: { info: () => {} } });
    const event = reader.scanSheet({ formMap, chosen: { q1: 'A', q2: 'C' }, blank: ['q3'] });
    expect(event.columns).toBe(3);
    expect(event.markedColumns).toBe(2);
    expect(event.marks).toEqual([0b0001, 0b0100, 0]);
  });

  it('is empty for a document with no bubbles', async () => {
    const { formMap } = await renderer.render(worksheet);
    expect(formMap.marks).toEqual([]);
  });
});

describe('answer keys', () => {
  const answers = { w1: '11/12' };

  it('never prints an answer on the learner copy', async () => {
    const { pdf } = await renderer.render(worksheet);
    expect(pdf.toString('latin1')).not.toContain('11/12');
  });

  it('renders the key as a SEPARATE document, marked as a key', async () => {
    const learner = await renderer.render(worksheet);
    const key = await renderer.render(worksheet, { answers });
    expect(key.pdf.equals(learner.pdf)).toBe(false);
    expect(key.isAnswerKey).toBe(true);
    expect(learner.isAnswerKey).toBe(false);
    expect(key.formMap.marks).toEqual([]);
  });

  it('lists every answered item on the key', async () => {
    const { keyItems } = await renderer.render(worksheet, { answers });
    expect(keyItems).toEqual([{ itemId: 'w1', number: 1, answer: '11/12' }]);
  });
});

describe('determinism', () => {
  it('renders byte-identical PDFs for the same document', async () => {
    const first = await renderer.render(worksheet, { studentName: 'learner-two' });
    const second = await renderer.render(worksheet, { studentName: 'learner-two' });
    expect(first.pdf.equals(second.pdf)).toBe(true);
    expect(first.formMap).toEqual(second.formMap);
  });

  it('pins CreationDate so two runs cannot differ by their timestamp', async () => {
    const { pdf } = await renderer.render(worksheet);
    // pdfkit writes the date as an indirect object referenced by /CreationDate.
    const raw = pdf.toString('latin1');
    expect(raw.match(/\(D:\d{14}Z?\)/g)).toEqual(['(D:19700101000000Z)']);
  });
});
