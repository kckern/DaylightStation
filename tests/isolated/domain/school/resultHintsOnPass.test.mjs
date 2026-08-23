/**
 * A MISS NAMED IN A BOX MUST BE NAMED IN WORDS TOO.
 *
 * Felix scored 9 of 10 (2026-08-23). The score panel correctly drew question
 * 15 as the miss — and the receipt then said nothing at all about it, because
 * `reviewHints` was gated on `!passed`. He was shown WHICH question he got
 * wrong and denied the one line telling him what to go read about it. The
 * hints were computed, threaded in, and discarded at the last step.
 *
 * Passing changes the urgency, not the entitlement: the heading distinguishes
 * "before you retry" from "worth a second look", and nothing else does.
 */
import { describe, it, expect } from 'vitest';
import { resultDocument } from '#domains/school/documents/receipts.mjs';

const HINT = '15: review page 12 · midwest farming.';
const summary = (document) => document.blocks.find((b) => b.type === 'result_summary');

const build = (over = {}) => resultDocument({
  sessionId: 'ses_f6Buxumv',
  unitTitle: 'The Midwestern States',
  result: 'passed',
  percent: 90,
  correctCount: 9,
  totalCount: 10,
  questionStart: 7,
  passingPercent: 80,
  hints: [HINT],
  ...over,
});

describe('review hints on a PASSED result', () => {
  it('carries the hint for the question that was missed', () => {
    expect(summary(build()).reviewHints).toEqual([HINT]);
  });

  it('heads them "worth a second look", never "before you retry" — a pass has no retry', () => {
    expect(summary(build()).reviewHeading).toBe('WORTH A SECOND LOOK');
  });

  it('still says "before you retry" on a failure', () => {
    const document = build({ result: 'needs_remediation', percent: 40, correctCount: 4 });
    expect(summary(document).reviewHints).toEqual([HINT]);
    expect(summary(document).reviewHeading).toBe('REVIEW BEFORE YOU RETRY');
  });

  it('carries no hint block at all for a clean sweep', () => {
    const document = build({ percent: 100, correctCount: 10, hints: [] });
    expect(summary(document).reviewHints).toBeUndefined();
    expect(summary(document).reviewHeading).toBeUndefined();
  });

  it('ignores blank hint entries rather than printing an empty row', () => {
    const document = build({ hints: ['', '   ', null] });
    expect(summary(document).reviewHints).toBeUndefined();
  });

  it('does NOT append the retry objectives list to a pass — that is retry prep', () => {
    const document = build({ hints: [], objectives: ['Name the Midwestern states.'] });
    const text = document.blocks.map((b) => String(b.md ?? '')).join('\n');
    expect(text).not.toContain('REVIEW BEFORE YOU RETRY');
    expect(text).not.toContain('Name the Midwestern states.');
  });

  it('still offers the objectives list on a failure with no per-item hints', () => {
    const document = build({
      result: 'needs_remediation', percent: 40, correctCount: 4, hints: [],
      objectives: ['Name the Midwestern states.'],
    });
    const text = document.blocks.map((b) => String(b.md ?? '')).join('\n');
    expect(text).toContain('REVIEW BEFORE YOU RETRY');
    expect(text).toContain('Name the Midwestern states.');
  });
});
