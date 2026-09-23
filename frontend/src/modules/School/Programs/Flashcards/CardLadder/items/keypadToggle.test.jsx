import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The on-screen keypad toggle is a last resort: a small icon in the item's
// corner, hidden once a physical keyboard is known. Keyboard presence is
// module state in lib/hardwareKeyboard.js (remembered per device), so every
// test loads a fresh copy of the modules.
vi.mock('../cardLadderAudio.js', () => ({ playClip: vi.fn(async () => true) }));

const langs = { target: 'ko', anchor: 'en', targetScript: 'hangul' };
const item = { id: 'k1', type: 'typed', task: '3.3', cue: { type: 'text', text: 'Scissors' }, assets: {} };

async function load(sides = langs) {
  vi.resetModules();
  const { default: TypedItem } = await import('./TypedItem.jsx');
  const { cardLadderLog } = await import('../cardLadderLog.js');
  const detected = vi.spyOn(cardLadderLog, 'keyboardDetected').mockImplementation(() => {});
  const toggled = vi.spyOn(cardLadderLog, 'keypadToggled').mockImplementation(() => {});
  const view = render(<TypedItem item={item} mode="graded" langs={sides} resolveAssetUrl={(x) => x} onRespond={() => {}} />);
  return { view, detected, toggled };
}
const toggle = () => screen.queryByRole('button', { name: /^(show|hide) keypad$/i });

// A touch panel: no fine pointer (a mouse would count as a keyboard).
const originalMatchMedia = window.matchMedia;
beforeEach(() => {
  window.localStorage.clear();
  delete window.__DAYLIGHT_DEVICE_ID;
  window.matchMedia = vi.fn((query) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { vi.useRealTimers(); window.localStorage.clear(); window.matchMedia = originalMatchMedia; });

describe('TypedItem keypad toggle — hardware keyboard heuristic', () => {
  it('renders as an icon with no text until a keyboard is known', async () => {
    await load();
    expect(toggle()).toHaveAccessibleName('Show keypad');
    expect(toggle()).toHaveTextContent(/^$/);
  });

  it('a real letter keydown hides it and logs keyboard.detected once per device', async () => {
    const { detected } = await load();
    const input = screen.getByRole('textbox');
    act(() => { fireEvent.keyDown(input, { key: 'a', code: 'KeyA', keyCode: 65 }); });
    expect(toggle()).toBeNull();
    expect(detected).toHaveBeenCalledTimes(1);
    act(() => { fireEvent.keyDown(input, { key: 'b', code: 'KeyB', keyCode: 66 }); });
    expect(detected).toHaveBeenCalledTimes(1);
  });

  it('an IME / soft-keyboard keydown (keyCode 229, Unidentified) does not hide it', async () => {
    await load();
    const input = screen.getByRole('textbox');
    act(() => { fireEvent.keyDown(input, { key: 'Unidentified', code: '', keyCode: 229 }); });
    act(() => { fireEvent.keyDown(input, { key: 'a', code: 'KeyA', keyCode: 229 }); });
    act(() => { fireEvent.keyDown(input, { key: 'Process', code: 'KeyA', isComposing: true }); });
    expect(toggle()).not.toBeNull();
  });

  it('the stored flag hides it on the next mount', async () => {
    window.localStorage.setItem('ds_hardware_keyboard', '1');
    await load();
    expect(toggle()).toBeNull();
  });

  it('never auto-opens the keypad once a keyboard is known', async () => {
    window.localStorage.setItem('ds_hardware_keyboard', '1');
    vi.useFakeTimers();
    await load();
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(screen.queryByTestId('jamo-keypad')).toBeNull();
  });

  it('still auto-opens on a touch panel with no keyboard known', async () => {
    vi.useFakeTimers();
    await load();
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByTestId('jamo-keypad')).toBeInTheDocument();
  });

  it('when hidden, a long-press on the field still opens the keypad (the heuristic can be wrong)', async () => {
    window.localStorage.setItem('ds_hardware_keyboard', '1');
    vi.useFakeTimers();
    const { toggled } = await load();
    const input = screen.getByRole('textbox');
    act(() => { fireEvent.pointerDown(input); });
    act(() => { vi.advanceTimersByTime(300); });
    act(() => { fireEvent.pointerUp(input); });
    expect(screen.queryByTestId('jamo-keypad')).toBeNull(); // a tap is not a long-press
    act(() => { fireEvent.pointerDown(input); });
    act(() => { vi.advanceTimersByTime(600); });
    expect(screen.getByTestId('jamo-keypad')).toBeInTheDocument();
    expect(toggled).toHaveBeenCalledWith({ auto: false, open: true, via: 'long-press' });
  });
});

describe('TypedItem keypad — keyed by the target script', () => {
  const generic = { target: 'en', anchor: 'en', targetScript: 'generic' };
  it('a target with no on-screen keypad shows no toggle, never auto-opens and ignores a long-press', async () => {
    vi.useFakeTimers();
    const { toggled } = await load(generic);
    expect(toggle()).toBeNull();
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.queryByTestId('jamo-keypad')).toBeNull();
    const input = screen.getByRole('textbox');
    act(() => { fireEvent.pointerDown(input); });
    act(() => { vi.advanceTimersByTime(600); });
    expect(screen.queryByTestId('jamo-keypad')).toBeNull();
    expect(toggled).not.toHaveBeenCalled();
    expect(input).toHaveAttribute('lang', 'en');
  });
});
