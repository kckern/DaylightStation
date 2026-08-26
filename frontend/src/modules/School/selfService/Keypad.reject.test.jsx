import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import Keypad, { REJECT_WORD } from './Keypad.jsx';

vi.mock('../../../lib/fkb.js', () => ({ screenOff: vi.fn() }));
vi.mock('../schoolLog.js', () => ({
  schoolLog: { selfService: vi.fn(), selfServiceError: vi.fn() },
}));

const PAST_SETTLE_MS = 500;

const entryText = () => screen.getByTestId('selfservice-entry').textContent;

const jab = (name) => {
  const key = screen.getByRole('button', { name });
  fireEvent.pointerDown(key);
  fireEvent.click(key);
};

const typeCode = (code) => { for (const d of code) jab(d); };

describe('School keypad refusal animation (NONONO)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('plays NONONO when auto-submit resolves an unrecognised code', async () => {
    const onSubmit = vi.fn().mockResolvedValue({
      resolved: false, sentence: 'Try again.', degraded: false,
    });
    render(<Keypad onSubmit={onSubmit} />);
    typeCode('123456');
    await act(async () => { await vi.advanceTimersByTimeAsync(PAST_SETTLE_MS); });
    expect(onSubmit).toHaveBeenCalledWith('123456');
    // The shake lands first, then the letters turn over one at a time.
    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
    expect(screen.getByTestId('selfservice-entry')).toHaveAttribute('data-state', 'rejected');
    expect(entryText()).toBe(REJECT_WORD);
  });

  it('plays NONONO for a refusal that carries no reason at all', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ resolved: false, sentence: null });
    render(<Keypad onSubmit={onSubmit} />);
    typeCode('999999');
    await act(async () => { await vi.advanceTimersByTimeAsync(PAST_SETTLE_MS + 1200); });
    expect(entryText()).toBe(REJECT_WORD);
  });

  it('a key held past the click-dedupe window does not cancel the refusal it just earned', async () => {
    // A wall-panel jab is pointerdown-then-click. `useTapFire` swallows the
    // click only within 700ms of its own pointerdown; a child who rests on the
    // last key longer than that produces a SECOND activation, which used to
    // arrive after auto-submit had already cleared the entry and started the
    // refusal.
    const onSubmit = vi.fn().mockResolvedValue({ resolved: false, sentence: 'Try again.' });
    render(<Keypad onSubmit={onSubmit} />);
    typeCode('12345');
    const last = screen.getByRole('button', { name: '6' });
    fireEvent.pointerDown(last);
    // Settle fires, the verdict lands, the refusal starts — all while the
    // finger is still down.
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(entryText()).toContain(REJECT_WORD[0]);
    fireEvent.click(last);          // the release, past the dedupe window
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByTestId('selfservice-entry')).toHaveAttribute('data-state', 'rejected');
  });

  it('a degraded verdict gets words, not the refusal animation', async () => {
    const onSubmit = vi.fn().mockResolvedValue({
      resolved: false, sentence: 'x', degraded: true,
    });
    render(<Keypad onSubmit={onSubmit} message="x" degraded onRetry={vi.fn()} />);
    typeCode('123456');
    await act(async () => { await vi.advanceTimersByTimeAsync(PAST_SETTLE_MS + 1200); });
    expect(screen.getByTestId('selfservice-entry')).toHaveAttribute('data-state', 'entry');
  });
});
