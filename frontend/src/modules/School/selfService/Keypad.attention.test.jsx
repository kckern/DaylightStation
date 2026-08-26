/**
 * What the keypad reports about the child in front of it, and what it does
 * when there isn't one. SchoolApp's burn-in flip is the consumer: it may never
 * throw the pad to the other half of the screen mid-interaction, and it may
 * never be starved of a flip by a code nobody came back for.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import Keypad from './Keypad.jsx';

vi.mock('../../../lib/fkb.js', () => ({ screenOff: vi.fn() }));
vi.mock('../schoolLog.js', () => ({
  schoolLog: { selfService: vi.fn(), selfServiceError: vi.fn() },
}));

const jab = (name) => {
  const key = screen.getByRole('button', { name });
  fireEvent.pointerDown(key);
  fireEvent.click(key);
};
const slots = () => [...document.querySelectorAll('.school-selfservice__slot')].map((el) => el.textContent);
const advance = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

describe('keypad attention signals', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('reports a touch anywhere on the panel, keys included', async () => {
    const onActivity = vi.fn();
    render(<Keypad onSubmit={vi.fn()} onActivity={onActivity} />);
    expect(onActivity).not.toHaveBeenCalled();
    jab('1');
    expect(onActivity).toHaveBeenCalled();
    onActivity.mockClear();
    // The HID keyboard counts too — a bonded BK-3001 is a hand at the panel.
    fireEvent.keyDown(window, { key: '2' });
    expect(onActivity).toHaveBeenCalled();
  });

  it('reports engaged for a code in progress, and released when it clears', async () => {
    const onEngagedChange = vi.fn();
    render(<Keypad onSubmit={vi.fn()} onEngagedChange={onEngagedChange} />);
    expect(onEngagedChange).toHaveBeenLastCalledWith(false);
    jab('1');
    expect(onEngagedChange).toHaveBeenLastCalledWith(true);
    jab('Clear');
    expect(onEngagedChange).toHaveBeenLastCalledWith(false);
  });

  it('reports engaged for a refusal still playing', async () => {
    const onEngagedChange = vi.fn();
    const onSubmit = vi.fn().mockResolvedValue({ resolved: false, sentence: 'Try again.' });
    render(<Keypad onSubmit={onSubmit} onEngagedChange={onEngagedChange} />);
    for (const d of '123456') jab(d);
    await advance(400);            // settle fires, verdict lands, NONONO starts
    expect(onEngagedChange).toHaveBeenLastCalledWith(true);
    await advance(3_000);          // shake + reveal + hold + wipe, all of it
    expect(onEngagedChange).toHaveBeenLastCalledWith(false);
  });

  it('releases the hold if the panel goes away mid-code', async () => {
    const onEngagedChange = vi.fn();
    const { unmount } = render(<Keypad onSubmit={vi.fn()} onEngagedChange={onEngagedChange} />);
    jab('1');
    expect(onEngagedChange).toHaveBeenLastCalledWith(true);
    unmount();
    expect(onEngagedChange).toHaveBeenLastCalledWith(false);
  });

  it('clears a half-typed code nobody came back for, and any touch restarts the clock', async () => {
    render(<Keypad onSubmit={vi.fn()} />);
    jab('1'); jab('2');
    await advance(50_000);
    expect(slots().slice(0, 2)).toEqual(['1', '2']);
    jab('3');                       // still here — the countdown starts over
    await advance(50_000);
    expect(slots().slice(0, 3)).toEqual(['1', '2', '3']);
    await advance(15_000);          // 65s since that last touch
    expect(slots().slice(0, 3)).toEqual(['', '', '']);
  });
});
