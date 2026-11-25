// frontend/src/lib/ui/keyboardModality.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The module keeps document-level state, so each test gets a fresh copy.
let mod;
beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  vi.resetModules();
  mod = await import('./keyboardModality.js');
});
afterEach(() => vi.useRealTimers());

const key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

describe('keyboardModality', () => {
  it('is false before anything happens', () => {
    expect(mod.focusCameFromTab()).toBe(false);
  });

  it('is true right after a Tab keydown and false for other keys', () => {
    mod.trackKeyboardModality();
    key('Tab');
    expect(mod.focusCameFromTab()).toBe(true);
    key('Escape');
    expect(mod.focusCameFromTab()).toBe(false);
  });

  it('expires after one second', () => {
    mod.trackKeyboardModality();
    key('Tab');
    vi.advanceTimersByTime(999);
    expect(mod.focusCameFromTab()).toBe(true);
    vi.advanceTimersByTime(2);
    expect(mod.focusCameFromTab()).toBe(false);
  });

  it('a pointer press cancels it, so a tap-then-script focus is not keyboard navigation', () => {
    mod.trackKeyboardModality();
    key('Tab');
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(mod.focusCameFromTab()).toBe(false);
  });

  it('installs lazily on first read and only once', () => {
    const add = vi.spyOn(document, 'addEventListener');
    mod.focusCameFromTab();
    mod.focusCameFromTab();
    mod.trackKeyboardModality();
    expect(add.mock.calls.filter(c => c[0] === 'keydown' || c[0] === 'pointerdown')).toHaveLength(2);
    add.mockRestore();
  });

  it('listens in the capture phase so a handler that stops propagation cannot hide the Tab', () => {
    mod.trackKeyboardModality();
    const stopper = e => e.stopPropagation();
    const el = document.createElement('input');
    el.addEventListener('keydown', stopper);
    document.body.appendChild(el);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(mod.focusCameFromTab()).toBe(true);
    el.remove();
  });
});
