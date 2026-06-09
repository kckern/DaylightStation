import { useEffect } from 'react';

/**
 * Close an overlay on Escape or on pointerdown outside the supplied ref.
 * Usage:
 *   const ref = useRef(null);
 *   useDismissable(ref, { open, onDismiss, ignore });
 *
 * `ignore` is an optional CSS selector; pointerdowns inside any matching
 * ancestor are treated as inside the overlay. Use it for body-portaled
 * descendants (e.g. `.media-app-portal`) that live outside the ref's subtree.
 *
 * The keydown listener runs in the capture phase and calls
 * stopImmediatePropagation() so that other document-level Escape handlers
 * (e.g. a view-level "press Esc to go back") do not also fire while an
 * overlay is open.
 */
export function useDismissable(ref, { open, onDismiss, ignore = null }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        e.stopPropagation();
        onDismiss?.();
      }
    };
    const onPointer = (e) => {
      const node = ref?.current;
      if (!node) return;
      if (e.target instanceof Node && node.contains(e.target)) return;
      if (ignore && e.target instanceof Element && e.target.closest(ignore)) return;
      onDismiss?.();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [ref, open, onDismiss, ignore]);
}

export default useDismissable;
