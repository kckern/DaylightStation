// frontend/src/lib/ui/usePressHoldOffer.js
// PLAY.5a/AC3 (RQ-PLAY-04): pressing and holding "Play next" offers "At the
// very front". The hold is a pointer press (or a held Space) of at
// least HOLD_MS; releasing after the hold must NOT also run the ordinary
// Play next, so the click that follows is swallowed. A quick press is the
// ordinary verb, untouched.
import { useCallback, useEffect, useRef, useState } from 'react';

export const HOLD_MS = 500;
export const OFFER_MS = 8000;
// How long after a completed hold is released its trailing click is still
// swallowed. A hold released off the element produces no click at all, so the
// swallow must lapse rather than eat the next ordinary tap.
export const SWALLOW_MS = 300;

export function usePressHoldOffer({ holdMs = HOLD_MS, offerMs = OFFER_MS, onOffered = null } = {}) {
  const [offered, setOffered] = useState(false);
  const timer = useRef(null);
  const offerTimer = useRef(null);
  const heldRef = useRef(false); // a hold completed and is still pressed
  const swallowUntilRef = useRef(0);
  const onOfferedRef = useRef(onOffered);
  onOfferedRef.current = onOffered;

  const clear = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (heldRef.current) {
      heldRef.current = false;
      swallowUntilRef.current = Date.now() + SWALLOW_MS;
    }
  }, []);
  const dismiss = useCallback(() => {
    if (offerTimer.current) { clearTimeout(offerTimer.current); offerTimer.current = null; }
    setOffered(false);
  }, []);
  useEffect(() => () => { clear(); if (offerTimer.current) clearTimeout(offerTimer.current); }, [clear]);

  const start = useCallback(() => {
    clear();
    heldRef.current = false;
    swallowUntilRef.current = 0;
    timer.current = setTimeout(() => {
      timer.current = null;
      heldRef.current = true;
      setOffered(true);
      onOfferedRef.current?.();
      if (offerTimer.current) clearTimeout(offerTimer.current);
      offerTimer.current = setTimeout(() => { offerTimer.current = null; setOffered(false); }, offerMs);
    }, holdMs);
  }, [clear, holdMs, offerMs]);

  // Enter is deliberately not a hold key: native buttons and menu items fire
  // click on Enter keydown, so Play next has already run by the time a hold
  // could complete. Space (click on keyup) keeps the hold.
  const isHoldKey = (e) => e.key === ' ' && !e.repeat;

  const bind = {
    onPointerDown: () => start(),
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    // A long press must not open the browser's context menu on touch.
    onContextMenu: (e) => { if (heldRef.current || timer.current || Date.now() < swallowUntilRef.current) e.preventDefault(); },
    onKeyDown: (e) => { if (isHoldKey(e)) start(); },
    onKeyUp: clear,
  };

  /** Wrap the ordinary click: a click that ends a hold is swallowed (once). */
  const guardClick = useCallback((fn) => (event) => {
    if (heldRef.current || Date.now() < swallowUntilRef.current) {
      heldRef.current = false;
      swallowUntilRef.current = 0;
      event?.preventDefault?.();
      event?.stopPropagation?.();
      return undefined;
    }
    dismiss();
    return fn?.(event);
  }, [dismiss]);

  return { offered, bind, guardClick, dismiss };
}

export default usePressHoldOffer;
