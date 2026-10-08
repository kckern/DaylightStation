import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSourceWaitSkipKeys, playerIsHitTarget, SKIP_DEBOUNCE_MS } from './useSourceWaitSkipKeys.js';

// A TV wait must be escapable with OK (Back is unreliable on the Shield) — but
// the listener is page-wide, so it must never eat a key it did not use.
const press = (key, target = window) => {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(ev);
  return ev;
};

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-07T12:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

describe('useSourceWaitSkipKeys', () => {
  it('OK (Enter / NumpadEnter) and media-next skip and are consumed', () => {
    for (const key of ['Enter', 'NumpadEnter', 'MediaTrackNext']) {
      const onSkip = vi.fn(() => true);
      const later = vi.fn();
      window.addEventListener('keydown', later);
      const { unmount } = renderHook(() => useSourceWaitSkipKeys({ active: true, onSkip }));
      const ev = press(key);
      expect(onSkip, key).toHaveBeenCalledTimes(1);
      expect(ev.defaultPrevented).toBe(true);
      expect(later, `${key} consumed`).not.toHaveBeenCalled();
      unmount();
      window.removeEventListener('keydown', later);
    }
  });

  it('D-pad, Tab and every other key are left alone (screen nav, overlay buttons, garage keys)', () => {
    const onSkip = vi.fn(() => true);
    const later = vi.fn();
    window.addEventListener('keydown', later);
    const { unmount } = renderHook(() => useSourceWaitSkipKeys({ active: true, onSkip }));
    for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'Tab', 'a', 'Escape']) press(key);
    expect(onSkip).not.toHaveBeenCalled();
    expect(later).toHaveBeenCalledTimes(6);
    unmount();
    window.removeEventListener('keydown', later);
  });

  it('a later-mounted capture listener still receives Enter when no wait is active', () => {
    const later = vi.fn();
    const { unmount } = renderHook(() => useSourceWaitSkipKeys({ active: false, onSkip: vi.fn() }));
    window.addEventListener('keydown', later, true);
    press('Enter');
    expect(later).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', later, true);
    unmount();
  });

  it('a no-op skip consumes nothing, and later keys still reach everyone', () => {
    const onSkip = vi.fn(() => false);
    const later = vi.fn();
    window.addEventListener('keydown', later);
    const { unmount } = renderHook(() => useSourceWaitSkipKeys({ active: true, onSkip }));
    const first = press('Enter');
    const second = press('Enter');
    expect(first.defaultPrevented).toBe(false);
    expect(second.defaultPrevented).toBe(false);
    expect(later).toHaveBeenCalledTimes(2);
    unmount();
    window.removeEventListener('keydown', later);
  });

  it('after a real skip, a repeat inside the debounce is absorbed; after the window it skips again', () => {
    const onSkip = vi.fn(() => true);
    const { unmount } = renderHook(() => useSourceWaitSkipKeys({ active: true, onSkip }));
    press('Enter');
    press('Enter');
    expect(onSkip).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(SKIP_DEBOUNCE_MS + 10);
    press('Enter');
    expect(onSkip).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('a held key repeating across an item change does not act on the next item', () => {
    const onSkip = vi.fn(() => true);
    const { rerender } = renderHook(({ active }) => useSourceWaitSkipKeys({ active, onSkip }), { initialProps: { active: true } });
    press('Enter');
    expect(onSkip).toHaveBeenCalledTimes(1);
    rerender({ active: false });
    rerender({ active: true }); // next item's wait
    const repeat = press('Enter');
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(repeat.defaultPrevented).toBe(true);
  });

  it('overlay suppressed (canConsume false) -> nothing is skipped or swallowed', () => {
    const onSkip = vi.fn(() => true);
    const later = vi.fn();
    window.addEventListener('keydown', later);
    const { unmount } = renderHook(() => useSourceWaitSkipKeys({ active: true, onSkip, canConsume: () => false }));
    const ev = press('Enter');
    expect(onSkip).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
    expect(later).toHaveBeenCalledTimes(1);
    unmount();
    window.removeEventListener('keydown', later);
  });

  it('two Players waiting: only the first consumes the key', () => {
    const a = vi.fn(() => true);
    const b = vi.fn(() => true);
    const ha = renderHook(() => useSourceWaitSkipKeys({ active: true, onSkip: a }));
    const hb = renderHook(() => useSourceWaitSkipKeys({ active: true, onSkip: b }));
    press('Enter');
    expect(a.mock.calls.length + b.mock.calls.length).toBe(1);
    ha.unmount(); hb.unmount();
  });

  it('a focused control elsewhere keeps its own Enter; focus inside the Player root or on body is ours', () => {
    const onSkip = vi.fn(() => true);
    const root = document.createElement('div');
    const inside = document.createElement('div');
    root.appendChild(inside);
    const outside = document.createElement('button');
    document.body.append(root, outside);
    const { unmount } = renderHook(() => useSourceWaitSkipKeys({ active: true, onSkip, rootRef: { current: root } }));
    press('Enter', outside);
    expect(onSkip).not.toHaveBeenCalled();
    vi.setSystemTime(Date.now() + 5000);
    press('Enter', inside);
    expect(onSkip).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 5000);
    press('Enter', document.body);
    expect(onSkip).toHaveBeenCalledTimes(2);
    unmount(); root.remove(); outside.remove();
  });

  it('does nothing when inactive, and leaves typing alone', () => {
    const onSkip = vi.fn(() => true);
    const { rerender } = renderHook(({ active }) => useSourceWaitSkipKeys({ active, onSkip }), { initialProps: { active: false } });
    press('Enter');
    expect(onSkip).not.toHaveBeenCalled();
    rerender({ active: true });
    const input = document.createElement('input');
    document.body.appendChild(input);
    press('Enter', input);
    expect(onSkip).not.toHaveBeenCalled();
    input.remove();
  });

  it('hold -> sleep -> OK: a shader over the Player makes it step aside so the wake listener gets OK', () => {
    const shell = document.createElement('div');
    const shader = document.createElement('div');
    document.body.append(shell, shader);
    shell.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });
    const orig = document.elementFromPoint;
    document.elementFromPoint = () => shader;
    const onSkip = vi.fn(() => true);
    const wake = vi.fn();
    const { unmount } = renderHook(() => useSourceWaitSkipKeys({
      active: true, onSkip, canConsume: () => playerIsHitTarget(shell),
    }));
    window.addEventListener('keydown', wake); // registered at sleep time, after the hold began
    const ev = press('Enter');
    expect(onSkip).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
    expect(wake).toHaveBeenCalledTimes(1);
    document.elementFromPoint = () => shell;
    expect(playerIsHitTarget(shell)).toBe(true);
    window.removeEventListener('keydown', wake);
    unmount(); document.elementFromPoint = orig; shell.remove(); shader.remove();
  });
});
