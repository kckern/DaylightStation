/**
 * "Did it print?" must not strand a child.
 *
 * The panel used to ask and wait FOREVER. A child who walked away left the
 * wall screen parked on one worksheet's question, which the next child then
 * answered about someone else's paper. Two things fix that, and both are
 * asserted here:
 *
 *  1. A ~15s countdown on the Yes affordance that resolves BY ITSELF, and
 *     resolves to YES — a printer that accepted the job and reports no fault
 *     almost certainly printed it, and "No" costs a wasted reprint.
 *  2. Asking the PRINTER rather than only the child. Per-job confirmation
 *     does not exist over JetDirect, but printer-level state does
 *     (`LaserPrinterAdapter#getStatus` → IPP `printer-state` /
 *     `printer-state-reasons`), so out-of-paper / jam / cover-open are all
 *     knowable. When one shows up mid-window the panel stops asking and says
 *     what is wrong.
 *
 * THE HARD CONSTRAINT, which the last test exists for: the confirmation may
 * never DEPEND on that poll. If the status call errors, 404s or hangs, the
 * child must be left exactly where they were before any of this — a plain
 * timer that still self-clears.
 *
 * Fake timers throughout: a real 15s wait exceeds vitest's default timeout,
 * and wall-clock assertions on this host (which runs the whole Docker fleet)
 * are flaky.
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  act: vi.fn(),
  resolve: vi.fn(),
  printerStatus: vi.fn(),
}));

vi.mock('../schoolApi.js', () => ({
  schoolApi: {
    selfServiceResolve: (...args) => h.resolve(...args),
    selfServiceAct: (...args) => h.act(...args),
    selfServicePrinterStatus: (...args) => h.printerStatus(...args),
  },
}));

vi.mock('../schoolLog.js', () => ({
  schoolLog: {
    selfService: vi.fn(), selfServiceError: vi.fn(), scan: vi.fn(),
  },
}));

import {
  useSelfService,
  PRINT_CONFIRM_TIMEOUT_MS,
  PRINTER_FAULT_SENTENCE,
} from './useSelfService.js';

const CARD = { ok: true, code: '123456', subject: 'math', actions: [{ kind: 'print', label: 'Print it' }] };
const okCard = () => ({ ok: true, status: 200, data: CARD });

/**
 * Drive the hook from the keypad through a successful print action. Does NOT
 * assert where it lands: the printer poll fires immediately on entering the
 * confirm view, so a printer that is ALREADY faulted moves the panel straight
 * past the question — which is the behaviour, not a failure.
 */
async function runPrint(result) {
  h.resolve.mockResolvedValue(okCard());
  h.act.mockResolvedValue({ ok: true, status: 200, data: { outcome: 'done', sentence: 'Printing.', transition: 'confirm-print' } });
  await act(async () => { await result.current.submit('123456'); });
  await act(async () => { await result.current.runAction({ kind: 'print' }); });
}

/** …and assert the panel is asking, for the cases where it should be. */
async function toConfirm(result) {
  await runPrint(result);
  expect(result.current.view).toBe('confirm');
}

describe('useSelfService: the print confirmation self-clears', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.act.mockReset();
    h.resolve.mockReset();
    h.printerStatus.mockReset();
    // Default: a healthy printer, so the plain-timer tests are not accidentally
    // driven by a fault.
    h.printerStatus.mockResolvedValue({
      ok: true, status: 200, data: { ok: true, healthy: true, state: 'idle', reasons: [], sentence: null },
    });
  });
  afterEach(() => { vi.useRealTimers(); });

  const mount = (opts) => renderHook(() => useSelfService({ idleTimeoutSeconds: 0, ...opts }));

  it('publishes a countdown while the confirm view is up, so the child can see time passing', async () => {
    const { result } = mount();
    await toConfirm(result);
    expect(result.current.confirmTotalMs).toBe(PRINT_CONFIRM_TIMEOUT_MS);
    expect(result.current.confirmRemainingMs).toBe(PRINT_CONFIRM_TIMEOUT_MS);

    await act(async () => { await vi.advanceTimersByTimeAsync(PRINT_CONFIRM_TIMEOUT_MS / 3); });
    expect(result.current.confirmRemainingMs).toBeLessThan(PRINT_CONFIRM_TIMEOUT_MS);
    expect(result.current.confirmRemainingMs).toBeGreaterThan(0);
  });

  it('auto-resolves to YES when the window expires with no input — back to the keypad, no reprint', async () => {
    const { result } = mount();
    await toConfirm(result);

    await act(async () => { await vi.advanceTimersByTimeAsync(PRINT_CONFIRM_TIMEOUT_MS + 1000); });

    expect(result.current.view).toBe('keypad');
    expect(result.current.card).toBeNull();
    // YES, emphatically: a "no" would have re-resolved the code for a reprint.
    expect(h.resolve).toHaveBeenCalledTimes(1);
  });

  it('a child who answers before the clock runs out is not overridden by it', async () => {
    const { result } = mount();
    await toConfirm(result);
    await act(async () => { await result.current.confirmPrint(true); });
    expect(result.current.view).toBe('keypad');

    // The expired timer must not reach back into a panel that has moved on.
    await act(async () => { await vi.advanceTimersByTimeAsync(PRINT_CONFIRM_TIMEOUT_MS * 2); });
    expect(result.current.view).toBe('keypad');
    expect(h.resolve).toHaveBeenCalledTimes(1);
  });

  it('the countdown is gone once the view is no longer the confirm', async () => {
    const { result } = mount();
    await toConfirm(result);
    await act(async () => { result.current.exit(); });
    expect(result.current.confirmRemainingMs).toBeNull();
  });
});

