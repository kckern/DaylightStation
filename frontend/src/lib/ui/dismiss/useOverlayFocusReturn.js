import { useLayoutEffect } from 'react';

// Transfer the return target if another overlay replaces this one in the same commit.
let pendingFocusReturn = null;

export function useOverlayFocusReturn(open, returnFocusRef) {
  useLayoutEffect(() => {
    if (!open) return undefined;
    const previous = pendingFocusReturn?.target;
    const canInherit = previous?.ref || previous?.opener?.isConnected;
    const target = !returnFocusRef && canInherit
      ? previous : { ref: returnFocusRef, opener: document.activeElement };
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
      });
    };
  }, [open, returnFocusRef]);
}
