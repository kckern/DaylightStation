import { useEffect, useRef } from 'react';

const BACK_KEYS = ['Escape', 'BrowserBack', 'GoBack', 'GamepadSelect', 'Backspace'];
const SELECT_KEYS = ['Enter', ' ', 'Select', 'GamepadA'];

/** Enabled controls in `scope`, grouped by their nearest [data-nav-row]. */
function rows(scope) {
  const out = [];
  const index = new Map();
  for (const el of scope.querySelectorAll('button:not(:disabled), input:not(:disabled)')) {
    const row = el.closest('[data-nav-row]') || el;
    if (!index.has(row)) { index.set(row, out.length); out.push([]); }
    out[index.get(row)].push(el);
  }
  return out;
}

/**
 * D-pad navigation for a TV remote: up/down moves between rows, left/right
 * within a row, OK clicks, Back calls onBack. Listens in the capture phase so
 * the host screen's own Escape handling never sees a key this view used.
 * Focus is kept inside `scope` even when a poll re-renders the row it was on.
 */
export function useRemoteFocus({ scope, onBack }) {
  const back = useRef(onBack);
  back.current = onBack;

  useEffect(() => {
    const el = scope.current;
    if (el && !el.contains(document.activeElement)) rows(el)[0]?.[0]?.focus();
  });

  useEffect(() => {
    const key = (event) => {
      const el = scope.current;
      if (!el) return;
      const typing = event.target?.tagName === 'INPUT';
      if (BACK_KEYS.includes(event.key) || event.keyCode === 4) {
        if (typing && event.key === 'Backspace') return;
        event.preventDefault(); event.stopImmediatePropagation();
        back.current?.();
        return;
      }
      const grid = rows(el);
      if (!grid.length) return;
      let r = grid.findIndex((row) => row.includes(document.activeElement));
      let c = r < 0 ? -1 : grid[r].indexOf(document.activeElement);
      if (event.key.startsWith('Arrow')) {
        if (typing && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (r < 0) { grid[0][0].focus(); return; }
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          r = Math.max(0, Math.min(grid.length - 1, r + (event.key === 'ArrowUp' ? -1 : 1)));
          c = Math.min(c, grid[r].length - 1);
        } else {
          c = Math.max(0, Math.min(grid[r].length - 1, c + (event.key === 'ArrowLeft' ? -1 : 1)));
        }
        grid[r][c].focus();
        grid[r][c].scrollIntoView?.({ block: 'nearest' });
      } else if (SELECT_KEYS.includes(event.key) || event.keyCode === 23) {
        if (typing) return; // the PIN form submits itself
        event.preventDefault(); event.stopImmediatePropagation();
        if (!event.repeat) document.activeElement?.click?.();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [scope]);
}
