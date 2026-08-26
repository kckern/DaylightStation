/**
 * Sibling of the ReceiptPrinting claim-tier fix (2026-08-25): PrinterSink read
 * `verified` as the only success tier, so a nightly report over a dispatched
 * but `unreadable` print would log/record it as an error even though paper
 * came out. Pinned here against a plain printer double.
 */
import { describe, it, expect, vi } from 'vitest';
import { PrinterSink } from './PrinterSink.mjs';

const SECTIONS = [{ title: 'Today', body: 'nothing much' }];

function quietLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function wire(printOutcome, logger = quietLogger()) {
  const renderer = { render: vi.fn(() => ({ items: [] })), renderText: vi.fn(() => 'text') };
  const printer = { print: vi.fn(async () => printOutcome) };
  const printerRegistry = { resolve: vi.fn(() => printer) };
  const sink = new PrinterSink({ renderer, printerRegistry, logger });
  return { sink, logger, printer };
}

describe('PrinterSink claim-tier mapping', () => {
  it('verified outcome is ok', async () => {
    const { sink } = wire({ dispatched: true, verified: true, verification: 'verified' });
    const result = await sink.emit(SECTIONS, { printer: 'kitchen' });
    expect(result).toEqual({ status: 'ok' });
  });

  it('dispatched with an UNREADABLE status is ok — silence is not failure', async () => {
    const { sink, logger } = wire({ dispatched: true, verified: false, verification: 'unreadable' });

    const result = await sink.emit(SECTIONS, { printer: 'kitchen' });

    expect(result).toEqual({ status: 'ok' });
    // Never logged as an error; still reaches the log store at info/warn.
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.debug).not.toHaveBeenCalled();
    const reachedStore = logger.info.mock.calls.length + logger.warn.mock.calls.length;
    expect(reachedStore).toBeGreaterThan(0);
  });

  it('dispatched with a DETECTED FAULT is an error', async () => {
    const { sink, logger } = wire({ dispatched: true, verified: false, verification: 'faulted', faults: ['cover_open'] });

    const result = await sink.emit(SECTIONS, { printer: 'kitchen' });

    expect(result).toEqual({ status: 'error' });
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('never dispatched is an error', async () => {
    const { sink } = wire({ dispatched: false, verified: false, verification: 'unreadable' });
    const result = await sink.emit(SECTIONS, { printer: 'kitchen' });
    expect(result).toEqual({ status: 'error' });
  });

  it('a bare true is back-compat ok', async () => {
    const { sink } = wire(true);
    const result = await sink.emit(SECTIONS, { printer: 'kitchen' });
    expect(result).toEqual({ status: 'ok' });
  });

  it('a bare false is an error', async () => {
    const { sink } = wire(false);
    const result = await sink.emit(SECTIONS, { printer: 'kitchen' });
    expect(result).toEqual({ status: 'error' });
  });
});
