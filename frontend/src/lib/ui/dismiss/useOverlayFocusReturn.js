import { useLayoutEffect, useRef } from 'react';

// Transfer the return target if another overlay replaces this one in the same commit.
let pendingFocusReturn = null;

export function useOverlayFocusReturn(open, returnFocusRef, getFallbackFocusTarget) {
  const fallback = useRef(getFallbackFocusTarget);
  useLayoutEffect(() => {
    fallback.current = getFallbackFocusTarget;
  }, [getFallbackFocusTarget]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const previous = pendingFocusReturn?.target;
    const previousFallback = previous?.fallback.current;
    const canInherit = previous?.ref || previous?.opener?.isConnected || previousFallback;
    const target = !returnFocusRef && canInherit
      ? { ...previous, fallback: previousFallback ? previous.fallback : fallback }
      : { ref: returnFocusRef, opener: document.activeElement, fallback };
    pendingFocusReturn = null;
    return () => {
      const request = { target };
      pendingFocusReturn = request;
      queueMicrotask(() => {
        if (pendingFocusReturn !== request) return;
        pendingFocusReturn = null;
        // The trigger can be recreated by the same commit that closes the overlay.
        const currentTrigger = target.ref?.current;
        const opener = currentTrigger?.isConnected ? currentTrigger : target.opener;
        if (opener?.isConnected) opener.focus?.({ preventScroll: true });
        // Focus may already belong to a control in the next view.
        if (document.activeElement !== document.body) return;
        const fallbackTarget = target.fallback.current?.();
        if (fallbackTarget?.isConnected) fallbackTarget.focus?.({ preventScroll: true });
      });
    };
  }, [open, returnFocusRef]);
}
