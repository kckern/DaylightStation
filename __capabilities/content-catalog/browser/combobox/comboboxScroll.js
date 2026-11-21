/**
 * Decide whether the scroll-to-highlighted-option effect should run.
 *
 * The same option can move to a new index when a page prepends. Its
 * position belongs to the scroll anchor while it remains highlighted.
 *
 * @param {object} args
 * @param {number} args.highlightedIdx - current highlighted option index
 * @param {number} args.prevIdx - previous highlighted index (ref.current)
 * @param {boolean} args.hasSameHighlight - the option ID is still highlighted
 * @returns {{ run: boolean, reason: string }}
 */
export function shouldRunScrollToHighlighted({ highlightedIdx, prevIdx, hasSameHighlight }) {
  if (highlightedIdx < 0) return { run: false, reason: 'no-highlight' };
  if (prevIdx === -1) return { run: false, reason: 'initial-render' };
  if (hasSameHighlight || highlightedIdx === prevIdx) return { run: false, reason: 'no-change' };
  return { run: true, reason: 'navigation' };
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
