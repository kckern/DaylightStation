import { beforeEach, describe, expect, it, vi } from 'vitest';
import { YamlHeldCardScanStore } from '#adapters/school/documents/YamlHeldCardScanStore.mjs';
import { ReviewHeldCardScan } from './ReviewHeldCardScan.mjs';

function harness() {
  const memory = new Map();
  const heldScanStore = new YamlHeldCardScanStore({
    directory: '/docs', now: () => '2026-08-31T12:00:00.000Z',
    io: {
      load: (file) => structuredClone(memory.get(file) ?? null),
      save: (file, value) => memory.set(file, structuredClone(value)),
    },
  });
  const source = {
    cardId: '8684155', recordId: 'math-record', learnerId: 'user_4', documentId: 'math', rev: 'r1',
    rowRange: { start: 1, end: 3 }, rowItems: [
      { row: 1, itemId: 'm1', itemType: 'multiple_choice' },
      { row: 2, itemId: 'm2', itemType: 'multiple_choice' },
      { row: 3, itemId: 'm3', itemType: 'multiple_choice' },
    ],
  };
  const target = {
    cardId: '9427608', recordId: 'scripture-record', learnerId: 'user_4', documentId: 'scripture', rev: 'r1',
    rowRange: { start: 10, end: 12 }, rowItems: [
      { row: 10, itemId: 's1', itemType: 'multiple_choice' },
      { row: 11, itemId: 's2', itemType: 'multiple_choice' },
      { row: 12, itemId: 's3', itemType: 'multiple_choice' },
    ],
  };
  const allocationStore = {
    findByCard: vi.fn(async (cardId) => (cardId === source.cardId ? [source] : [target])),
    quarantineRows: vi.fn(async (args) => ({ quarantineId: `${args.heldScanId}:1-3`, rows: args.rows })),
    clearQuarantine: vi.fn(async (args) => args),
  };
  const resolveCardScan = {
    execute: vi.fn(async ({ testId, answers, identityReview }) => ({
      results: [{
        ...target, cardId: testId, recordId: identityReview.targetRecordId,
        results: Object.entries(answers).map(([row, given]) => ({
          row: Number(row), itemId: `s${row}`, itemType: 'multiple_choice', status: 'correct', given,
        })),
      }],
    })),
  };
  const outcomeRecorder = { execute: vi.fn(async () => ({ recorded: true })) };
  const teacherGate = { assert: vi.fn() };
  const repository = { getPublished: vi.fn(async (id) => ({ title: id === 'math' ? 'Math worksheet' : 'Scripture worksheet' })) };
  const useCase = new ReviewHeldCardScan({
    heldScanStore, allocationStore, repository, resolveCardScan, teacherGate, outcomeRecorder,
    clock: () => new Date('2026-08-31T12:05:00.000Z'), logger: { info: vi.fn() },
  });
  return { useCase, heldScanStore, allocationStore, resolveCardScan, outcomeRecorder, teacherGate, source, target };
}

async function seed(h) {
  const saved = await h.heldScanStore.record({
    fingerprint: 'a'.repeat(64), state: 'held', evidence: {
      reason: 'multiple-delivered-live-answer-sheets', learnerId: 'user_4', rawCardId: '8684155',
      rawRows: [{ row: 1, marks: ['A'] }, { row: 3, marks: ['B', 'C'] }],
      decodedAnswers: { 1: 'A', 3: ['B', 'C'] }, activeCardIds: ['8684155', '9427608'],
      candidateWorksheets: [
        { ...h.source, renderedAt: '2026-08-31T10:00:00.000Z', identiconVersion: 'v1', itemTypes: ['multiple_choice', 'multiple_choice', 'multiple_choice'] },
        { ...h.target, renderedAt: '2026-08-31T11:00:00.000Z', identiconVersion: 'v1', itemTypes: ['multiple_choice', 'multiple_choice', 'multiple_choice'] },
      ],
    },
  });
  return saved.record.heldScanId;
}

