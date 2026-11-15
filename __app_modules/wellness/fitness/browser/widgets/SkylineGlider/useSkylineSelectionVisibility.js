import { useLayoutEffect } from 'react';

/** Reveal a selected menu item inside this game's scroller, without moving ancestors. */
export default function useSkylineSelectionVisibility(containerRef, selectionKey) {
  useLayoutEffect(() => {
    const container = containerRef.current;
    const scroller = container?.closest('[data-skyline-scroll]');
    if (!scroller) return;
    let active = true;
    const reveal = () => {
      if (!active) return;
      const row = container.querySelector('[aria-pressed="true"]');
      if (!row) return;
      const bounds = scroller.getBoundingClientRect(), r = row.getBoundingClientRect();
      const inset = parseFloat(getComputedStyle(scroller).paddingTop) || 0;
      const top = bounds.top + inset, bottom = bounds.bottom - inset;
      if (r.height > bottom - top || r.top < top) scroller.scrollTop += r.top - top;
      else if (r.bottom > bottom) scroller.scrollTop += r.bottom - bottom;
    };
    reveal();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reveal);
    observer?.observe(scroller);
    document.fonts?.ready.then(reveal);
    document.fonts?.addEventListener('loadingdone', reveal);
    return () => { active = false; observer?.disconnect(); document.fonts?.removeEventListener('loadingdone', reveal); };
  }, [containerRef, selectionKey]);
}
