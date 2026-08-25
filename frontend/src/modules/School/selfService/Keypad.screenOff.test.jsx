import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import Keypad from './Keypad.jsx';

const screenOff = vi.hoisted(() => vi.fn());
const selfService = vi.hoisted(() => vi.fn());
const selfServiceError = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/fkb.js', () => ({ screenOff }));
vi.mock('../schoolLog.js', () => ({
  schoolLog: { selfService, selfServiceError },
}));

const renderKeypad = (props = {}) => render(
  <Keypad onSubmit={vi.fn()} {...props} />,
);

describe('School self-service keypad screen off', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/screens/portal');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ presence: { devices: [] } }),
    }));
    screenOff.mockReset().mockReturnValue(true);
    selfService.mockClear();
    selfServiceError.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, '', '/');
    vi.useRealTimers();
  });

  it('shows a green LED when the paired BK-3001 is connected', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ presence: { devices: [{ name: 'Bluetooth 5.1 Keyboard', connected: true }] } }),
    });
    renderKeypad();
    await act(async () => {});
    expect(screen.getByText('Keyboard connected')).toBeInTheDocument();
    expect(screen.getByTestId('selfservice-keyboard-status')).toHaveClass('is-connected');
  });

  it('accepts Bluetooth HID digits, backspace, and Enter', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ resolved: true });
    renderKeypad({ onSubmit });
    for (const key of ['1', '2', '3', '4', '5', '6']) fireEvent.keyDown(window, { key });
    expect(screen.getByRole('button', { name: 'Go' })).toBeEnabled();
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(screen.getByRole('button', { name: 'Go' })).toBeDisabled();
    fireEvent.keyDown(window, { key: '6' });
    await act(async () => { fireEvent.keyDown(window, { key: 'Enter' }); });
    expect(onSubmit).toHaveBeenCalledWith('123456');
  });

  it('requires two taps for the manual screen-off action', () => {
    renderKeypad();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off screen' }));
    expect(screenOff).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to turn off screen' }));
    expect(screenOff).toHaveBeenCalledTimes(1);
    expect(selfService).toHaveBeenCalledWith('screen-off.succeeded', { source: 'manual' });
  });

  it('keeps automatic sleep disabled by default', () => {
    renderKeypad();
    act(() => vi.advanceTimersByTime(60 * 60 * 1000));
    expect(screenOff).not.toHaveBeenCalled();
  });

  it('resets configured automatic sleep on keypad activity', () => {
    renderKeypad({ screenOffTimeoutSeconds: 10 });
    act(() => vi.advanceTimersByTime(9000));
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    act(() => vi.advanceTimersByTime(9000));
    expect(screenOff).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1000));
    expect(screenOff).toHaveBeenCalledTimes(1);
    expect(selfService).toHaveBeenCalledWith('screen-off.succeeded', { source: 'idle' });
  });

  it('suppresses automatic sleep while busy or a ceremony is visible', () => {
    const { rerender } = renderKeypad({ screenOffTimeoutSeconds: 1, busy: true });
    act(() => vi.advanceTimersByTime(2000));
    expect(screenOff).not.toHaveBeenCalled();

    rerender(<Keypad onSubmit={vi.fn()} screenOffTimeoutSeconds={1} screenOffSuppressed />);
    act(() => vi.advanceTimersByTime(2000));
    expect(screenOff).not.toHaveBeenCalled();
  });

  it('surfaces an unavailable FKB bridge instead of failing silently', () => {
    screenOff.mockReturnValue(false);
    renderKeypad();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off screen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to turn off screen' }));
    expect(screen.getByText(/The screen can't turn off here/)).toBeInTheDocument();
    expect(selfServiceError).toHaveBeenCalledWith('screen-off.failed', {
      source: 'manual', reason: 'fkb_unavailable',
    });
  });
});
