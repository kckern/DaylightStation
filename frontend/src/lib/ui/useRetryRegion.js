import { useRef } from 'react';

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
