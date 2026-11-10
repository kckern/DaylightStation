import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';

const logSpy = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const childSpy = vi.fn(() => logSpy);
vi.mock('@/lib/logging/Logger.js', () => ({
  default: () => ({ child: childSpy })
}));

import RaceMenu from './RaceMenu.jsx';

const GUARD_MS = 600;
const AUTO_CLOSE_MS = 15000;

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

  it('a tap on the sheet itself (between items) does not close it', () => {
    setup();
    openArmed();
    fireEvent.click(screen.getByTestId('race-menu-sheet'));
    expect(screen.getByTestId('race-menu-sheet')).toBeTruthy();
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
