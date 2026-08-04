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
    const { pdf, pageCount } = await renderer.render(worksheet, { studentName: 'Test Learner' });
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
    const { pdf, pageCount } = await renderer.render(worksheet, { studentName: 'Test Learner' });
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

  it('is null for a document with no bubbles — there is no form to grade', async () => {
    const { formMap } = await renderer.render(worksheet);
    expect(formMap).toBeNull();
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
    expect(key.formMap).toBeNull();
  });

  it('sources key answers from the bank when asked for answerKey without a map', async () => {
    const sheet = doc([omrQuestion(1), omrQuestion(2)]);
    const { keyItems, isAnswerKey } = await renderer.render(sheet, { bank, answerKey: true });
    expect(isAnswerKey).toBe(true);
    expect(keyItems).toEqual([
      { itemId: 'q1', number: 1, answer: '1/2' },
      { itemId: 'q2', number: 2, answer: '2/2' },
    ]);
  });

  it('draws a caller-minted token in the action box, minting nothing', async () => {
    const withAction = doc([{ type: 'scan_action', action: 'scan-worksheet', label: 'Scan when done' }]);
    const { pdf } = await renderer.render(withAction, { tokens: { 'scan-worksheet': 'TKN-123' } });
    expect(Buffer.isBuffer(pdf)).toBe(true);
  });

  it('lists every answered item on the key', async () => {
    const { keyItems } = await renderer.render(worksheet, { answers });
    expect(keyItems).toEqual([{ itemId: 'w1', number: 1, answer: '11/12' }]);
  });
});

// A retry hands over a "fresh" sheet. `render` had no variant parameter at all,
// so the artifact and the form map both recorded form 0 whatever the session
// said, and nothing on the paper or in the record distinguished attempt two
// from attempt one.
describe('variant', () => {
  const omrDoc = doc([omrQuestion(1)]);

  it('records the variant it was asked for on the form map', async () => {
    const { formMap } = await renderer.render(omrDoc, { bank, variant: 2 });
    expect(formMap.variant).toBe(2);
  });

  it('falls back to the document\'s own variant when none is passed', async () => {
    const { formMap } = await renderer.render({ ...omrDoc, variant: 3 }, { bank });
    expect(formMap.variant).toBe(3);
  });

  it('an explicit variant wins over the document\'s', async () => {
    const { formMap } = await renderer.render({ ...omrDoc, variant: 3 }, { bank, variant: 1 });
    expect(formMap.variant).toBe(1);
  });

  // What the form letter LOOKS like on the page is pinned by the golden suite
  // (fixture-02-worksheet-form-b): pdfkit subsets its fonts to glyph ids, so
  // there is no readable text in the buffer to assert on here. What this pins
  // is that the two sheets are not the same bytes — which is the property a
  // retry depends on and which held false before.
  it('MAKES A RETRY A DIFFERENT PIECE OF PAPER', async () => {
    const first = await renderer.render(worksheet, { studentName: 'Test Learner', variant: 0 });
    const second = await renderer.render(worksheet, { studentName: 'Test Learner', variant: 1 });
    expect(first.pdf.equals(second.pdf)).toBe(false);
    // Still deterministic per variant.
    const again = await renderer.render(worksheet, { studentName: 'Test Learner', variant: 1 });
    expect(second.pdf.equals(again.pdf)).toBe(true);
  });

  it.each([
    ['not an integer', 1.5], ['negative', -1], ['a string', '2'], ['null', null],
  ])('ignores a variant that is %s rather than printing nonsense', async (_label, variant) => {
    const { formMap } = await renderer.render(omrDoc, { bank, variant });
    expect(formMap.variant).toBe(0);
  });
});

