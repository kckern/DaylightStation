import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import getLogger from '@/lib/logging/Logger.js';
import { useEscapeToClose } from "./home/useEscapeToClose.js";
import { MenuIcon } from "./home/icons.jsx";
import "./RaceMenu.scss";

/** A destructive item ignores taps for this long after the sheet opens, so the
 *  second tap of a double-tap on the open button cannot land on an item that
 *  has just appeared under the finger. The scrim waits too: it covers the open
 *  button, so without this a double-tap would open the sheet and shut it again. */
export const RACE_MENU_GUARD_MS = 600;
/** An untouched sheet closes itself: a race is running underneath. */
export const RACE_MENU_AUTO_CLOSE_MS = 15000;

/**
 * The one way to stop a race. A low-contrast corner button opens a sheet; the
 * race keeps running underneath. Nothing destructive is ever a single tap.
 *
 * Mount inside a `position: relative` root: the button pins to its top-right
 * corner and the sheet's scrim covers it.
 */
export default function RaceMenu({ onEnd, onDiscard, canEnd = true, onOpenChange }) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  // Bumped by any touch or key inside the sheet; restarts the auto-close timer.
  const [activity, setActivity] = useState(0);
  const log = useMemo(() => getLogger().child({ component: 'cycle-race-menu' }), []);

  const openButtonRef = useRef(null);
  const keepRef = useRef(null);
  const sheetRef = useRef(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  const close = useCallback((reason) => {
    log.debug('cycle_game.ui.race_menu_close', { reason });
    setOpen(false);
  }, [log]);

  const onEscape = useCallback(() => close('escape'), [close]);
  useEscapeToClose(open ? onEscape : null);

  // Focus follows the sheet, and the container hears about each change. The
  // first run (mount, closed) is skipped: nothing has changed yet.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open === wasOpenRef.current) return;
    wasOpenRef.current = open;
    if (open) keepRef.current?.focus();
    else openButtonRef.current?.focus();
    onOpenChangeRef.current?.(open);
  }, [open]);

  // Accidental-tap guard: destructive items arm RACE_MENU_GUARD_MS after open.
  useEffect(() => {
    if (!open) return undefined;
    setArmed(false);
    const id = setTimeout(() => setArmed(true), RACE_MENU_GUARD_MS);
    return () => clearTimeout(id);
  }, [open]);

  // Auto-close after RACE_MENU_AUTO_CLOSE_MS without a touch or key in the sheet.
  useEffect(() => {
    if (!open) return undefined;
    const id = setTimeout(() => close('timeout'), RACE_MENU_AUTO_CLOSE_MS);
    return () => clearTimeout(id);
  }, [open, activity, close]);

  const noteActivity = () => setActivity((n) => n + 1);

  const openSheet = () => {
    if (open) return;
    log.info('cycle_game.ui.race_menu_open', { canEnd });
    setArmed(false);
    setOpen(true);
  };

  const choose = (reason, handler) => {
    if (!armed) return;
    close(reason);
    handler?.();
  };

  // aria-modal promises that focus stays inside; keep Tab within the sheet.
  const onSheetKeyDown = (e) => {
    noteActivity();
    if (e.key !== 'Tab') return;
    const items = [...(sheetRef.current?.querySelectorAll('button') || [])];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const guarded = armed ? undefined : true;

  return (
    <>
      <button
        ref={openButtonRef}
        type="button"
        className="cg-race-menu__open"
        data-testid="race-menu-open"
        aria-label="Race menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openSheet}
      >
        <MenuIcon />
      </button>
      {open && (
        <div className="cg-race-menu">
          <div className="cg-race-menu__scrim" data-testid="race-menu-scrim" onClick={() => { if (armed) close('scrim'); }} />
          <div
            ref={sheetRef}
            className="cg-race-menu__sheet"
            data-testid="race-menu-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Race menu"
            onPointerDown={noteActivity}
            onKeyDown={onSheetKeyDown}
          >
            <button
              ref={keepRef}
              type="button"
              className="cg-race-menu__item cg-race-menu__item--primary"
              data-testid="race-menu-keep"
              onClick={() => close('keep')}
            >
              <span className="cg-race-menu__label">Keep racing</span>
            </button>
            {canEnd && (
              <button
                type="button"
                className="cg-race-menu__item"
                data-testid="race-menu-end"
                aria-disabled={guarded}
                onClick={() => choose('end', onEnd)}
              >
                <span className="cg-race-menu__label">End race here</span>
                <span className="cg-race-menu__sub">Saves this ride. It will not count for records or the ladder.</span>
              </button>
            )}
            <div className="cg-race-menu__divider" aria-hidden="true" />
            <button
              type="button"
              className="cg-race-menu__item cg-race-menu__item--danger"
              data-testid="race-menu-discard"
              aria-disabled={guarded}
              onClick={() => choose('discard', onDiscard)}
            >
              <span className="cg-race-menu__label">Discard race</span>
              <span className="cg-race-menu__sub">Nothing is saved.</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}

RaceMenu.propTypes = {
  onEnd: PropTypes.func,
  onDiscard: PropTypes.func,
  canEnd: PropTypes.bool,
  onOpenChange: PropTypes.func
};
