import { useHotkey } from '@/lib/hooks/useHotkey.js';
import { getPreferredScrollBehavior } from '@/lib/ui/browserMotion.js';

export function useFeedListShortcuts(containerRef, focusSelector, enabled) {
  const move = event => {
    if (!enabled || !['j', 'k'].includes(event.key)) return false;
    const rows = [...(containerRef.current?.querySelectorAll(focusSelector) || [])];
    if (!rows.length) return false;
    const activeElement = document.activeElement;
    const activeItem = activeElement?.closest?.('[data-feed-item-id]');
    const activeTarget = activeItem && containerRef.current?.contains(activeItem)
      ? activeItem.querySelector(focusSelector) || activeElement
      : activeElement;
    const index = rows.indexOf(activeTarget);
    const next = event.key === 'j' ? Math.min(rows.length - 1, index + 1) : Math.max(0, index - 1);
    const row = rows[next];
    row.focus({ preventScroll: true });
    row.scrollIntoView({ block: 'center', behavior: getPreferredScrollBehavior(row) });
  };

  useHotkey('j', move, { allowRepeat: true });
  useHotkey('k', move, { allowRepeat: true });
}