describe('useSelfService: the print confirmation consults the printer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.act.mockReset();
    h.resolve.mockReset();
    h.printerStatus.mockReset();
    h.printerStatus.mockResolvedValue({
      ok: true, status: 200, data: { ok: true, healthy: true, state: 'idle', reasons: [], sentence: null },
    });
  });
  afterEach(() => { vi.useRealTimers(); });

  const mount = (opts) => renderHook(() => useSelfService({ idleTimeoutSeconds: 0, ...opts }));

  it('stops asking and names the fault when the printer reports one', async () => {
    const { result } = mount();
    h.printerStatus.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ok: true, healthy: false, state: 'stopped', reasons: ['media-empty'],
        sentence: 'The printer is out of paper — tell a grown-up.',
      },
    });
    await runPrint(result);

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(result.current.view).toBe('sentence');
    expect(result.current.sentence).toBe('The printer is out of paper — tell a grown-up.');
  });

  it('uses its own words when the fault has no sentence of its own', async () => {
    const { result } = mount();
    h.printerStatus.mockResolvedValue({
      ok: true, status: 200, data: { ok: true, healthy: false, state: 'stopped', reasons: [], sentence: null },
    });
    await runPrint(result);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.sentence).toBe(PRINTER_FAULT_SENTENCE);
  });

  it('catches a fault that only appears partway through the window', async () => {
    const { result } = mount();
    await toConfirm(result);
    // First poll: healthy. Keep asking.
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.view).toBe('confirm');

    h.printerStatus.mockResolvedValue({
      ok: true,
      status: 200,
      data: { ok: true, healthy: false, state: 'stopped', reasons: ['media-jam'], sentence: 'The printer is jammed — tell a grown-up.' },
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(PRINT_CONFIRM_TIMEOUT_MS / 2); });

    expect(result.current.view).toBe('sentence');
    expect(result.current.sentence).toBe('The printer is jammed — tell a grown-up.');
  });

  it('a healthy printer never interrupts the question', async () => {
    const { result } = mount();
    await toConfirm(result);
    await act(async () => { await vi.advanceTimersByTimeAsync(PRINT_CONFIRM_TIMEOUT_MS - 1000); });
    expect(result.current.view).toBe('confirm');
  });

  // THE GUARDRAIL. A broken status check must never strand the child worse
  // than before this feature existed.
  it.each([
    ['a non-2xx response', async () => ({ ok: false, status: 404, data: null })],
    ['a thrown/network failure', async () => { throw new Error('offline'); }],
    ['a body with no verdict in it', async () => ({ ok: true, status: 200, data: {} })],
  ])('leaves the plain timer intact when the poll fails: %s', async (_label, impl) => {
    const { result } = mount();
    h.printerStatus.mockImplementation(impl);
    await toConfirm(result);

    // Still asking, not stranded on a fault message it could not have known.
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.view).toBe('confirm');

    // And the timer still fires, still yes.
    await act(async () => { await vi.advanceTimersByTimeAsync(PRINT_CONFIRM_TIMEOUT_MS + 1000); });
    expect(result.current.view).toBe('keypad');
    expect(h.resolve).toHaveBeenCalledTimes(1);
  });

  it('never polls the printer while the panel is not asking', async () => {
    const { result } = mount();
    h.resolve.mockResolvedValue(okCard());
    await act(async () => { await result.current.submit('123456'); });
    expect(result.current.view).toBe('card');
    await act(async () => { await vi.advanceTimersByTimeAsync(PRINT_CONFIRM_TIMEOUT_MS); });
    expect(h.printerStatus).not.toHaveBeenCalled();
  });
});
