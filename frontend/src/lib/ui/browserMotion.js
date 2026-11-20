// Read a live browser preference without subscribing each rendered control.
export function getReducedMotionQuery(view) {
  return view?.matchMedia?.('(prefers-reduced-motion: reduce)');
}
