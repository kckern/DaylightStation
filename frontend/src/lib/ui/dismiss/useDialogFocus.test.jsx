// frontend/src/lib/ui/dismiss/useDialogFocus.test.jsx
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useRef } from 'react';
import { useDialogFocus, keepTabInPanel } from './useDialogFocus.js';

// jsdom has no layout, so tabbable's default visibility check finds nothing.
// Give every element a client rect, as a browser would for rendered content.
const realRects = Element.prototype.getClientRects;
beforeAll(() => { Element.prototype.getClientRects = function () { return [{ width: 1, height: 1 }]; }; });
afterAll(() => { Element.prototype.getClientRects = realRects; });
afterEach(() => { vi.useRealTimers(); });

function Dialog({ active = true, withAutofocus = false }) {
  const panelRef = useRef(null);
  const fallbackRef = useRef(null);
  const onKeyDown = useDialogFocus(active, panelRef, fallbackRef);
  return (
    <>
      <main data-testid="page"><button>behind</button></main>
      <div role="dialog" aria-label="Edit">
        <div ref={panelRef} onKeyDown={onKeyDown} tabIndex={-1} data-testid="panel">
          <button>first</button>
          {withAutofocus && <input aria-label="Name" data-autofocus />}
          <button ref={fallbackRef}>last</button>
        </div>
      </div>
    </>
  );
}

const tab = (el, opts = {}) => fireEvent.keyDown(el, { key: 'Tab', ...opts });

describe('keepTabInPanel (via the returned key handler)', () => {
  it('Tab on the last stop wraps to the first, Shift+Tab on the first wraps to the last', () => {
    render(<Dialog />);
    const first = screen.getByText('first');
    const last = screen.getByText('last');
    last.focus();
    expect(tab(last)).toBe(false); // default prevented
    expect(document.activeElement).toBe(first);
    expect(tab(first, { shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(last);
  });

  it('leaves Tab alone in the middle of the panel and for modified chords', () => {
    render(<Dialog withAutofocus />);
    const input = screen.getByLabelText('Name');
    input.focus();
    expect(tab(input)).toBe(true);
    expect(document.activeElement).toBe(input);
    const last = screen.getByText('last');
    last.focus();
    expect(tab(last, { ctrlKey: true })).toBe(true);
    expect(tab(last, { altKey: true })).toBe(true);
    expect(tab(last, { metaKey: true })).toBe(true);
    fireEvent.keyDown(last, { key: 'Enter' });
    expect(document.activeElement).toBe(last);
  });

  it('Tab from the panel itself moves into the first stop', () => {
    render(<Dialog />);
    const panel = screen.getByTestId('panel');
    panel.focus();
    expect(tab(panel)).toBe(false);
    expect(document.activeElement).toBe(screen.getByText('first'));
  });

  it('does nothing when focus is outside the panel', () => {
    const panel = document.createElement('div');
    const out = document.createElement('button');
    document.body.append(panel, out);
    out.focus();
    const event = { key: 'Tab', preventDefault: vi.fn(), defaultPrevented: false, shiftKey: false };
    keepTabInPanel(event, panel);
    expect(event.preventDefault).not.toHaveBeenCalled();
    panel.remove(); out.remove();
  });
});

describe('useDialogFocus', () => {
  it('hides everything outside the dialog from assistive tech while active, and restores it on close', () => {
    const { rerender } = render(<Dialog />);
    const page = screen.getByTestId('page');
    expect(page.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('dialog').closest('[aria-hidden="true"]')).toBeNull();
    rerender(<Dialog active={false} />);
    expect(page.getAttribute('aria-hidden')).toBeNull();
  });

  it('moves initial focus to [data-autofocus] after the open tick', () => {
    vi.useFakeTimers();
    render(<Dialog withAutofocus />);
    expect(document.activeElement).not.toBe(screen.getByLabelText('Name'));
    act(() => vi.runOnlyPendingTimers());
    expect(document.activeElement).toBe(screen.getByLabelText('Name'));
  });

  it('falls back to the fallback ref when there is no autofocus target', () => {
    vi.useFakeTimers();
    render(<Dialog />);
    act(() => vi.runOnlyPendingTimers());
    expect(document.activeElement).toBe(screen.getByText('last'));
  });

  it('leaves focus alone when the panel already holds it', () => {
    vi.useFakeTimers();
    render(<Dialog withAutofocus />);
    screen.getByText('first').focus();
    act(() => vi.runOnlyPendingTimers());
    expect(document.activeElement).toBe(screen.getByText('first'));
  });

  it('cancels the opening focus if it closes before the tick', () => {
    vi.useFakeTimers();
    const { rerender } = render(<Dialog withAutofocus />);
    rerender(<Dialog withAutofocus active={false} />);
    act(() => vi.runOnlyPendingTimers());
    expect(document.activeElement).not.toBe(screen.getByLabelText('Name'));
  });

  it('wraps Tab that lands outside the panel (a portaled menu) while active', () => {
    render(<Dialog />);
    const outside = document.createElement('div');
    const portaled = document.createElement('button');
    outside.appendChild(portaled);
    document.body.appendChild(outside);
    // Focus is in the panel's last stop but the key event targets a portaled node.
    screen.getByText('last').focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    portaled.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(screen.getByText('first'));
    outside.remove();
  });

  it('removes its document key listener when it closes or unmounts', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const { unmount } = render(<Dialog />);
    const added = add.mock.calls.filter(c => c[0] === 'keydown').map(c => c[1]);
    expect(added).toHaveLength(1);
    unmount();
    expect(remove.mock.calls.some(c => c[0] === 'keydown' && c[1] === added[0])).toBe(true);
    add.mockRestore(); remove.mockRestore();
  });
});
