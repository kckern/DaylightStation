/**
 * The notice throttle (2026-11-21): children rescanning finished sheets and
 * cards printed 54 slip jobs in an afternoon. Notices are capped and an
 * identical slip is not reprinted; nothing else is touched.
 */
import { describe, it, expect, vi } from 'vitest';
import { ReceiptPrinting, receiptGuardFromConfig, DEFAULT_RECEIPT_GUARD } from './ReceiptPrinting.mjs';

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });
const notice = (id, line = 'Off you go') => ({ id: `notice-${id}`, target: ['receipt'], blocks: [{ type: 'text', text: line }] });

function wire({ outcome = { dispatched: true, verified: true, verification: 'verified' }, guard, start = 1_000_000 } = {}) {
  let now = start;
  const log = logger();
  const renderer = { render: vi.fn(async () => ({ printWith: (printer) => printer.print({ items: [] }) })) };
  const printer = { print: vi.fn(async () => outcome) };
  const receipts = new ReceiptPrinting({ renderer, printer, logger: log, guard, clock: () => now });
  return { receipts, printer, log, advance: (ms) => { now += ms; } };
}

describe('ReceiptPrinting notice guard', () => {
  it('does not reprint the same slip inside the repeat window', async () => {
    const { receipts, printer, advance } = wire();
    expect(await receipts.print(notice('launch-story-time'))).toEqual({ printed: true, reason: null });
    advance(60_000);
    expect(await receipts.print(notice('launch-story-time'))).toEqual({ printed: false, reason: 'repeat' });
    expect(printer.print).toHaveBeenCalledTimes(1);
    advance(DEFAULT_RECEIPT_GUARD.repeatWindowMs);
    expect((await receipts.print(notice('launch-story-time'))).printed).toBe(true);
  });

  it('same id with different words is a different slip', async () => {
    const { receipts, printer } = wire();
    await receipts.print(notice('launch-story-time', "Learner A: off you go"));
    expect((await receipts.print(notice('launch-story-time', "Learner B: off you go"))).printed).toBe(true);
    expect(printer.print).toHaveBeenCalledTimes(2);
  });

  it('two identical slips at the same moment print once', async () => {
    const { receipts, printer } = wire();
    const [a, b] = await Promise.all([receipts.print(notice('x')), receipts.print(notice('x'))]);
    expect([a.printed, b.printed].sort()).toEqual([false, true]);
    expect(printer.print).toHaveBeenCalledTimes(1);
  });

  it('caps notices per rolling hour and warns once per burst', async () => {
    const { receipts, printer, log, advance } = wire({ guard: { noticesPerHour: 3 } });
    for (let i = 0; i < 3; i += 1) expect((await receipts.print(notice(`n${i}`))).printed).toBe(true);
    expect(await receipts.print(notice('n3'))).toEqual({ printed: false, reason: 'throttled' });
    expect(await receipts.print(notice('n4'))).toEqual({ printed: false, reason: 'throttled' });
    expect(printer.print).toHaveBeenCalledTimes(3);
    expect(log.warn.mock.calls.filter(([e]) => e === 'school.receipt.throttled')).toHaveLength(1);
    advance(60 * 60 * 1000);
    expect((await receipts.print(notice('n5'))).printed).toBe(true);
  });

  it('never holds a document that is not a notice', async () => {
    const { receipts, printer } = wire({ guard: { noticesPerHour: 1 } });
    await receipts.print(notice('a'));
    const agenda = { id: 'agenda-learner_a', target: ['receipt'], blocks: [] };
    expect((await receipts.print(agenda)).printed).toBe(true);
    expect((await receipts.print(agenda)).printed).toBe(true);
    expect(printer.print).toHaveBeenCalledTimes(3);
  });

  it('a slip that did not come out spends nothing', async () => {
    const { receipts, printer } = wire({ outcome: { dispatched: false, verified: false, verification: 'unreadable' }, guard: { noticesPerHour: 1 } });
    await receipts.print(notice('a'));
    await receipts.print(notice('a'));
    expect(printer.print).toHaveBeenCalledTimes(2);
  });

  it('zero turns a guard off', async () => {
    const { receipts, printer } = wire({ guard: { repeatWindowMs: 0, noticesPerHour: 0 } });
    for (let i = 0; i < 20; i += 1) await receipts.print(notice('same'));
    expect(printer.print).toHaveBeenCalledTimes(20);
  });

  it('reads minutes and a cap from config, keeping defaults for bad values', () => {
    expect(receiptGuardFromConfig(null)).toEqual(DEFAULT_RECEIPT_GUARD);
    expect(receiptGuardFromConfig({ repeatMinutes: 5, noticesPerHour: 20 })).toEqual({ repeatWindowMs: 300_000, noticesPerHour: 20 });
    expect(receiptGuardFromConfig({ repeatMinutes: 'x', noticesPerHour: -1 })).toEqual(DEFAULT_RECEIPT_GUARD);
  });
});
