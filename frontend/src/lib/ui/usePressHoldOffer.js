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
  const pressing = useRef(null); // pointer id or 'space'
  const timer = useRef(null);
  const offerTimer = useRef(null);
  const heldRef = useRef(false); // a hold completed and is still pressed
  const swallowUntilRef = useRef(0);
  const onOfferedRef = useRef(onOffered);
  onOfferedRef.current = onOffered;

  const clear = useCallback(() => {
    pressing.current = null;
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

  const start = useCallback(input => {
    if (pressing.current !== null) return;
    pressing.current = input;
    swallowUntilRef.current = 0;
    timer.current = setTimeout(() => {
      timer.current = null;
      heldRef.current = true;
      setOffered(true);
      onOfferedRef.current?.();
      if (offerTimer.current) clearTimeout(offerTimer.current);
      offerTimer.current = setTimeout(() => { offerTimer.current = null; setOffered(false); }, offerMs);
    }, holdMs);
  }, [holdMs, offerMs]);

  const clearPointer = event => {
    if (pressing.current === event.pointerId) clear();
  };
  const clearSpace = () => {
    if (pressing.current === 'space') clear();
  };

  const bind = {
    onPointerDown: event => {
      if (event.isPrimary && event.button === 0) start(event.pointerId);
    },
    onPointerUp: clearPointer,
    onPointerLeave: clearPointer,
    onPointerCancel: clearPointer,
    // A long press must not open the browser's context menu on touch.
    onContextMenu: (e) => { if (heldRef.current || timer.current || Date.now() < swallowUntilRef.current) e.preventDefault(); },
    // Mantine Menu.Item owns bubble keydown for menu navigation. Capture Space
    // here and let the native short-press click still happen on keyup.
    onKeyDownCapture: event => {
      if (event.key === ' ' && !event.repeat) start('space');
    },
    onKeyUp: event => {
      if (event.key === ' ') clearSpace();
    },
    onBlur: clearSpace,
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
