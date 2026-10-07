// frontend/src/lib/ui/usePressHoldOffer.js
// PLAY.5a/AC3 (RQ-PLAY-04): pressing and holding "Play next" offers "At the
// very front". The hold is a pointer press (or a held Enter/Space) of at
// least HOLD_MS; releasing after the hold must NOT also run the ordinary
// Play next, so the click that follows is swallowed. A quick press is the
// ordinary verb, untouched.
import { useCallback, useEffect, useRef, useState } from 'react';

export const HOLD_MS = 500;
export const OFFER_MS = 8000;

export function usePressHoldOffer({ holdMs = HOLD_MS, offerMs = OFFER_MS, onOffered = null } = {}) {
  const [offered, setOffered] = useState(false);
  const timer = useRef(null);
  const offerTimer = useRef(null);
  const heldRef = useRef(false);
  const onOfferedRef = useRef(onOffered);
  onOfferedRef.current = onOffered;

  const clear = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, []);
  const dismiss = useCallback(() => {
    if (offerTimer.current) { clearTimeout(offerTimer.current); offerTimer.current = null; }
    setOffered(false);
  }, []);
  useEffect(() => () => { clear(); if (offerTimer.current) clearTimeout(offerTimer.current); }, [clear]);

  const start = useCallback(() => {
    clear();
    heldRef.current = false;
    timer.current = setTimeout(() => {
      timer.current = null;
      heldRef.current = true;
      setOffered(true);
      onOfferedRef.current?.();
      if (offerTimer.current) clearTimeout(offerTimer.current);
      offerTimer.current = setTimeout(() => { offerTimer.current = null; setOffered(false); }, offerMs);
    }, holdMs);
  }, [clear, holdMs, offerMs]);

  const isHoldKey = (e) => (e.key === 'Enter' || e.key === ' ') && !e.repeat;

  const bind = {
    onPointerDown: () => start(),
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    // A long press must not open the browser's context menu on touch.
    onContextMenu: (e) => { if (heldRef.current || timer.current) e.preventDefault(); },
    onKeyDown: (e) => { if (isHoldKey(e)) start(); },
    onKeyUp: clear,
  };

  /** Wrap the ordinary click: a click that ends a hold is swallowed (once). */
  const guardClick = useCallback((fn) => (event) => {
    if (heldRef.current) {
      heldRef.current = false;
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
