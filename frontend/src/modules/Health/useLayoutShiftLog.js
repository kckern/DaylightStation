import { useEffect, useRef } from 'react';
import { createAppLogger } from '../../lib/ui/createAppLogger.js';

const logger = createAppLogger('health').child('layout-shift');

/** Shifts closer together than this are one burst, and one log line. */
export const LAYOUT_SHIFT_BURST_MS = 1000;
const MAX_SOURCES = 3;

/** `div.health-suggest__popup` — enough to find the element, short enough to aggregate. */
export function shortSelector(node) {
  if (!node || typeof node.tagName !== 'string') return null; // text nodes, detached nodes
  const tag = node.tagName.toLowerCase();
  const classes = typeof node.className === 'string'
    ? node.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
  return classes.length ? `${tag}.${classes.join('.')}` : tag;
}

/**
 * Unexpected layout movement in the Health app, as `ui.layout-shift` info
 * events: one per 1 s burst, with the summed CLS value, how many shift entries
 * made it up, and up to three of the elements that moved. Shifts that follow
 * user input are excluded (the browser marks them `hadRecentInput`), so this
 * reports only the page moving on its own. Browsers without the Layout
 * Instability API (Firefox, Safari) log nothing.
 */
export function useLayoutShiftLog({ route = null, tab = null } = {}) {
  const where = useRef({ route, tab });
  where.current = { route, tab };
  useEffect(() => {
    const Observer = typeof window !== 'undefined' ? window.PerformanceObserver : undefined;
    if (typeof Observer !== 'function') return undefined;
    const supported = Observer.supportedEntryTypes;
    if (Array.isArray(supported) && !supported.includes('layout-shift')) return undefined;
    let burst = null;
    let timer = null;
    const flush = () => {
      timer = null;
      if (!burst) return;
      const { value, count, sources } = burst;
      burst = null;
      logger.sampled('ui.layout-shift', { value: Math.round(value * 10000) / 10000, count, sources, ...where.current },
        { maxPerMinute: 20 });
    };
    let observer;
    try {
      observer = new Observer((list) => {
        for (const entry of list.getEntries()) {
          if (entry.hadRecentInput) continue;
          if (!burst) { burst = { value: 0, count: 0, sources: [] }; timer = setTimeout(flush, LAYOUT_SHIFT_BURST_MS); }
          burst.value += Number(entry.value) || 0;
          burst.count += 1;
          for (const source of entry.sources || []) {
            if (burst.sources.length >= MAX_SOURCES) break;
            const selector = shortSelector(source?.node);
            if (selector && !burst.sources.includes(selector)) burst.sources.push(selector);
          }
        }
      });
      observer.observe({ type: 'layout-shift', buffered: false });
    } catch (err) {
      logger.debug('layout-shift.unavailable', { error: err?.message });
      return undefined;
    }
    return () => { observer.disconnect(); clearTimeout(timer); flush(); };
  }, []);
}

export default useLayoutShiftLog;
