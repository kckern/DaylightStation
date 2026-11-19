import { describe, it, expect, vi } from 'vitest';
import { render, renderHook } from '@testing-library/react';
import { useHotkey } from './useHotkey.js';

const press = (key, opts = {}) =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }));

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

  it('leaves handled, composing, and repeating keydowns to their current owner', () => {
    const fn = vi.fn();
    renderHook(() => useHotkey('/', fn));
    const handled = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
    handled.preventDefault();
    document.dispatchEvent(handled);
    expect(press('/', { altKey: true })).toBe(true);
    expect(press('/', { isComposing: true })).toBe(true);
    expect(press('/', { repeat: true })).toBe(true);
    expect(fn).not.toHaveBeenCalled();
  });

  it('does not take a launch shortcut from the focused modal', () => {
    const launch = vi.fn();
    const dismiss = vi.fn();
    renderHook(() => {
      useHotkey('/', launch);
      useHotkey('escape', dismiss);
    });
    const { getByRole } = render(<div role="dialog" aria-modal="true"><button>Cancel</button></div>);
    const button = getByRole('button', { name: 'Cancel' });
    button.focus();
    expect(button.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }))).toBe(true);
    expect(launch).not.toHaveBeenCalled();
    press('Escape');
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('cancels the default action only when the shortcut can handle it', () => {
    const action = vi.fn(() => false);
    renderHook(() => useHotkey('/', action));
    expect(press('/')).toBe(true);
    action.mockImplementation(() => undefined);
    expect(press('/')).toBe(false);
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('removes the listener on unmount', () => {
    const fn = vi.fn();
    const { unmount } = renderHook(() => useHotkey('mod+k', fn));
    unmount();
    press('k', { metaKey: true });
    expect(fn).not.toHaveBeenCalled();
  });
});
