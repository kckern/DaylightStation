import { describe, expect, it } from 'vitest';
import { auditAnswerSheets, planUnambiguousBackfill } from './answer-sheet-audit.mjs';

const record = (over = {}) => ({
  cardId: '1111111', recordId: 'r1', learnerId: 'user_4', sessionId: 's1',
  rowRange: { start: 1, end: 3 }, renderedAt: '2026-08-31T10:00:00.000Z',
  status: 'live', deliveryState: 'delivered', generation: 1,
  predecessorCardId: null, identiconVersion: 'v1', ...over,
});

describe('answer-sheet production audit', () => {
  it('blocks enforcement for delivered live worksheets on multiple card ids', () => {
    const cards = new Map([
      ['1111111', [record()]],
      ['2222222', [record({ cardId: '2222222', recordId: 'r2', generation: 2, predecessorCardId: '1111111' })]],
    ]);
    const report = auditAnswerSheets(cards, { now: new Date('2026-08-31T12:00:00.000Z') });
    expect(report.readyForEnforcement).toBe(false);
    expect(report.issues).toContainEqual(expect.objectContaining({
      type: 'multiple-live-cards', learnerId: 'user_4', cardIds: ['1111111', '2222222'],
    }));
  });

  it('backfills only an unambiguous one-learner chronology and flags mixed cards for manual reconciliation', () => {
    const cards = new Map([
      ['1111111', [record({ generation: undefined, identiconVersion: undefined })]],
      ['2222222', [record({ cardId: '2222222', recordId: 'r2', renderedAt: '2026-08-31T11:00:00.000Z', generation: undefined, identiconVersion: undefined })]],
      ['3333333', [record({ cardId: '3333333', recordId: 'r3', learnerId: 'other' }), record({ cardId: '3333333', recordId: 'r4' })]],
    ]);
    const plan = planUnambiguousBackfill(cards);
    expect(plan.changes).toEqual([
      { cardId: '1111111', generation: 1, predecessorCardId: null, identiconVersion: 'v1' },
      { cardId: '2222222', generation: 2, predecessorCardId: '1111111', identiconVersion: 'v1' },
    ]);
    expect(plan.manual).toContainEqual(expect.objectContaining({ cardId: '3333333' }));
  });
});
