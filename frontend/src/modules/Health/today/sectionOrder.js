// A meal's row ORDER while a number is being dragged, and the motion when the
// order does change.
//
// Meals sort heaviest-first (sortEntriesByCalories). A portion/numeric drag
// previews calories live, so re-sorting every frame moved the dragged row out
// from under the pointer. While a draft is live (from begin until the saved
// version is on screen — `usePortionControl().draft`), a section keeps the
// order it had when the draft began and only the values change. When the
// draft ends, the real order returns, and rows glide to it (FLIP), as they do
// for any other reorder (add, edit, delete, reload).
import { useLayoutEffect, useRef } from 'react';

export const entryKey = entry => String(entry?.row?.uuid ?? entry?.row?.id ?? '');
const childKey = row => String(row?.uuid ?? row?.id ?? '');

/** The id order of a sorted entry list, children included. */
export function orderSnapshot(entries) {
  return {
    top: entries.map(entryKey),
    children: Object.fromEntries(entries.filter(entry => entry.children?.length)
      .map(entry => [entryKey(entry), entry.children.map(childKey)])),
  };
}

const byFrozen = (items, keys, keyOf) => {
  if (!keys) return items;
  const rank = new Map(keys.map((key, index) => [key, index]));
  // Known ids keep their frozen place; anything new goes after them, in its
  // current (sorted) order. Array.prototype.sort is stable.
  return [...items].sort((a, b) => (rank.get(keyOf(a)) ?? Infinity) - (rank.get(keyOf(b)) ?? Infinity));
};

/** `entries` (freshly sorted) put back in a snapshot's order. */
export function applyFrozenOrder(entries, snapshot) {
  if (!snapshot) return entries;
  return byFrozen(entries, snapshot.top, entryKey).map(entry => (entry.children?.length && snapshot.children?.[entryKey(entry)]
    ? { ...entry, children: byFrozen(entry.children, snapshot.children[entryKey(entry)], childKey) }
    : entry));
}

/**
 * Hold a section's order while `frozen` is true. Returns the entries to render.
 * The snapshot is the order last RENDERED before the freeze, so a draft's
 * first preview frame cannot sneak a re-sort in.
 */
export function useFrozenOrder(sorted, frozen) {
  const last = useRef(null);
  const held = useRef(null);
  if (frozen) held.current ??= last.current ?? orderSnapshot(sorted);
  else held.current = null;
  const entries = frozen ? applyFrozenOrder(sorted, held.current) : sorted;
  last.current = orderSnapshot(entries);
  return entries;
}

const prefersReducedMotion = () => {
  try { return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches); } catch { return false; }
};

export const FLIP_CLASS = 'health-flip-moving';

/**
 * FLIP the direct children of `containerRef` that carry `data-entry-key`
 * when `orderKey` changes: each row that moved starts at its old offset
 * (inline translate) and transitions to its new place (FLIP_CLASS, token
 * motion). Positions are measured on EVERY commit (relative to the container,
 * so scrolling is not movement, and a height change elsewhere is not either),
 * but rows animate only on a commit whose order differs from the previous
 * one. Only rows whose position changed are touched; none under
 * prefers-reduced-motion. A new reorder mid-glide restarts from where the row
 * is drawn.
 */
export function useFlipMoves(containerRef, orderKey) {
  const positions = useRef(null);
  const lastKey = useRef(orderKey);
  const frame = useRef(0);
  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const base = root.getBoundingClientRect().top;
    const nodes = Array.from(root.children).filter(node => node.dataset?.entryKey);
    const next = new Map(nodes.map(node => [node.dataset.entryKey, node.getBoundingClientRect().top - base]));
    const before = positions.current;
    const reordered = lastKey.current !== orderKey;
    positions.current = next;
    lastKey.current = orderKey;
    if (!reordered || !before || prefersReducedMotion()) return;
    const moved = [];
    for (const node of nodes) {
      const from = before.get(node.dataset.entryKey);
      const delta = from == null ? 0 : from - next.get(node.dataset.entryKey);
      if (Math.abs(delta) < 1) continue;
      node.classList.remove(FLIP_CLASS);
      node.style.transform = `translateY(${delta}px)`;
      moved.push(node);
    }
    if (!moved.length) return;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      for (const node of moved) {
        node.classList.add(FLIP_CLASS);
        node.style.transform = '';
        const settle = event => {
          if (event.propertyName !== 'transform') return;
          node.classList.remove(FLIP_CLASS);
          node.removeEventListener('transitionend', settle);
        };
        node.addEventListener('transitionend', settle);
      }
    });
  });
  useLayoutEffect(() => () => cancelAnimationFrame(frame.current), []);
}
