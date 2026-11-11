import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import Keypad from "./Keypad.jsx";

vi.mock("../../../../../frontend/src/lib/fkb.js", () => ({ screenOff: vi.fn() }));
vi.mock("../schoolLog.js", () => ({
  schoolLog: { selfService: vi.fn(), selfServiceDebug: vi.fn(), selfServiceError: vi.fn() },
}));
import { schoolLog } from "../schoolLog.js";

const jab = (name) => {
  const key = screen.getByRole('button', { name });
  fireEvent.pointerDown(key);
  fireEvent.click(key);
};
const typeCode = (code) => { for (const d of code) jab(d); };
const info = (event) => schoolLog.selfService.mock.calls.filter(([e]) => e === event);
const debug = (event) => schoolLog.selfServiceDebug.mock.calls.filter(([e]) => e === event);

describe('Keypad telemetry: refusal animation and retry', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
  afterEach(() => { vi.useRealTimers(); });

  it('logs reject-start (info) when a bad code starts the refusal, and reject-complete (debug) when it runs out', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ resolved: false, sentence: null, degraded: false });
    render(<Keypad onSubmit={onSubmit} />);
    typeCode('123456');
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(info('keypad.reject-start')).toHaveLength(1);
    expect(debug('keypad.reject-complete')).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(debug('keypad.reject-complete')).toHaveLength(1);
  });

  it('does not log reject-complete when a key cancels the refusal', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ resolved: false, sentence: null, degraded: false });
    render(<Keypad onSubmit={onSubmit} />);
    typeCode('123456');
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    jab('Clear');
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(debug('keypad.reject-complete')).toHaveLength(0);
  });

  it('logs reject-cancelled for a digit or backspace that interrupts the refusal', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ resolved: false, sentence: null, degraded: false });
    render(<Keypad onSubmit={onSubmit} />);
    typeCode('123456');
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    jab('7');
    expect(schoolLog.selfService).toHaveBeenCalledWith('keypad.reject-cancelled', { byKey: 'digit' });
  });

  it('logs retry when Try again is pressed in the degraded state', async () => {
    const onRetry = vi.fn();
    render(<Keypad onSubmit={vi.fn()} degraded sentence="Offline" onRetry={onRetry} />);
    const btn = screen.getByRole('button', { name: 'Try again' });
    fireEvent.pointerDown(btn);
    fireEvent.click(btn);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(info('keypad.retry')).toHaveLength(1);
  });

  it('never logs the code digits', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ resolved: false, sentence: null, degraded: false });
    render(<Keypad onSubmit={onSubmit} />);
    typeCode('123456');
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    const all = JSON.stringify([...schoolLog.selfService.mock.calls, ...schoolLog.selfServiceDebug.mock.calls]);
    expect(all).not.toContain('123456');
  });
});
