import { useLayoutEffect, useRef } from 'react';

/** Give a control a stable focus destination while its action changes the region. */
export function useFocusRegion(busy) {
  const ref = useRef(null);
  const focus = () => ref.current?.focus({ preventScroll: true });
  return { regionProps: { ref, tabIndex: -1, 'aria-busy': busy || undefined }, focus };
}

/** Keep focus in a mounted read region when Retry is replaced by its result. */
export function useRetryRegion(onRetry, busy) {
  const { regionProps, focus } = useFocusRegion(busy);
  const retry = () => {
    // Move focus before the read removes its own button. Settlement never
    // moves focus, including when someone tabs away during the request.
    focus();
    return onRetry();
  };

  return { regionProps, focus, retry };
}

/** Recover focus if a result refresh removes the currently focused control. */
export function useFocusAfterRemoval(focus) {
  const lastFocused = useRef(null);

  useLayoutEffect(() => {
    const previous = lastFocused.current;
    if (!previous || previous.isConnected) return;
    lastFocused.current = null;
    if (previous.ownerDocument.activeElement === previous.ownerDocument.body) focus();
  });

  return {
    onFocusCapture(event) { lastFocused.current = event.target; },
    onBlurCapture(event) {
      const previous = event.target;
      // A normal blur leaves the control mounted. A commit that removes the
      // control lets the region recover focus first.
      queueMicrotask(() => {
        if (lastFocused.current === previous && previous.isConnected) lastFocused.current = null;
      });
    },
  };
}
