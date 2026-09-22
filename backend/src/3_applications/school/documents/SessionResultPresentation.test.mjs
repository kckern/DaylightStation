import { describe, it, expect } from 'vitest';
import { prepareSessionResultPresentation, prepareMachineScanResultPresentation } from './SessionResultPresentation.mjs';

describe('prepareSessionResultPresentation', () => {
  it('numbers ordinary review-queue items in order', () => {
    const session = {
      sessionId: 'ses_1', revision: 3, taxonomy: { lessonTitle: 'Illinois' },
      scores: { effective: { percent: 100, correctCount: 2, totalCount: 2 } },
      reviewEvidence: [
        { itemId: 'q1', questionNumber: 1, given: 'A', verdict: 'correct' },
        { itemId: 'q2', questionNumber: 2, given: 'B', verdict: 'correct' },
      ],
      state: { gradeAdjustments: [] },
    };
    const result = prepareSessionResultPresentation(session);
    expect(result.items).toEqual([
      { questionNumber: 1, given: 'A', verdict: 'correct' },
      { questionNumber: 2, given: 'B', verdict: 'correct' },
    ]);
  });

  /**
   * Whole-branch review finding #4: a `key-alignment-suspected` entry is
   * not a printed question (nothing was asked, nothing was answered — its
   * `questionNumber` is `null`). Mapping `reviewEvidence` unfiltered would
   * fabricate a phantom numbered row for it in this result view.
   */
  it('excludes a key-alignment-suspected entry and keeps the real questions numbered as if it were never there', () => {
    const session = {
      sessionId: 'ses_2', revision: 1, taxonomy: { lessonTitle: 'Science' },
      scores: { effective: { percent: 50, correctCount: 1, totalCount: 2 } },
      reviewEvidence: [
        { itemId: 'q1', questionNumber: 1, given: 'A', verdict: 'correct' },
        {
          itemId: 'key-alignment', reason: 'key-alignment-suspected', questionNumber: null,
          given: null, verdict: null,
        },
        { itemId: 'q2', questionNumber: 2, given: 'C', verdict: 'incorrect' },
      ],
      state: { gradeAdjustments: [] },
    };
    const result = prepareSessionResultPresentation(session);
    expect(result.items).toEqual([
      { questionNumber: 1, given: 'A', verdict: 'correct' },
      { questionNumber: 2, given: 'C', verdict: 'incorrect' },
    ]);
    expect(result.items).toHaveLength(2);
  });
});

describe('prepareMachineScanResultPresentation', () => {
  it('builds a machine-kind presentation straight off card.results', () => {
    const card = {
      results: [
        { itemId: 'q1', row: 1, given: 'A', status: 'correct' },
        { itemId: 'q2', row: 2, given: 'B', status: 'incorrect' },
      ],
    };
    const result = prepareMachineScanResultPresentation({ sessionId: 'ses_3', unitId: 'science', card });
    expect(result.kind).toBe('machine');
    expect(result.items).toEqual([
      { questionNumber: 1, given: 'A', verdict: 'correct' },
      { questionNumber: 2, given: 'B', verdict: 'incorrect' },
    ]);
  });
});