describe('ReviewHeldCardScan', () => {
  let h;
  beforeEach(() => { h = harness(); });

  it('teacher-gates list/inspect and presents both deterministic identicons and titles', async () => {
    const heldScanId = await seed(h);
    const [item] = await h.useCase.list({ reviewerId: 'parent', pin: '1234' });
    expect(h.teacherGate.assert).toHaveBeenCalledWith(expect.objectContaining({ userId: 'parent', action: 'answer-sheet-review.list' }));
    expect(item.evidence.candidateWorksheets).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Math worksheet', identicon: expect.objectContaining({ size: 5 }) }),
      expect.objectContaining({ title: 'Scripture worksheet', identicon: expect.objectContaining({ size: 5 }) }),
    ]));
    expect((await h.useCase.inspect({ heldScanId, reviewerId: 'parent', pin: '1234' })).heldScanId).toBe(heldScanId);
  });

  it('reassigns ordinally without compacting blanks or multiple marks and records full provenance', async () => {
    const heldScanId = await seed(h);
    const result = await h.useCase.resolve({
      heldScanId, action: 'reassign', targetRecordId: h.target.recordId,
      reviewerId: 'parent', pin: '1234', idempotencyKey: 'reassign-1',
    });
    expect(h.resolveCardScan.execute).toHaveBeenCalledWith(expect.objectContaining({
      testId: '9427608', answers: { 10: 'A', 12: ['B', 'C'] },
      identityReview: expect.objectContaining({ action: 'reassign', targetRecordId: 'scripture-record' }),
    }));
    expect(h.allocationStore.quarantineRows).toHaveBeenCalledWith(expect.objectContaining({
      cardId: '8684155', rows: { start: 1, end: 3 }, reason: 'manual-wrong-card-reassignment',
    }));
    expect(result.review.provenance).toMatchObject({
      kind: 'manual-wrong-card-reassignment',
      source: { cardId: '8684155', rows: { start: 1, end: 3 } },
      target: { cardId: '9427608', recordId: 'scripture-record' },
      mapping: [
        { fromRow: 1, toRow: 10, marks: ['A'] },
        { fromRow: 2, toRow: 11, marks: null },
        { fromRow: 3, toRow: 12, marks: ['B', 'C'] },
      ],
    });
    expect(h.outcomeRecorder.execute.mock.calls[0][0].card.manualReviewProvenance.kind)
      .toBe('manual-wrong-card-reassignment');
  });

  it('confirms only a worksheet on the scanned card and replays it with review provenance', async () => {
    const heldScanId = await seed(h);
    const args = {
      heldScanId, action: 'confirm', targetRecordId: h.source.recordId,
      reviewerId: 'parent', pin: '1234', idempotencyKey: 'confirm-1',
    };
    const first = await h.useCase.resolve(args);
    const duplicate = await h.useCase.resolve(args);
    expect(h.resolveCardScan.execute).toHaveBeenCalledWith(expect.objectContaining({
      testId: '8684155', answers: { 1: 'A', 3: ['B', 'C'] },
    }));
    expect(first.review.provenance.kind).toBe('manual-held-scan-confirmation');
    expect(duplicate.duplicate).toBe(true);
    expect(h.outcomeRecorder.execute).toHaveBeenCalledTimes(1);
    expect(h.allocationStore.quarantineRows).not.toHaveBeenCalled();
  });

  it('redo creates no grade, quarantines the source window, and repeated idempotency keys are no-ops', async () => {
    const heldScanId = await seed(h);
    const args = {
      heldScanId, action: 'redo', reviewerId: 'parent', pin: '1234', idempotencyKey: 'redo-1',
    };
    const first = await h.useCase.resolve(args);
    const second = await h.useCase.resolve(args);
    expect(first.review).toMatchObject({ action: 'redo', gradeCreated: false, terminal: true });
    expect(second.duplicate).toBe(true);
    expect(h.resolveCardScan.execute).not.toHaveBeenCalled();
    expect(h.outcomeRecorder.execute).not.toHaveBeenCalled();
    expect(h.allocationStore.quarantineRows).toHaveBeenCalledTimes(1);
  });

  it('serializes competing terminal actions before either can create a second side effect', async () => {
    const heldScanId = await seed(h);
    const [confirm, redo] = await Promise.allSettled([
      h.useCase.resolve({
        heldScanId, action: 'confirm', targetRecordId: h.source.recordId,
        reviewerId: 'parent', pin: '1234', idempotencyKey: 'race-confirm',
      }),
      h.useCase.resolve({
        heldScanId, action: 'redo', reviewerId: 'parent', pin: '1234', idempotencyKey: 'race-redo',
      }),
    ]);
    expect(confirm.status).toBe('fulfilled');
    expect(redo.status).toBe('rejected');
    expect(redo.reason.code).toBe('HELD_SCAN_ALREADY_RESOLVED');
    expect(h.outcomeRecorder.execute).toHaveBeenCalledTimes(1);
    expect(h.allocationStore.quarantineRows).not.toHaveBeenCalled();
  });

  it('rejects companion-gated reassignment before replay', async () => {
    const heldScanId = await seed(h);
    h.target.rowItems[1].itemType = 'companion_code';
    await expect(h.useCase.resolve({
      heldScanId, action: 'reassign', targetRecordId: h.target.recordId,
      reviewerId: 'parent', pin: '1234', idempotencyKey: 'gate-1',
    })).rejects.toThrow(/companion-gated/);
    expect(h.resolveCardScan.execute).not.toHaveBeenCalled();
  });

  it('rejects reassignment when more than one source allocation can own the marked window', async () => {
    const heldScanId = await seed(h);
    const held = await h.heldScanStore.get(heldScanId);
    held.evidence.candidateWorksheets.push({
      ...h.source, recordId: 'ambiguous-source',
      itemTypes: ['multiple_choice', 'multiple_choice', 'multiple_choice'],
    });
    const memoryRecord = await h.heldScanStore.findByFingerprint('a'.repeat(64));
    // The adapter intentionally exposes no arbitrary update. Seed a second
    // held case whose immutable evidence contains the ambiguity instead.
    const ambiguous = await h.heldScanStore.record({
      fingerprint: 'b'.repeat(64), state: 'held', evidence: held.evidence,
    });
    expect(memoryRecord.heldScanId).toBe(heldScanId);

    await expect(h.useCase.resolve({
      heldScanId: ambiguous.record.heldScanId, action: 'reassign', targetRecordId: h.target.recordId,
      reviewerId: 'parent', pin: '1234', idempotencyKey: 'ambiguous-source-1',
    })).rejects.toThrow(/not unambiguous/);
    expect(h.resolveCardScan.execute).not.toHaveBeenCalled();
    expect(h.allocationStore.quarantineRows).not.toHaveBeenCalled();
  });

  it('teacher-gates quarantine clearance and passes through only the explicit clearance method', async () => {
    await expect(h.useCase.clearQuarantine({
      cardId: '8684155', quarantineId: 'held:1-3', method: 'verified-erased',
      reviewerId: 'parent', pin: '1234',
    })).resolves.toMatchObject({ method: 'verified-erased', reviewerId: 'parent' });
    expect(h.teacherGate.assert).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'parent', action: 'answer-sheet-review.clear-quarantine',
    }));
    expect(h.allocationStore.clearQuarantine).toHaveBeenCalledWith(expect.objectContaining({
      cardId: '8684155', quarantineId: 'held:1-3', method: 'verified-erased', reviewerId: 'parent',
    }));
  });
});