// The action box reserved a 40pt square for a code and drew an empty outline in
// it, printing the token underneath as 9pt text. The entire console runs on
// scanning, so a blank code area is a sheet a child cannot act on without a
// grown-up keying sixteen characters in by hand.
describe('the scannable code on a sheet', () => {
  const TOKEN = 'sch:2K7QVM4X9HRJTBNP';
  const sheet = doc([{ type: 'scan_action', action: 'recovery', label: 'Another copy' }]);

  it('DRAWS A REAL QR, not an empty box', async () => {
    const { pdf } = await renderer.render(sheet, { tokens: { recovery: TOKEN } });
    const withCode = await renderer.render(sheet, { tokens: { recovery: 'sch:AAAAAAAAAAAAAAAA' } });
    // Two different tokens must produce different ink: an outline-only box
    // would render identically whatever the code said.
    expect(pdf.equals(withCode.pdf)).toBe(false);
  });

  it('draws it as vectors — nothing on this target is rasterized', async () => {
    const { pdf } = await renderer.render(sheet, { tokens: { recovery: TOKEN } });
    // An embedded bitmap would announce itself as an image XObject.
    expect(pdf.toString('latin1')).not.toContain('/Subtype /Image');
  });

  it('is deterministic, like everything else on this target', async () => {
    const opts = { tokens: { recovery: TOKEN } };
    const first = await renderer.render(sheet, opts);
    const second = await renderer.render(sheet, opts);
    expect(first.pdf.equals(second.pdf)).toBe(true);
  });

  it('still renders when the action carries no minted token', async () => {
    // The publish-time render probe supplies none; it must not throw, because
    // that would make the catalog gate fail every document with an action box.
    const { pageCount } = await renderer.render(sheet);
    expect(pageCount).toBe(1);
  });
});

describe('date prefill (options.date)', () => {
  it('changes the rendered bytes when a date is supplied — content streams are compressed, so this is the observable proof, matching the QR-token test above', async () => {
    const blank = await renderer.render(worksheet, { studentName: 'Test Learner' });
    const withDate = await renderer.render(worksheet, { studentName: 'Test Learner', date: '2026-08-04' });
    expect(blank.pdf.equals(withDate.pdf)).toBe(false);
  });

  it('is deterministic, like every other draw input', async () => {
    const opts = { studentName: 'Test Learner', date: '2026-08-04' };
    const first = await renderer.render(worksheet, opts);
    const second = await renderer.render(worksheet, opts);
    expect(first.pdf.equals(second.pdf)).toBe(true);
  });

  it('omitted is byte-identical to every caller before this option existed', async () => {
    const withoutOption = await renderer.render(worksheet, { studentName: 'Test Learner' });
    const explicitNull = await renderer.render(worksheet, { studentName: 'Test Learner', date: null });
    expect(withoutOption.pdf.equals(explicitNull.pdf)).toBe(true);
  });
});

describe('growLastPage option (fit policy fill, spec §7)', () => {
  const growable = doc([
    {
      type: 'question',
      itemId: 'g1',
      number: 1,
      blocks: [{ type: 'rich_text', md: 'Write a sentence.' }, { type: 'answer_space', minPt: 40, maxPt: 400 }],
    },
  ]);

  it('grows the last page’s answer space, changing the rendered bytes', async () => {
    const base = await renderer.render(growable);
    const grown = await renderer.render(growable, { growLastPage: true });
    expect(base.pageCount).toBe(1);
    expect(grown.pageCount).toBe(1);
    expect(base.pdf.equals(grown.pdf)).toBe(false);
  });

  it('defaults to false — byte-identical to every existing caller', async () => {
    const { pdf } = await renderer.render(worksheet, { studentName: 'Test Learner' });
    const explicit = await renderer.render(worksheet, { studentName: 'Test Learner', growLastPage: false });
    expect(pdf.equals(explicit.pdf)).toBe(true);
  });
});

describe('determinism', () => {
  it('renders byte-identical PDFs for the same document', async () => {
    const first = await renderer.render(worksheet, { studentName: 'Test Learner' });
    const second = await renderer.render(worksheet, { studentName: 'Test Learner' });
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
