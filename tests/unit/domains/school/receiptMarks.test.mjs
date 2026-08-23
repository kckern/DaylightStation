/**
 * Per-question mark boxes on the result receipt (regression, 2026-08-22): a
 * real child's sheet printed six tofu boxes for 6/6, and a 5/6 sheet always
 * blamed the LAST wrong-looking box regardless of which question was
 * actually missed. Half the fix is in the renderer (vector strokes, box N
 * reads its own `marks[N]`); this half proves the domain layer actually
 * THREADS per-question evidence onto the document — `resultDocument` accepts
 * a `marks` array and the block schema (`blocks.mjs`) accepts it as valid —
 * so the renderer has something honest to read in the first place.
 */
import { describe, it, expect } from 'vitest';
import { resultDocument } from '#domains/school/documents/receipts.mjs';
import { validateDocument } from '#domains/school/documents/documentValidation.mjs';

const valid = (doc) => {
  const { errors } = validateDocument(doc);
  expect(errors).toEqual([]);
  return doc;
};

const summaryOf = (doc) => doc.blocks.find((b) => b.type === 'result_summary');

describe('resultDocument threads per-question marks onto the result_summary block', () => {
  it('carries a marks array, one entry per question, when the caller has per-question evidence', () => {
    const doc = valid(resultDocument({
      sessionId: 'ses_1', unitTitle: 'Fractions', result: 'needs_remediation',
      correctCount: 5, totalCount: 6, questionStart: 7,
      marks: [false, true, true, true, true, true],
    }));
    expect(summaryOf(doc)).toMatchObject({
      correctCount: 5, totalCount: 6, questionStart: 7,
      marks: [false, true, true, true, true, true],
    });
  });

  it('omits marks entirely when the caller has none — no positional guess is invented here', () => {
    const doc = valid(resultDocument({
      sessionId: 'ses_1', unitTitle: 'Fractions', result: 'passed',
      correctCount: 6, totalCount: 6,
    }));
    expect(summaryOf(doc).marks).toBeUndefined();
  });

  it('omits marks when handed an empty array — never publishes a claim with nothing behind it', () => {
    const doc = valid(resultDocument({
      sessionId: 'ses_1', unitTitle: 'Fractions', result: 'passed',
      correctCount: 6, totalCount: 6, marks: [],
    }));
    expect(summaryOf(doc).marks).toBeUndefined();
  });
});

describe('the result_summary block schema validates marks', () => {
  const base = {
    type: 'result_summary', headline: 'PASSED', title: 'Fractions',
    correctCount: 5, totalCount: 6,
  };

  it('rejects a marks length that disagrees with totalCount — a mismatched roster must not reach paper looking authoritative', () => {
    const { errors } = validateDocument({
      id: 'r1', seed: 1, variant: 0, target: ['receipt'],
      blocks: [{ ...base, marks: [false, true, true] }],
    });
    expect(errors.some((e) => /marks/.test(e))).toBe(true);
  });

  it('rejects non-boolean entries', () => {
    const { errors } = validateDocument({
      id: 'r1', seed: 1, variant: 0, target: ['receipt'],
      blocks: [{ ...base, marks: [0, 1, 1, 1, 1, 1] }],
    });
    expect(errors.some((e) => /marks/.test(e))).toBe(true);
  });

  it('accepts a marks array whose length matches totalCount', () => {
    const { errors } = validateDocument({
      id: 'r1', seed: 1, variant: 0, target: ['receipt'],
      blocks: [{ ...base, marks: [false, true, true, true, true, true] }],
    });
    expect(errors).toEqual([]);
  });
});
