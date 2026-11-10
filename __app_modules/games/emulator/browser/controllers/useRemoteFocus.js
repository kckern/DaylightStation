import { useEffect, useRef } from 'react';

const BACK_KEYS = ['Escape', 'BrowserBack', 'GoBack', 'GamepadSelect', 'Backspace'];
const SELECT_KEYS = ['Enter', ' ', 'Select', 'GamepadA'];

/** Enabled controls in `scope`, grouped by their nearest [data-nav-row]. */
function rows(scope) {
  const out = [];
  const index = new Map();
  for (const el of scope.querySelectorAll('button:not(:disabled), input:not(:disabled)')) {
    const row = el.closest('[data-nav-row]') || el;
    if (!index.has(row)) { index.set(row, out.length); out.push(Object.assign([], { key: row.getAttribute?.('data-nav-row') || null })); }
    out[index.get(row)].push(el);
  }
  return out;
}

/**
 * Where focus goes when the focused control vanished (a poll swapped a row's
 * buttons, or disabled them): the same row by key, else the same position.
 */
function restore(grid, last) {
  if (!grid.length) return null;
  const same = last?.key ? grid.find((row) => row.key === last.key) : null;
  const row = same || grid[Math.min(last?.row ?? 0, grid.length - 1)];
  return row[Math.min(last?.col ?? 0, row.length - 1)];
}

/**
 * D-pad navigation for a TV remote: up/down moves between rows, left/right
 * within a row, OK clicks, Back calls onBack. Listens in the capture phase so
 * the host screen's own Escape handling never sees a key this view used.
 * Focus is kept inside `scope` even when a poll re-renders the row it was on.
 */
export function useRemoteFocus({ scope, onBack, ignore }) {
  const back = useRef(onBack);
  back.current = onBack;
  const skip = useRef(ignore);
  skip.current = ignore;
  const memory = useRef(new WeakMap());

  // Remember where focus is per scope element — an overlay's position never
  // steers the list underneath, and closing one lands back on the row it came
  // from. Put focus back there whenever its control vanishes.
  const remember = (el) => {
    const grid = rows(el);
    const r = grid.findIndex((row) => row.includes(document.activeElement));
    if (r >= 0) memory.current.set(el, { key: grid[r].key, row: r, col: grid[r].indexOf(document.activeElement) });
    return { grid, found: r >= 0 };
  };
  const mine = (el) => memory.current.get(el) || null;

  useEffect(() => {
    const el = scope.current;
    if (!el) return;
    const { grid, found } = remember(el);
    if (!found) restore(grid, mine(el))?.focus();
  });

  useEffect(() => {
    const el = scope.current;
    if (!el) return undefined;
    const track = () => remember(el);
    el.addEventListener('focusin', track);
    return () => el.removeEventListener('focusin', track);
  }, [scope]);

  useEffect(() => {
    const key = (event) => {
      const el = scope.current;
      if (!el) return;
      if (skip.current?.(event)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
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
        if (r < 0) { restore(grid, mine(el))?.focus(); return; }
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
