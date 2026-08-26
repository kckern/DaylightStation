/**
 * Slice H (2026-08-22) — audit-only notes must never reach a child's
 * receipt. A grown-up's sign-off note printed to Learner-Three under "NOTES FOR YOU"
 * read "Eraser signature: A erased, B (Kansas) chosen. Credited per the
 * leniency rule deployed in 0aed55c94." — a sentence written for the
 * RECORD, including a git SHA, landed in front of a 3rd-grader.
 *
 * The fix is structural, not a convention someone has to remember: a review
 * item now carries TWO note fields. `note` is what the parent wants the
 * child to read; `internalNote` is the record-only twin. `reviewNoteLines`
 * — the one function standing between the review queue and the "NOTES FOR
 * YOU" block on both the agenda and the result receipt — has no parameter
 * that could reach `internalNote`. It is not merely "unused"; there is no
 * way to plumb it through even by accident.
 */
import { describe, it, expect } from 'vitest';
import { reviewNoteLines, resultDocument } from '#domains/school/documents/receipts.mjs';

const AUDIT_TEXT = 'Eraser signature: A erased, B (Kansas) chosen. Credited per the leniency rule deployed in 0aed55c94.';
const CHILD_TEXT = 'Remember to find a common denominator first';

describe('reviewNoteLines reads only the child-facing note', () => {
  it('never surfaces internalNote, even when note is absent', () => {
    const lines = reviewNoteLines([
      {
        itemId: 'q1', questionNumber: 3, gradedAt: '2026-08-22T09:00:00.000Z',
        note: null, internalNote: AUDIT_TEXT,
      },
    ]);
    expect(lines).toEqual([]);
    expect(lines.join('\n')).not.toContain(AUDIT_TEXT);
    expect(lines.join('\n')).not.toContain('0aed55c94');
  });

  it('prints the child-facing note and drops the audit-only twin sitting right beside it', () => {
    const lines = reviewNoteLines([
      {
        itemId: 'q1', questionNumber: 3, gradedAt: '2026-08-22T09:00:00.000Z',
        note: CHILD_TEXT, internalNote: AUDIT_TEXT,
      },
    ]);
    expect(lines).toEqual([`Note: ${CHILD_TEXT} (3)`]);
    expect(lines.join('\n')).not.toContain(AUDIT_TEXT);
    expect(lines.join('\n')).not.toContain('0aed55c94');
  });

  it('a Slice-B eraser-leniency machine mark (internalNote only, no note) prints nothing', () => {
    // The exact shape RecordCardScanOutcome.mjs writes for a leniency-
    // credited row: gradedBy 'engine-leniency', a leniency marker, and an
    // audit-only internalNote — never a child-facing note.
    const machineMark = {
      itemId: 'q2', questionNumber: 2, gradedAt: '2026-08-22T09:05:00.000Z',
      note: null,
      internalNote: 'Eraser signature: marks ["B","D"], one correct — credited in full per the bounded eraser-leniency rule (spec §5.4).',
      gradedBy: 'engine-leniency', leniency: 'eraser',
    };
    expect(reviewNoteLines([machineMark])).toEqual([]);
  });
});

describe('the result receipt never carries an audit-only note (regression: Learner-Three, 2026-08-22)', () => {
  it('builds "NOTES FOR YOU" from reviewNoteLines\' pre-filtered output — an internalNote could not reach it even if handed in raw', () => {
    // This is exactly how CloseSessionOutcome wires it: `notes` on the
    // document is the ALREADY-FILTERED string array reviewNoteLines
    // produced, never the raw review-queue items.
    const notes = reviewNoteLines([
      {
        itemId: 'q1', questionNumber: 1, gradedAt: '2026-08-22T09:00:00.000Z',
        note: null, internalNote: AUDIT_TEXT,
      },
    ]);
    const doc = resultDocument({
      sessionId: 'ses_learner3', unitTitle: 'The United States', result: 'passed', percent: 100, notes,
    });
    const text = doc.blocks.filter((b) => b.type === 'rich_text').map((b) => b.md).join('\n');
    expect(text).not.toContain(AUDIT_TEXT);
    expect(text).not.toContain('0aed55c94');
    expect(text).not.toContain('NOTES FOR YOU');
  });

  it('a genuinely child-facing note still reaches the receipt', () => {
    const notes = reviewNoteLines([
      {
        itemId: 'q1', questionNumber: 1, gradedAt: '2026-08-22T09:00:00.000Z',
        note: CHILD_TEXT, internalNote: AUDIT_TEXT,
      },
    ]);
    const doc = resultDocument({
      sessionId: 'ses_learner3', unitTitle: 'The United States', result: 'passed', percent: 100, notes,
    });
    const text = doc.blocks.filter((b) => b.type === 'rich_text').map((b) => b.md).join('\n');
    expect(text).toContain('NOTES FOR YOU');
    expect(text).toContain(CHILD_TEXT);
    expect(text).not.toContain(AUDIT_TEXT);
  });
});
