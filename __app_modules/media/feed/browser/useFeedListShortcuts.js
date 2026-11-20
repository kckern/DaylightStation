import { useHotkey } from '@/lib/hooks/useHotkey.js';
import { getReducedMotionQuery } from '@/lib/ui/browserMotion.js';

export function useFeedListShortcuts(containerRef, focusSelector, enabled) {
  const move = event => {
    if (!enabled || !['j', 'k'].includes(event.key)) return false;
    const rows = [...(containerRef.current?.querySelectorAll(focusSelector) || [])];
    if (!rows.length) return false;
    const index = rows.indexOf(document.activeElement);
    const next = event.key === 'j' ? Math.min(rows.length - 1, index + 1) : Math.max(0, index - 1);
    const row = rows[next];
    const reducedMotion = getReducedMotionQuery(row.ownerDocument.defaultView)?.matches;
    row.focus({ preventScroll: true });
    row.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'instant' : 'smooth' });
  };

  useHotkey('j', move, { allowRepeat: true });
  useHotkey('k', move, { allowRepeat: true });
}
