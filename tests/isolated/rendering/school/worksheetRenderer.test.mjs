import { describe, it, expect } from 'vitest';
import { renderBankWorksheet } from '../../../../backend/src/1_rendering/school/WorksheetRenderer.mjs';

const bank = {
  title: 'US State Capitals',
  items: [
    { id: 'wa', type: 'multiple_choice', prompt: 'Capital of Washington?', answer: 'Olympia', choices: ['Seattle', 'Olympia', 'Spokane'] },
    { id: 'or', type: 'short_answer', prompt: 'Capital of Oregon?', answer: 'Salem' },
    { id: 'id', type: 'cloze', prompt: 'The capital of Idaho is ___.', answer: 'Boise' },
    { id: 'm', type: 'matching', prompt: 'Match state to capital', pairs: [{ left: 'WA', right: 'Olympia' }, { left: 'OR', right: 'Salem' }] },
  ],
};

describe('renderBankWorksheet', () => {
  it('produces a valid non-empty PDF with a page count', async () => {
    const { pdf, pageCount } = await renderBankWorksheet(bank, { studentName: 'Felix' });
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pageCount).toBeGreaterThanOrEqual(1);
  });

  it('does NOT leak answers into the worksheet text', async () => {
    // pdfkit writes text as PDF text-show operators; the literal answers must
    // not appear (choices legitimately include the correct option, so probe
    // an answer that is not also a rendered choice).
    const { pdf } = await renderBankWorksheet(bank);
    const raw = pdf.toString('latin1');
    expect(raw).not.toContain('Boise'); // cloze answer — never printed
    expect(raw).not.toContain('Salem'); // short-answer answer — never printed
  });

  it('paginates a large bank across multiple pages', async () => {
    const big = { title: 'Big', items: Array.from({ length: 40 }, (_, i) => ({ id: `q${i}`, type: 'short_answer', prompt: `Question ${i}?`, answer: 'x' })) };
    const { pageCount } = await renderBankWorksheet(big);
    expect(pageCount).toBeGreaterThan(1);
  });

  it('handles an empty bank without throwing (one title page)', async () => {
    const { pdf, pageCount } = await renderBankWorksheet({ title: 'Empty', items: [] });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pageCount).toBe(1);
  });
});
