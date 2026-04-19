/**
 * Decide whether the scroll-to-highlighted-option effect should run.
 *
 * The effect re-fires when either highlightedIdx changes OR when displayItems.length
 * changes. The length-change case covers pagination load-more. We must NOT scroll
 * on pagination re-fires — that yanks the user's viewport back to the selected item.
 *
 * @param {object} args
 * @param {number} args.highlightedIdx - current highlighted option index
 * @param {number} args.prevIdx - previous highlighted index (ref.current)
 * @param {boolean} args.paginationInFlight - true if onScroll just dispatched a load-more
 * @returns {{ run: boolean, reason: string }}
 */
export function shouldRunScrollToHighlighted({ highlightedIdx, prevIdx, paginationInFlight }) {
  if (highlightedIdx < 0) return { run: false, reason: 'no-highlight' };
  if (prevIdx === -1) return { run: false, reason: 'initial-render' };
  if (paginationInFlight) return { run: false, reason: 'pagination' };
  if (highlightedIdx === prevIdx) return { run: false, reason: 'no-change' };
  return { run: true, reason: 'navigation' };
}
