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

/**
 * Target scrollTop that keeps the same content anchored after items are
 * prepended (viewport height grows by newScrollHeight - prevScrollHeight).
 *
 * @param {object} args
 * @param {number} args.prevScrollHeight - viewport.scrollHeight before prepend
 * @param {number} args.newScrollHeight - viewport.scrollHeight after prepend+layout
 * @param {number} args.prevScrollTop - viewport.scrollTop before prepend
 * @returns {number} the scrollTop to write so the anchored row stays put
 */
export function computeScrollRestore({ prevScrollHeight, newScrollHeight, prevScrollTop }) {
  return prevScrollTop + (newScrollHeight - prevScrollHeight);
}

/**
 * Decide whether the browse-level positioner should place the reference row.
 * Runs ONCE per browse level: the first render where the level presents a
 * reference highlight (idx >= 0) with items rendered. Re-entry for the same
 * level (pagination load-more, user arrow navigation) is suppressed so the
 * viewport is never yanked back to the reference.
 *
 * @param {object} a
 * @param {string|null} a.levelKey        - current browse level key (null when not browsing)
 * @param {string|null} a.positionedLevel - level key already positioned (from a ref)
 * @param {number} a.highlightIdx         - reference highlight index (-1 = none)
 * @param {number} a.itemsLength          - rendered browse item count
 * @returns {{ run: boolean, reason: string }}
 */
export function shouldPositionLevel({ levelKey, positionedLevel, highlightIdx, itemsLength }) {
  if (levelKey == null) return { run: false, reason: 'not-browsing' };
  if (positionedLevel === levelKey) return { run: false, reason: 'already-positioned' };
  if (highlightIdx < 0) return { run: false, reason: 'no-reference' };
  if (itemsLength <= 0) return { run: false, reason: 'no-items' };
  return { run: true, reason: 'position' };
}
