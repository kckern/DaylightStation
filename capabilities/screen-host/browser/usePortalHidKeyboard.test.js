import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchPortalHidMessage } from './usePortalHidKeyboard.js';

const key = (overrides = {}) => ({
  type: 'keyboard', action: 'down', key: 'a', code: 'KeyA', location: 0,
  ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, repeat: false,
  ...overrides,
});

describe('dispatchPortalHidMessage', () => {
  afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

  it('dispatches a marked keyboard event and performs text input', () => {
    document.body.innerHTML = '<input id="answer" value="bc">';
    const input = document.querySelector('#answer');
    input.focus();
    input.setSelectionRange(0, 0);
    const seen = vi.fn();
    input.addEventListener('keydown', seen);

    expect(dispatchPortalHidMessage(key())).toBe(true);
    expect(seen).toHaveBeenCalledOnce();
    expect(seen.mock.calls[0][0].portalHid).toBe(true);
    expect(input.value).toBe('abc');
  });

  it('honors preventDefault from application handlers', () => {
    document.body.innerHTML = '<input id="answer" value="bc">';
    const input = document.querySelector('#answer');
    input.focus();
    input.addEventListener('keydown', (event) => event.preventDefault());
    dispatchPortalHidMessage(key());
    expect(input.value).toBe('bc');
  });

  it('implements Backspace and Tab defaults', () => {
    document.body.innerHTML = '<input id="a" value="abc"><button id="b">Next</button>';
    const input = document.querySelector('#a');
    input.focus();
    input.setSelectionRange(3, 3);
    dispatchPortalHidMessage(key({ key: 'Backspace', code: 'Backspace' }));
    expect(input.value).toBe('ab');
    dispatchPortalHidMessage(key({ key: 'Tab', code: 'Tab' }));
    expect(document.activeElement).toBe(document.querySelector('#b'));
  });

  it('rejects malformed messages', () => {
    expect(dispatchPortalHidMessage({ type: 'keyboard', action: 'down' })).toBe(false);
    expect(dispatchPortalHidMessage(key({ key: 'x'.repeat(65) }))).toBe(false);
  });
});
