import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHotkey } from './useHotkey.js';

const press = (key, opts = {}) =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }));

describe('useHotkey', () => {
  it('fires on mod+k with metaKey or ctrlKey', () => {
    const fn = vi.fn();
    renderHook(() => useHotkey('mod+k', fn));
    press('k', { metaKey: true });
    press('k', { ctrlKey: true });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not fire without the modifier', () => {
    const fn = vi.fn();
    renderHook(() => useHotkey('mod+k', fn));
    press('k');
    expect(fn).not.toHaveBeenCalled();
  });

  it('suppresses plain-key hotkeys while typing in an input', () => {
    const fn = vi.fn();
    renderHook(() => useHotkey('/', fn));
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
    expect(fn).not.toHaveBeenCalled();
    input.remove();
  });

  it('escape fires even inside an input', () => {
    const fn = vi.fn();
    renderHook(() => useHotkey('escape', fn));
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(fn).toHaveBeenCalledTimes(1);
    input.remove();
  });

  it('removes the listener on unmount', () => {
    const fn = vi.fn();
    const { unmount } = renderHook(() => useHotkey('mod+k', fn));
    unmount();
    press('k', { metaKey: true });
    expect(fn).not.toHaveBeenCalled();
  });
});
