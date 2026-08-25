import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import Keypad from './Keypad.jsx';

vi.mock('../../../lib/fkb.js', () => ({ screenOff: vi.fn() }));
vi.mock('../schoolLog.js', () => ({
  schoolLog: { selfService: vi.fn(), selfServiceError: vi.fn() },
}));

const renderKeypad = (props = {}) => render(
  <Keypad onSubmit={vi.fn()} {...props} />,
);

const pressDigits = (digits) => {
  for (const digit of digits) fireEvent.click(screen.getByRole('button', { name: digit }));
};

// Comfortably past AUTO_SUBMIT_SETTLE_MS (300ms in Keypad.jsx) so the settle
// timer has always fired by the time we assert.
const PAST_SETTLE_MS = 500;

describe('School self-service keypad auto-submit (no Go button)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/screens/portal');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ presence: { devices: [] } }),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, '', '/');
    vi.useRealTimers();
  });

  it('renders no Go button', () => {
    renderKeypad();
    expect(screen.queryByRole('button', { name: 'Go' })).not.toBeInTheDocument();
    expect(document.querySelector('.school-selfservice__go')).toBeNull();
  });

  it('submits exactly once after the sixth digit settles', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ resolved: true });
    renderKeypad({ onSubmit });
    pressDigits(['1', '2', '3', '4', '5', '6']);
    expect(onSubmit).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(PAST_SETTLE_MS); });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('123456');
    // Letting more time pass must not fire a second request for the same code.
    await act(async () => { await vi.advanceTimersByTimeAsync(PAST_SETTLE_MS); });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('does not submit on five digits', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ resolved: true });
    renderKeypad({ onSubmit });
    pressDigits(['1', '2', '3', '4', '5']);
    await act(async () => { await vi.advanceTimersByTimeAsync(PAST_SETTLE_MS); });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('backspacing from six to five and retyping submits the corrected code, not the original', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ resolved: true });
    renderKeypad({ onSubmit });
    pressDigits(['1', '2', '3', '4', '5', '6']);
    // Backspace WITHIN the settle window — the original code must never reach
    // onSubmit, irreversible or not.
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    fireEvent.click(screen.getByRole('button', { name: 'Backspace' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(PAST_SETTLE_MS); });
    expect(onSubmit).not.toHaveBeenCalled();

    pressDigits(['9']);
    await act(async () => { await vi.advanceTimersByTimeAsync(PAST_SETTLE_MS); });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('123459');
  });
});
