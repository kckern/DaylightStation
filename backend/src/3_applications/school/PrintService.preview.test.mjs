/**
 * previewPrintable (debt M6a) — an approver needs to see the sheet before
 * saying yes. This is a READ-ONLY render: no quota check, no print job, no
 * print-log append, no pending-queue write. Same #resolve the print path
 * uses, so the preview is byte-identical to what would actually print.
 */
import { describe, it, expect, vi } from 'vitest';
import { PrintService } from './PrintService.mjs';
import { EntityNotFoundError } from '#domains/core/errors/index.mjs';

const PDF_BYTES = Buffer.from('%PDF-1.7 fake');

function makeService({ printables = [] } = {}) {
  const ds = {
    readPrintPending: () => [],
    savePrintPending: vi.fn(),
    appendPrintLog: vi.fn(),
    readPrintLog: () => [],
  };
  const printerAdapter = { printPdf: vi.fn() };
  const svc = new PrintService({
    config: { printables },
    datastore: ds,
    printerAdapter,
    worksheetRenderer: { renderBankWorksheet: vi.fn(async () => ({ pdf: PDF_BYTES, pageCount: 2 })) },
    bankReader: { getBank: (id) => (id === 'state-capitals' ? { id } : null) },
    pdfReader: { read: (file) => (file === 'maze.pdf' ? { pdf: PDF_BYTES, pageCount: 1 } : null) },
    userService: { getHouseholdRoster: () => [] },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    now: () => Date.parse('2026-08-07T10:00:00.000Z'),
  });
  return { svc, ds, printerAdapter };
}

describe('PrintService.previewPrintable', () => {
  it('resolves a bank printable to {pdf, label} with no student name', async () => {
    const { svc } = makeService({ printables: [{ id: 'caps', label: 'State Capitals', type: 'bank', bankId: 'state-capitals' }] });
    const out = await svc.previewPrintable('caps');
    expect(out).toEqual({ pdf: PDF_BYTES, label: 'State Capitals' });
  });

  it('resolves a pdf printable the same way', async () => {
    const { svc } = makeService({ printables: [{ id: 'maze', label: 'Maze', type: 'pdf', file: 'maze.pdf' }] });
    const out = await svc.previewPrintable('maze');
    expect(out).toEqual({ pdf: PDF_BYTES, label: 'Maze' });
  });

  it('unknown printableId throws EntityNotFoundError', async () => {
    const { svc } = makeService({ printables: [] });
    await expect(svc.previewPrintable('nope')).rejects.toThrow(EntityNotFoundError);
  });

  it('never touches the printer, the print log, or the pending queue', async () => {
    const { svc, ds, printerAdapter } = makeService({ printables: [{ id: 'caps', label: 'State Capitals', type: 'bank', bankId: 'state-capitals' }] });
    await svc.previewPrintable('caps');
    expect(printerAdapter.printPdf).not.toHaveBeenCalled();
    expect(ds.appendPrintLog).not.toHaveBeenCalled();
    expect(ds.savePrintPending).not.toHaveBeenCalled();
  });
});
