import { useLayoutEffect } from 'react';

/**
 * useCenterByWidest
 * -----------------
 * Centers a block of text content (e.g., hymn or poetry) by:
 *  1. Measuring the widest ".stanza" child inside the container
 *  2. Setting the container's width to that maximum natural width
 *  3. Applying a left margin so the container is horizontally centered within the nearest .textpanel
 *
 * Advantages over prior inline logic:
 *  - Uses useLayoutEffect to avoid visible reflow flicker
 *  - Handles dynamic content changes via deps array
 *  - Optional ResizeObserver to re-center on panel size changes
 *
 * @param {React.RefObject<HTMLElement>} containerRef - ref to the wrapping element (e.g., .hymn-text or .poetry-text)
 * @param {Array<any>} deps - dependency array to trigger recalculation (e.g., [verses])
 * @param {Object} options
 * @param {boolean} [options.observeResize=true] - attach a ResizeObserver to re-center on panel/container size changes
 */
export function useCenterByWidest(containerRef, deps = [], { observeResize = true, stanzaSelector = '.stanza', debug = false } = {}) {
  useLayoutEffect(() => {
    // Guard for SSR / non-DOM environments
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const el = containerRef.current;
    if (!el) return;

    let frameId = null;
    let resizeObserver = null;

    const log = (...args) => { if (debug) console.debug('[useCenterByWidest]', ...args); };

    const recalc = (phase = 'immediate') => {
      try {
        const currentEl = containerRef.current; // in case ref changes
        if (!currentEl) return;
        const panel = currentEl.closest('.textpanel');
        if (!panel) { log('no panel found, abort', phase); return; }

        // Reset width to natural size before measuring
        currentEl.style.width = 'auto';

        const stanzas = currentEl.querySelectorAll(stanzaSelector);
        if (!stanzas || stanzas.length === 0) { log('no stanzas yet', phase); return; }

        let maxWidth = 0;
        stanzas.forEach(stanza => {
          const w = stanza.offsetWidth;
            if (w > maxWidth) maxWidth = w;
        });

        if (maxWidth > 0) {
          currentEl.style.width = `${maxWidth}px`;
        }

        const panelWidth = panel.offsetWidth;
        const diff = panelWidth - maxWidth;
        const marginLeft = Math.max(0, diff / 2);
        currentEl.style.marginLeft = `${marginLeft}px`;
        log('recalc', { phase, maxWidth, panelWidth, marginLeft });
      } catch (err) {
        log('error during recalc', err);
      }
    };

    // Initial calculation (sync)
    recalc('layout');

    // Schedule a follow-up on the next frame to catch late layout / font loads
    frameId = window.requestAnimationFrame(() => recalc('raf'));

    if (observeResize) {
      try {
        const panel = el.closest('.textpanel');
        if (panel && 'ResizeObserver' in window) {
          resizeObserver = new ResizeObserver(() => recalc('resize-observer'));
          resizeObserver.observe(panel);
        } else if (panel) {
          window.addEventListener('resize', recalc);
        }
      } catch (err) {
        log('error setting up resize observer', err);
      }
    }

    return () => {
      if (frameId) cancelAnimationFrame(frameId);
      if (resizeObserver) {
        try { resizeObserver.disconnect(); } catch(e) { /* ignore */ }
      } else if (observeResize) {
        window.removeEventListener('resize', recalc);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
