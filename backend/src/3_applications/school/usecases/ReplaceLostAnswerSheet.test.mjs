import { describe, it, expect, vi } from 'vitest';
import { ReplaceLostAnswerSheet } from './ReplaceLostAnswerSheet.mjs';

const live = (overrides = {}) => ({
  recordId: 'civilization/doc@abcdef123:v0:1-6', cardId: '1234567',
  rowRange: { start: 1, end: 6 }, documentId: 'civilization/doc', rev: 'abcdef123',
  seed: 1, variant: 0, learnerId: 'learner3', sessionId: 'ws-1', status: 'live',
  ...overrides,
});

function harness({ printFails = false, renderDuplex } = {}) {
  const records = [live(), live({
    recordId: 'math/doc@abcdef123:v0:7-12', documentId: 'math/doc',
    rowRange: { start: 7, end: 12 }, sessionId: 'ws-2', status: 'satisfied',
  })];
  const allocationStore = {
    findByCard: vi.fn(async () => records),
    markRecordLost: vi.fn(async (args) => args),
    release: vi.fn(async () => []),
  };
  const printDocuments = { getPublished: vi.fn(async (id, rev) => ({ id, rev, seed: 1, variant: 0 })) };
  const renderPrintDocument = {
    execute: vi.fn(async () => ({
      bytes: Buffer.from('%PDF'),
      allocation: { cardId: '7654321', recordId: 'new-record', rowRange: { start: 1, end: 6 } },
      ...(renderDuplex === undefined ? {} : { duplex: renderDuplex }),
    })),
  };
  const printer = { printPdf: printFails ? vi.fn(async () => { throw new Error('jam'); }) : vi.fn(async () => {}) };
  const teacherGate = { assert: vi.fn() };
  const useCase = new ReplaceLostAnswerSheet({
    allocationStore, printDocuments, renderPrintDocument, printer, teacherGate,
    clock: () => new Date('2026-08-13T12:00:00.000Z'), logger: { info: vi.fn(), warn: vi.fn() },
  });
  return { useCase, allocationStore, printDocuments, renderPrintDocument, printer, teacherGate };
}

describe('ReplaceLostAnswerSheet', () => {
  it('reprints only live work, then supersedes the old allocation', async () => {
    const h = harness();
    const result = await h.useCase.execute({ cardId: '1234567', reportedBy: 'kckern', pin: '4321' });
    expect(h.teacherGate.assert).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'kckern', pin: '4321', action: 'answer-sheet.replace-lost',
    }));
    expect(h.printDocuments.getPublished).toHaveBeenCalledTimes(1);
    expect(h.printer.printPdf).toHaveBeenCalledTimes(1);
    expect(h.allocationStore.markRecordLost).toHaveBeenCalledWith(expect.objectContaining({
      cardId: '1234567', replacementCardId: '7654321', replacementRecordId: 'new-record',
    }));
    expect(result).toMatchObject({ status: 'replaced', replacementCardId: '7654321', learnerId: 'learner3' });
  });

  // The replacement sheet has to be folded the way it was DRAWN. A quiz's
  // punch gutter is fixed to the left of every page; printed double-sided,
  // facing pages' margins land on opposite edges of one sheet and punching the
  // stack eats the versos.
  it('prints the replacement with the duplex the render reported', async () => {
    const h = harness({ renderDuplex: false });
    await h.useCase.execute({ cardId: '1234567', reportedBy: 'kckern', pin: '4321' });
    expect(h.printer.printPdf).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ duplex: false }),
    );
  });

  it('leaves duplex to the adapter default when the render reports none (v1 legacy)', async () => {
    const h = harness();
    await h.useCase.execute({ cardId: '1234567', reportedBy: 'kckern', pin: '4321' });
    expect(h.printer.printPdf.mock.calls[0][1].duplex).toBeUndefined();
  });

  it('does not retire the old allocation when printing fails', async () => {
    const h = harness({ printFails: true });
    const result = await h.useCase.execute({ cardId: '1234567', reportedBy: 'kckern', pin: '4321' });
    expect(result.status).toBe('print_failed');
    expect(h.allocationStore.markRecordLost).not.toHaveBeenCalled();
    expect(h.allocationStore.release).toHaveBeenCalled();
  });

  it('accepts a previously authorized one-use QR without checking the PIN again', async () => {
    const h = harness();
    await h.useCase.execute({ cardId: '1234567', reportedBy: 'kckern', authorized: true });
    expect(h.teacherGate.assert).not.toHaveBeenCalled();
  });
});
