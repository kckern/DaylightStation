import { useEffect } from 'react';

/**
 * Close an overlay on Escape or on pointerdown outside the supplied ref.
 * Usage:
 *   const ref = useRef(null);
 *   useDismissable(ref, { open, onDismiss });
 */
export function useDismissable(ref, { open, onDismiss }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onDismiss?.();
      }
    };
    const onPointer = (e) => {
      const node = ref?.current;
      if (!node) return;
      if (e.target instanceof Node && node.contains(e.target)) return;
      onDismiss?.();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [ref, open, onDismiss]);
}

export default useDismissable;
