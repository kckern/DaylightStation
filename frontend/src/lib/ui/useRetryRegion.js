import { useRef } from 'react';

/** Keep focus in a mounted read region when Retry is replaced by its result. */
export function useRetryRegion(onRetry, busy) {
  const ref = useRef(null);
  const retry = () => {
    // Move focus before the read removes its own button. Settlement never
    // moves focus, including when someone tabs away during the request.
    ref.current?.focus({ preventScroll: true });
    return onRetry();
  };

  return { regionProps: { ref, tabIndex: -1, 'aria-busy': busy || undefined }, retry };
}
