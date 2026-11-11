import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';

const logSpy = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const childSpy = vi.fn(() => logSpy);
vi.mock('@/lib/logging/Logger.js', () => ({
  default: () => ({ child: childSpy })
}));

import RaceMenu, { RACE_MENU_GUARD_MS as GUARD_MS, RACE_MENU_AUTO_CLOSE_MS as AUTO_CLOSE_MS } from './RaceMenu.jsx';

describe('RaceMenu', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.values(logSpy).forEach((fn) => fn.mockClear());
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = (props = {}) => {
    const onEnd = vi.fn(); const onDiscard = vi.fn();
    const view = render(<RaceMenu onEnd={onEnd} onDiscard={onDiscard} {...props} />);
    return { onEnd, onDiscard, ...view };
  };
  const advance = (ms) => act(() => { vi.advanceTimersByTime(ms); });
  const open = () => fireEvent.click(screen.getByTestId('race-menu-open'));
  /** Open the sheet and wait out the accidental-tap guard. */
  const openArmed = () => { open(); advance(GUARD_MS + 100); };
  const closeEvents = () => logSpy.debug.mock.calls.filter(([name]) => name === 'cycle_game.ui.race_menu_close');
  const guardedTaps = () => logSpy.debug.mock.calls
    .filter(([name]) => name === 'cycle_game.ui.race_menu_guarded_tap').map(([, data]) => data);
  /**
   * What a browser does for a native <button>: Enter activates on keydown, Space
   * on keyup, and either is cancelled if the keydown was default-prevented.
   * (jsdom does not synthesise the click itself.)
   */
  const pressKey = (el, key) => {
    const notPrevented = fireEvent.keyDown(el, { key });
    fireEvent.keyUp(el, { key });
    if (notPrevented) fireEvent.click(el);
  };

  // ── plan tests ───────────────────────────────────────────────────────────
  it('shows only the menu button until opened', () => {
    setup();
    expect(screen.getByTestId('race-menu-open')).toBeTruthy();
    expect(screen.queryByTestId('race-menu-sheet')).toBeNull();
  });

  it('opening the sheet calls nothing', () => {
    const { onEnd, onDiscard } = setup();
    open();
    expect(screen.getByTestId('race-menu-sheet')).toBeTruthy();
    expect(onEnd).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('Keep racing closes the sheet and calls nothing', () => {
    const { onEnd, onDiscard } = setup();
    open();
    fireEvent.click(screen.getByTestId('race-menu-keep'));
    expect(screen.queryByTestId('race-menu-sheet')).toBeNull();
    expect(onEnd).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('End race here and Discard race call their handlers and close the sheet', () => {
    const { onEnd, onDiscard } = setup();
    openArmed();
    fireEvent.click(screen.getByTestId('race-menu-end'));
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
    expect(screen.queryByTestId('race-menu-sheet')).toBeNull();
    openArmed();
    fireEvent.click(screen.getByTestId('race-menu-discard'));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('race-menu-sheet')).toBeNull();
  });

  it('hides End race here when canEnd is false (staging, countdown)', () => {
    setup({ canEnd: false });
    open();
    expect(screen.queryByTestId('race-menu-end')).toBeNull();
    expect(screen.getByTestId('race-menu-keep')).toBeTruthy();
    expect(screen.getByTestId('race-menu-discard')).toBeTruthy();
  });

  it('renders End race here by default (canEnd defaults to true)', () => {
    setup();
    open();
    expect(screen.getByTestId('race-menu-end')).toBeTruthy();
  });

  // ── layout order + copy ──────────────────────────────────────────────────
  it('lists Keep racing first, then End race here, then Discard race', () => {
    setup();
    open();
    const ids = [...screen.getByTestId('race-menu-sheet').querySelectorAll('button')]
      .map((b) => b.getAttribute('data-testid'));
    expect(ids).toEqual(['race-menu-keep', 'race-menu-end', 'race-menu-discard']);
  });

  it('explains each destructive item in real text, not a title', () => {
    setup();
    open();
    const end = screen.getByTestId('race-menu-end');
    const discard = screen.getByTestId('race-menu-discard');
    expect(end.textContent).toContain('End race here');
    expect(end.textContent).toContain('Saves this ride. It will not count for records or the ladder.');
    expect(discard.textContent).toContain('Discard race');
    expect(discard.textContent).toContain('Nothing is saved.');
    expect(end.getAttribute('title')).toBeNull();
    expect(discard.getAttribute('title')).toBeNull();
  });

  it('uses an SVG for the open button, not a text glyph', () => {
    setup();
    const btn = screen.getByTestId('race-menu-open');
    expect(btn.querySelector('svg')).toBeTruthy();
    expect(btn.textContent).toBe('');
  });

  // ── req 4: accidental-tap guard ──────────────────────────────────────────
  it('ignores a tap on End race here 100 ms after opening, honours one at 700 ms', () => {
    const { onEnd } = setup();
    open();
    advance(100);
    fireEvent.click(screen.getByTestId('race-menu-end'));
    expect(onEnd).not.toHaveBeenCalled();
    expect(screen.getByTestId('race-menu-sheet')).toBeTruthy();
    advance(600);
    fireEvent.click(screen.getByTestId('race-menu-end'));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('ignores a tap on Discard race 100 ms after opening, honours one at 700 ms', () => {
    const { onDiscard } = setup();
    open();
    advance(100);
    fireEvent.click(screen.getByTestId('race-menu-discard'));
    expect(onDiscard).not.toHaveBeenCalled();
    expect(screen.getByTestId('race-menu-sheet')).toBeTruthy();
    advance(600);
    fireEvent.click(screen.getByTestId('race-menu-discard'));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('still ignores a destructive tap at 599 ms', () => {
    const { onEnd, onDiscard } = setup();
    open();
    advance(GUARD_MS - 1);
    fireEvent.click(screen.getByTestId('race-menu-end'));
    fireEvent.click(screen.getByTestId('race-menu-discard'));
    expect(onEnd).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('marks the destructive items aria-disabled during the guard and clears it after', () => {
    setup();
    open();
    expect(screen.getByTestId('race-menu-end').getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByTestId('race-menu-discard').getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByTestId('race-menu-keep').getAttribute('aria-disabled')).toBeNull();
    advance(GUARD_MS);
    expect(screen.getByTestId('race-menu-end').getAttribute('aria-disabled')).toBeNull();
    expect(screen.getByTestId('race-menu-discard').getAttribute('aria-disabled')).toBeNull();
  });

  it('re-arms the guard on every open', () => {
    const { onDiscard } = setup();
    openArmed();
    fireEvent.click(screen.getByTestId('race-menu-keep'));
    open();
    advance(100);
    fireEvent.click(screen.getByTestId('race-menu-discard'));
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('Keep racing is never guarded', () => {
    setup();
    open();
    advance(50);
    fireEvent.click(screen.getByTestId('race-menu-keep'));
    expect(screen.queryByTestId('race-menu-sheet')).toBeNull();
  });

  // ── req 5: scrim + Escape ────────────────────────────────────────────────
  it('tapping the scrim closes the sheet and calls nothing', () => {
    const { onEnd, onDiscard } = setup();
    openArmed();
    fireEvent.click(screen.getByTestId('race-menu-scrim'));
    expect(screen.queryByTestId('race-menu-sheet')).toBeNull();
    expect(onEnd).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('a second tap of a double-tap (scrim at 100 ms) does not shut the sheet again', () => {
    setup();
    open();
    advance(100);
    fireEvent.click(screen.getByTestId('race-menu-scrim'));
    expect(screen.getByTestId('race-menu-sheet')).toBeTruthy();
    advance(600);
    fireEvent.click(screen.getByTestId('race-menu-scrim'));
    expect(screen.queryByTestId('race-menu-sheet')).toBeNull();
  });

  // Fails if the close handler ever moves from the scrim to an ancestor of the
  // sheet (verified by mutation: onClick on the .cg-race-menu layer).
  it('a tap inside the sheet but off the items (padding, divider) closes nothing', () => {
    const { onEnd, onDiscard } = setup();
    openArmed();
    const sheet = screen.getByTestId('race-menu-sheet');
    fireEvent.click(sheet);
    fireEvent.click(sheet.querySelector('.cg-race-menu__divider'));
    expect(screen.getByTestId('race-menu-sheet')).toBeTruthy();
    expect(closeEvents()).toHaveLength(0);
    expect(onEnd).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('Escape closes the sheet and calls nothing', () => {
    const { onEnd, onDiscard } = setup();
    openArmed();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('race-menu-sheet')).toBeNull();
    expect(onEnd).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('Escape while closed does nothing (no close event logged)', () => {
    setup();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeEvents()).toHaveLength(0);
  });

  // ── req 6: auto-close ────────────────────────────────────────────────────
  it('closes itself after 15 s without interaction, calling nothing', () => {
    const { onEnd, onDiscard } = setup();
    open();
    advance(AUTO_CLOSE_MS - 1);
    expect(screen.getByTestId('race-menu-sheet')).toBeTruthy();
    advance(1);
    expect(screen.queryByTestId('race-menu-sheet')).toBeNull();
    expect(onEnd).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('an interaction inside the sheet restarts the 15 s countdown', () => {
    setup();
    open();
    advance(10000);
    fireEvent.pointerDown(screen.getByTestId('race-menu-sheet'));
    advance(10000); // 20 s since open, 10 s since the touch
    expect(screen.getByTestId('race-menu-sheet')).toBeTruthy();
    advance(5000);
    expect(screen.queryByTestId('race-menu-sheet')).toBeNull();
  });

  it('does not auto-close a later open early because of an earlier open', () => {
    setup();
    open();
    advance(10000);
    fireEvent.click(screen.getByTestId('race-menu-keep'));
    open();
    advance(10000);
    expect(screen.getByTestId('race-menu-sheet')).toBeTruthy();
  });

  // ── req 7: accessibility + focus ─────────────────────────────────────────
  it('exposes the sheet as a labelled modal dialog', () => {
    setup();
    open();
    const sheet = screen.getByTestId('race-menu-sheet');
    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    expect(sheet.getAttribute('aria-label')).toBe('Race menu');
  });

  it('labels the open button and reflects the open state in aria-expanded', () => {
    setup();
    const btn = screen.getByTestId('race-menu-open');
    expect(btn.getAttribute('aria-label')).toBe('Race menu');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    open();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByTestId('race-menu-keep'));
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('moves focus to Keep racing on open and back to the open button on close', () => {
    setup();
    const btn = screen.getByTestId('race-menu-open');
    expect(document.activeElement).not.toBe(btn);
    open();
    expect(document.activeElement).toBe(screen.getByTestId('race-menu-keep'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(btn);
  });

  it('returns focus to the open button after the auto-close too', () => {
    setup();
    open();
    advance(AUTO_CLOSE_MS);
    expect(document.activeElement).toBe(screen.getByTestId('race-menu-open'));
  });

  it('keeps Tab inside the sheet', () => {
    setup();
    open();
    const keep = screen.getByTestId('race-menu-keep');
    const discard = screen.getByTestId('race-menu-discard');
    discard.focus();
    fireEvent.keyDown(discard, { key: 'Tab' });
    expect(document.activeElement).toBe(keep);
    fireEvent.keyDown(keep, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(discard);
  });

  // ── req 8: onOpenChange ──────────────────────────────────────────────────
  it('reports open and close through onOpenChange, and not on mount', () => {
    const onOpenChange = vi.fn();
    setup({ onOpenChange });
    expect(onOpenChange).not.toHaveBeenCalled();
    open();
    expect(onOpenChange.mock.calls).toEqual([[true]]);
    fireEvent.click(screen.getByTestId('race-menu-keep'));
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
  });

  it('reports the close through onOpenChange when a destructive item is chosen', () => {
    const onOpenChange = vi.fn();
    setup({ onOpenChange });
    openArmed();
    fireEvent.click(screen.getByTestId('race-menu-discard'));
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
  });

  it('works without any handlers', () => {
    render(<RaceMenu />);
    openArmed();
    expect(() => fireEvent.click(screen.getByTestId('race-menu-end'))).not.toThrow();
    openArmed();
    expect(() => fireEvent.click(screen.getByTestId('race-menu-discard'))).not.toThrow();
  });

  // ── canEnd changing under an open sheet (countdown → racing) ─────────────
  const rerenderWith = (view, props) => act(() => { view.rerender(<RaceMenu {...props} />); });
  const sheetSlots = () => [...screen.getByTestId('race-menu-sheet').children]
    .map((el) => el.getAttribute('data-testid') || el.className);

  it('re-arms the guard when End race here appears under an open sheet', () => {
    const onEnd = vi.fn(); const onDiscard = vi.fn();
    const view = render(<RaceMenu canEnd={false} onEnd={onEnd} onDiscard={onDiscard} />);
    openArmed();
    rerenderWith(view, { canEnd: true, onEnd, onDiscard });
    expect(screen.getByTestId('race-menu-end').getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByTestId('race-menu-discard').getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByTestId('race-menu-end'));
    fireEvent.click(screen.getByTestId('race-menu-discard'));
    expect(onEnd).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
    expect(screen.getByTestId('race-menu-sheet')).toBeTruthy();
    advance(GUARD_MS);
    fireEvent.click(screen.getByTestId('race-menu-end'));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('re-arms the guard when End race here disappears under an open sheet', () => {
    const onEnd = vi.fn(); const onDiscard = vi.fn();
    const view = render(<RaceMenu canEnd onEnd={onEnd} onDiscard={onDiscard} />);
    openArmed();
    rerenderWith(view, { canEnd: false, onEnd, onDiscard });
    fireEvent.click(screen.getByTestId('race-menu-discard'));
    expect(onDiscard).not.toHaveBeenCalled();
    advance(GUARD_MS);
    fireEvent.click(screen.getByTestId('race-menu-discard'));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('a canEnd change while closed does not delay the next open beyond the normal guard', () => {
    const onEnd = vi.fn();
    const view = render(<RaceMenu canEnd={false} onEnd={onEnd} />);
    rerenderWith(view, { canEnd: true, onEnd });
    openArmed();
    fireEvent.click(screen.getByTestId('race-menu-end'));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('reserves the End slot when canEnd is false, so no item changes position', () => {
    const view = render(<RaceMenu canEnd={false} />);
    open();
    const without = sheetSlots();
    expect(without).toEqual(['race-menu-keep', 'race-menu-end-slot', 'cg-race-menu__divider', 'race-menu-discard']);
    const slot = screen.getByTestId('race-menu-end-slot');
    expect(slot.getAttribute('aria-hidden')).toBe('true');
    expect(slot.querySelector('button')).toBeNull();
    expect(slot.tagName).not.toBe('BUTTON');
    // Same two lines as the real item, so the reserved height matches it.
    expect(slot.textContent).toBe(
      'End race here' + 'Saves this ride. It will not count for records or the ladder.'
    );
    rerenderWith(view, { canEnd: true });
    expect(sheetSlots()).toEqual(['race-menu-keep', 'race-menu-end', 'cg-race-menu__divider', 'race-menu-discard']);
    expect(screen.queryByTestId('race-menu-end-slot')).toBeNull();
    expect(screen.getByTestId('race-menu-end').textContent).toBe(slot.textContent);
  });

  it('keeps the same Keep racing element across a canEnd change (no remount, focus kept)', () => {
    const view = render(<RaceMenu canEnd={false} />);
    open();
    const keep = screen.getByTestId('race-menu-keep');
    rerenderWith(view, { canEnd: true });
    expect(screen.getByTestId('race-menu-keep')).toBe(keep);
    expect(document.activeElement).toBe(keep);
  });

  it('moves focus to Keep racing when the focused End race here item goes away', () => {
    const view = render(<RaceMenu canEnd />);
    openArmed();
    const end = screen.getByTestId('race-menu-end');
    end.focus();
    expect(document.activeElement).toBe(end);
    rerenderWith(view, { canEnd: false });
    expect(screen.queryByTestId('race-menu-end')).toBeNull();
    const keep = screen.getByTestId('race-menu-keep');
    expect(document.activeElement).toBe(keep);
    // and the Tab trap still works from there
    fireEvent.keyDown(keep, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByTestId('race-menu-discard'));
  });

  it('leaves focus on Discard race when End race here goes away', () => {
    const view = render(<RaceMenu canEnd />);
    openArmed();
    const discard = screen.getByTestId('race-menu-discard');
    discard.focus();
    rerenderWith(view, { canEnd: false });
    expect(document.activeElement).toBe(discard);
  });

  // ── unmount while open ───────────────────────────────────────────────────
  it('reports a close and logs reason "unmount" when unmounted while open', () => {
    const onOpenChange = vi.fn();
    const view = setup({ onOpenChange });
    open();
    expect(onOpenChange.mock.calls).toEqual([[true]]);
    view.unmount();
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
    const events = closeEvents();
    expect(events).toHaveLength(1);
    expect(events[0][1]).toEqual({ reason: 'unmount' });
  });

  it('says nothing when unmounted while closed', () => {
    const onOpenChange = vi.fn();
    const view = setup({ onOpenChange });
    view.unmount();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(closeEvents()).toHaveLength(0);
  });

  it('says nothing more when unmounted after it was opened and closed', () => {
    const onOpenChange = vi.fn();
    const view = setup({ onOpenChange });
    open();
    fireEvent.click(screen.getByTestId('race-menu-keep'));
    view.unmount();
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
    expect(closeEvents().map(([, d]) => d.reason)).toEqual(['keep']);
  });

  it('leaves no timer behind after an unmount while open', () => {
    const view = setup();
    open();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  // ── Escape is consumed by the open sheet ─────────────────────────────────
  describe('Escape containment', () => {
    let before; let after; let onWindow;
    const cleanup = [];
    const listen = (target, fn) => {
      target.addEventListener('keydown', fn);
      cleanup.push(() => target.removeEventListener('keydown', fn));
    };
    const escapesSeen = (fn) => fn.mock.calls.filter(([e]) => e.key === 'Escape').length;
    afterEach(() => { cleanup.splice(0).forEach((off) => off()); });

    const mountBetweenListeners = () => {
      before = vi.fn(); after = vi.fn(); onWindow = vi.fn();
      listen(document, before);          // registered BEFORE the menu mounts
      const view = setup();
      listen(document, after);           // registered AFTER the menu mounts
      listen(window, onWindow);          // FitnessPlayer / FullScreenContainer style
      return view;
    };

    it('lets Escape through to other listeners while the sheet is closed', () => {
      mountBetweenListeners();
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(escapesSeen(before)).toBe(1);
      expect(escapesSeen(after)).toBe(1);
      expect(escapesSeen(onWindow)).toBe(1);
    });

    it('swallows Escape while the sheet is open, and closes with reason "escape"', () => {
      mountBetweenListeners();
      openArmed();
      const notPrevented = fireEvent.keyDown(screen.getByTestId('race-menu-keep'), { key: 'Escape' });
      expect(escapesSeen(before)).toBe(0);
      expect(escapesSeen(after)).toBe(0);
      expect(escapesSeen(onWindow)).toBe(0);
      expect(notPrevented).toBe(false); // preventDefault was called
      expect(screen.queryByTestId('race-menu-sheet')).toBeNull();
      expect(closeEvents().map(([, d]) => d.reason)).toEqual(['escape']);
    });

    it('swallows Escape during the 600 ms guard too', () => {
      mountBetweenListeners();
      open();
      advance(100);
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(escapesSeen(before)).toBe(0);
      expect(escapesSeen(after)).toBe(0);
      expect(screen.queryByTestId('race-menu-sheet')).toBeNull();
    });

    it('does not swallow other keys while open', () => {
      mountBetweenListeners();
      openArmed();
      fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
      expect(before).toHaveBeenCalledTimes(1);
      expect(after).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('race-menu-sheet')).toBeTruthy();
    });

    it('lets Escape through again once the sheet has closed', () => {
      mountBetweenListeners();
      openArmed();
      fireEvent.click(screen.getByTestId('race-menu-keep'));
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(escapesSeen(before)).toBe(1);
      expect(escapesSeen(after)).toBe(1);
      expect(closeEvents().map(([, d]) => d.reason)).toEqual(['keep']);
    });

    it('lets Escape through after an unmount while open', () => {
      const view = mountBetweenListeners();
      open();
      view.unmount();
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(escapesSeen(before)).toBe(1);
      expect(escapesSeen(after)).toBe(1);
    });
  });

  // ── keyboard activation honours the guard ────────────────────────────────
  it.each([['Enter'], [' ']])('key %j on a guarded item does nothing before 600 ms and works after', (key) => {
    const { onEnd, onDiscard } = setup();
    open();
    advance(100);
    pressKey(screen.getByTestId('race-menu-end'), key);
    pressKey(screen.getByTestId('race-menu-discard'), key);
    expect(onEnd).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
    expect(screen.getByTestId('race-menu-sheet')).toBeTruthy();
    advance(GUARD_MS);
    pressKey(screen.getByTestId('race-menu-end'), key);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
  });

  // ── a handler that throws ────────────────────────────────────────────────
  it.each([
    ['onEnd', 'race-menu-end', 'end'],
    ['onDiscard', 'race-menu-discard', 'discard']
  ])('a throwing %s still closes the sheet, reports false and logs the failure', (prop, testId, item) => {
    const onOpenChange = vi.fn();
    const boom = vi.fn(() => { throw new Error('controller gone'); });
    render(<RaceMenu {...{ [prop]: boom }} onOpenChange={onOpenChange} />);
    openArmed();
    fireEvent.click(screen.getByTestId(testId));
    expect(boom).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('race-menu-sheet')).toBeNull();
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
    expect(closeEvents().map(([, d]) => d.reason)).toEqual([item]);
    expect(logSpy.error).toHaveBeenCalledTimes(1);
    expect(logSpy.error.mock.calls[0][0]).toBe('cycle_game.ui.race_menu_handler_failed');
    expect(logSpy.error.mock.calls[0][1]).toEqual({ item, error: 'controller gone' });
  });

  // ── icon ─────────────────────────────────────────────────────────────────
  it('draws the open glyph as three dots of radius 3 in a 24-unit box', () => {
    setup();
    const svg = screen.getByTestId('race-menu-open').querySelector('svg');
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    const dots = [...svg.querySelectorAll('circle')];
    expect(dots.map((c) => c.getAttribute('r'))).toEqual(['3', '3', '3']);
    // nothing clipped: every dot lies inside the box
    dots.forEach((c) => {
      const cx = Number(c.getAttribute('cx'));
      expect(cx - 3).toBeGreaterThanOrEqual(0);
      expect(cx + 3).toBeLessThanOrEqual(24);
    });
  });

  // ── req 9: logging ───────────────────────────────────────────────────────
  it('creates a child logger for the component', () => {
    setup();
    expect(childSpy).toHaveBeenCalledWith({ component: 'cycle-race-menu' });
  });

  it('logs the open at info', () => {
    setup();
    expect(logSpy.info).not.toHaveBeenCalled();
    open();
    expect(logSpy.info).toHaveBeenCalledTimes(1);
    expect(logSpy.info.mock.calls[0][0]).toBe('cycle_game.ui.race_menu_open');
    expect(logSpy.info.mock.calls[0][1]).toEqual({ canEnd: true });
  });

  it('records canEnd: false in the open event during staging and countdown', () => {
    setup({ canEnd: false });
    open();
    expect(logSpy.info.mock.calls[0][1]).toEqual({ canEnd: false });
  });

  it('logs each guard-rejected tap with the item it hit', () => {
    setup();
    open();
    advance(100);
    fireEvent.click(screen.getByTestId('race-menu-end'));
    fireEvent.click(screen.getByTestId('race-menu-discard'));
    fireEvent.click(screen.getByTestId('race-menu-scrim'));
    expect(guardedTaps()).toEqual([{ item: 'end' }, { item: 'discard' }, { item: 'scrim' }]);
  });

  it('logs no guarded tap once the guard has lifted', () => {
    setup();
    openArmed();
    fireEvent.click(screen.getByTestId('race-menu-end'));
    expect(guardedTaps()).toEqual([]);
  });

  const reasonCases = [
    ['keep', () => fireEvent.click(screen.getByTestId('race-menu-keep'))],
    ['scrim', () => fireEvent.click(screen.getByTestId('race-menu-scrim'))],
    ['escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
    ['timeout', () => advance(AUTO_CLOSE_MS)],
    ['end', () => fireEvent.click(screen.getByTestId('race-menu-end'))],
    ['discard', () => fireEvent.click(screen.getByTestId('race-menu-discard'))]
  ];
  it.each(reasonCases)('logs the close at debug with reason "%s"', (reason, closeIt) => {
    setup();
    openArmed();
    expect(closeEvents()).toHaveLength(0);
    closeIt();
    const events = closeEvents();
    expect(events).toHaveLength(1);
    expect(events[0][1]).toMatchObject({ reason });
  });

  it('a guarded tap logs no close', () => {
    setup();
    open();
    advance(100);
    fireEvent.click(screen.getByTestId('race-menu-discard'));
    expect(closeEvents()).toHaveLength(0);
  });
});
