import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import Keypad from './Keypad.jsx';

const screenOff = vi.hoisted(() => vi.fn());
const DaylightAPI = vi.hoisted(() => vi.fn());
const selfService = vi.hoisted(() => vi.fn());
const selfServiceError = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/fkb.js', () => ({ screenOff }));
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI }));
vi.mock('../schoolLog.js', () => ({
  schoolLog: { selfService, selfServiceError },
}));

const renderKeypad = (props = {}) => render(
  <Keypad onSubmit={vi.fn()} {...props} />,
);

describe('School self-service keypad screen off', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    screenOff.mockReset().mockReturnValue(true);
    DaylightAPI.mockReset().mockResolvedValue({ ok: true });
    selfService.mockClear();
    selfServiceError.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts HID keyboard digits, backspace, and an explicit Enter submit', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ resolved: true });
    renderKeypad({ onSubmit });
    for (const key of ['1', '2', '3', '4', '5', '6']) fireEvent.keyDown(window, { key });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Backspace' });
    fireEvent.keyDown(window, { key: '6' });
    // Enter submits immediately, ahead of the auto-submit settle timer, which
    // is never advanced in this test.
    await act(async () => { fireEvent.keyDown(window, { key: 'Enter' }); });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('123456');
  });

  it('requires two taps for the manual screen-off action', async () => {
    renderKeypad();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off screen' }));
    expect(screenOff).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tap again to turn off screen' })); });
    expect(screenOff).toHaveBeenCalledTimes(1);
    expect(DaylightAPI).not.toHaveBeenCalled();
    expect(selfService).toHaveBeenCalledWith('screen-off.succeeded', { source: 'manual', lever: 'fkb' });
  });

  it('keeps automatic sleep disabled by default', () => {
    renderKeypad();
    act(() => vi.advanceTimersByTime(60 * 60 * 1000));
    expect(screenOff).not.toHaveBeenCalled();
  });

  it('resets configured automatic sleep on keypad activity', async () => {
    renderKeypad({ screenOffTimeoutSeconds: 10 });
    act(() => vi.advanceTimersByTime(9000));
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    act(() => vi.advanceTimersByTime(9000));
    expect(screenOff).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screenOff).toHaveBeenCalledTimes(1);
    expect(selfService).toHaveBeenCalledWith('screen-off.succeeded', { source: 'idle', lever: 'fkb' });
  });

  it('suppresses automatic sleep while busy or a ceremony is visible', () => {
    const { rerender } = renderKeypad({ screenOffTimeoutSeconds: 1, busy: true });
    act(() => vi.advanceTimersByTime(2000));
    expect(screenOff).not.toHaveBeenCalled();

    rerender(<Keypad onSubmit={vi.fn()} screenOffTimeoutSeconds={1} screenOffSuppressed />);
    act(() => vi.advanceTimersByTime(2000));
    expect(screenOff).not.toHaveBeenCalled();
  });

  it('falls back to the registered screen REST control when the FKB bridge is unavailable', async () => {
    screenOff.mockReturnValue(false);
    renderKeypad({ screenId: 'portal' });
    fireEvent.click(screen.getByRole('button', { name: 'Turn off screen' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tap again to turn off screen' })); });
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/device/portal/screen/off');
    expect(screen.queryByText(/couldn't turn off/)).not.toBeInTheDocument();
    expect(selfService).toHaveBeenCalledWith('screen-off.succeeded', {
      source: 'manual', lever: 'api', deviceId: 'portal',
    });
  });

  it('uses the same REST fallback for configured idle sleep', async () => {
    screenOff.mockReturnValue(false);
    renderKeypad({ screenId: 'portal', screenOffTimeoutSeconds: 10 });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/device/portal/screen/off');
    expect(selfService).toHaveBeenCalledWith('screen-off.succeeded', {
      source: 'idle', lever: 'api', deviceId: 'portal',
    });
  });

  it('surfaces a REST failure instead of claiming the display turned off', async () => {
    screenOff.mockReturnValue(false);
    DaylightAPI.mockResolvedValue({ ok: false, error: 'screenOff failed' });
    renderKeypad({ screenId: 'portal' });
    fireEvent.click(screen.getByRole('button', { name: 'Turn off screen' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tap again to turn off screen' })); });
    expect(screen.getByText(/The screen couldn't turn off/)).toBeInTheDocument();
    expect(selfServiceError).toHaveBeenCalledWith('screen-off.failed', {
      source: 'manual', reason: 'api_rejected', deviceId: 'portal', error: 'screenOff failed',
    });
  });

  it('does not send a device command from standalone browser School', async () => {
    screenOff.mockReturnValue(false);
    renderKeypad({ screenId: 'browser' });
    fireEvent.click(screen.getByRole('button', { name: 'Turn off screen' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tap again to turn off screen' })); });
    expect(DaylightAPI).not.toHaveBeenCalled();
    expect(selfServiceError).toHaveBeenCalledWith('screen-off.failed', {
      source: 'manual', reason: 'no_screen_control',
    });
  });

  // The household moved to a plugged-in 2.4GHz USB-dongle keyboard, so the
  // retired "pair/turn on the Bluetooth keyboard" warning must be gone for
  // good — not just hidden by a condition — in every state the panel renders.
  it('never renders the retired bluetooth keyboard warning', () => {
    const assertNoBluetoothWarning = () => {
      expect(screen.queryByTestId('selfservice-keyboard-status')).not.toBeInTheDocument();
      expect(document.querySelector('.school-selfservice__keyboard')).toBeNull();
      expect(screen.queryByText(/bluetooth/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/keyboard/i)).not.toBeInTheDocument();
    };

    const { rerender } = renderKeypad();
    assertNoBluetoothWarning();

    rerender(<Keypad onSubmit={vi.fn()} busy />);
    assertNoBluetoothWarning();

    rerender(<Keypad
      onSubmit={vi.fn()}
      degraded
      message="Something broke. Try again."
      onRetry={vi.fn()}
    />);
    assertNoBluetoothWarning();
  });
});
