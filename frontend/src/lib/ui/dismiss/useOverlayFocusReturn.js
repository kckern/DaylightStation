import { useLayoutEffect } from 'react';

// Transfer the return target if another overlay replaces this one in the same commit.
let pendingFocusReturn = null;

export function useOverlayFocusReturn(open) {
  useLayoutEffect(() => {
    if (!open) return undefined;
    const opener = pendingFocusReturn?.opener?.isConnected
      ? pendingFocusReturn.opener : document.activeElement;
    pendingFocusReturn = null;
    return () => {
      const request = { opener };
      pendingFocusReturn = request;
      queueMicrotask(() => {
        if (pendingFocusReturn !== request) return;
        pendingFocusReturn = null;
        if (opener?.isConnected) opener.focus?.({ preventScroll: true });
      });
    };
  }, [open]);
}
