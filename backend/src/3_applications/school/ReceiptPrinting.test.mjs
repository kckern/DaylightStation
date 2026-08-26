/**
 * The seam where "the printer reported a fault" must not be confused with "the
 * printer reported nothing" (2026-08-25).
 *
 * `ReceiptPrinting` is the ONLY place that turns a printer's claim tier into
 * the `{printed, reason}` that a child is eventually told, so the whole mapping
 * is pinned here against a plain printer double — no sockets, no adapter.
 * `ReceiptPrinting.claimtier.test.mjs` (jest, alongside the adapter) runs the
 * same four outcomes through the REAL adapter and an injected transport.
 */
import { describe, it, expect, vi } from 'vitest';
import { ReceiptPrinting } from './ReceiptPrinting.mjs';

const quietLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

const DOCUMENT = { id: 'agenda-felix', target: ['receipt'] };

function wire(printOutcome, logger = quietLogger()) {
  const renderer = { render: vi.fn(async () => ({ items: [] })) };
  const printer = { print: vi.fn(async () => printOutcome) };
  return { receipts: new ReceiptPrinting({ renderer, printer, logger }), logger, renderer, printer };
}

describe('ReceiptPrinting claim-tier mapping', () => {
  it('verified is a print', async () => {
    const { receipts } = wire({ dispatched: true, verified: true, verification: 'verified' });
    expect(await receipts.print(DOCUMENT)).toEqual({ printed: true, reason: null });
  });

  it('dispatched with an UNREADABLE status is a print — silence is not failure', async () => {
    // The regression. Absence of confirmation is the normal case on this
    // hardware; reporting it as a failed print told children their worksheet
    // had not printed while it sat in the tray.
    const { receipts, logger } = wire({ dispatched: true, verified: false, verification: 'unreadable' });

    expect(await receipts.print(DOCUMENT)).toEqual({ printed: true, reason: 'unverified' });
    expect(logger.warn).toHaveBeenCalledWith('school.receipt.unverified', expect.anything());
  });

  it('dispatched with a DETECTED FAULT is not a print', async () => {
    const { receipts, logger } = wire({
      dispatched: true, verified: false, verification: 'faulted', faults: ['no_paper'],
    });

    expect(await receipts.print(DOCUMENT)).toEqual({ printed: false, reason: 'printer_fault' });
    expect(logger.warn).toHaveBeenCalledWith(
      'school.receipt.printer-fault', expect.objectContaining({ faults: ['no_paper'] }),
    );
  });

  it('never dispatched is a refusal', async () => {
    const { receipts } = wire({
      dispatched: false, verified: false, verification: 'faulted', faults: ['no_paper'],
    });
    expect(await receipts.print(DOCUMENT)).toEqual({ printed: false, reason: 'printer_refused' });
  });

  it('accepts a plain boolean printer surface', async () => {
    // Test doubles and any other printer that answers true/false keep working.
    expect(await wire(true).receipts.print(DOCUMENT)).toEqual({ printed: true, reason: null });
    expect(await wire(false).receipts.print(DOCUMENT))
      .toEqual({ printed: false, reason: 'printer_refused' });
  });

  it('treats a tier with no verification field as unreadable, not faulted', async () => {
    // A printer surface that predates the field asserts nothing about faults,
    // and inventing one out of its silence is the very error being fixed.
    const { receipts } = wire({ dispatched: true, verified: false });
    expect(await receipts.print(DOCUMENT)).toEqual({ printed: true, reason: 'unverified' });
  });

  it('a printer that throws is a printer_error, never a thrown scan', async () => {
    const logger = quietLogger();
    const renderer = { render: vi.fn(async () => ({ items: [] })) };
    const printer = { print: vi.fn(async () => { throw new Error('ECONNRESET'); }) };
    const receipts = new ReceiptPrinting({ renderer, printer, logger });

    expect(await receipts.print(DOCUMENT)).toEqual({ printed: false, reason: 'printer_error' });
  });

  it('reports not_wired and nothing_to_print without touching the printer', async () => {
    const printer = { print: vi.fn() };
    const unwired = new ReceiptPrinting({ renderer: null, printer, logger: quietLogger() });

    expect(await unwired.print(DOCUMENT)).toEqual({ printed: false, reason: 'not_wired' });
    expect(await unwired.print(null)).toEqual({ printed: false, reason: 'nothing_to_print' });
    expect(printer.print).not.toHaveBeenCalled();
  });
});
