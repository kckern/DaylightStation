// One rule for long lists (__docs/reference/frontend/design-system.md, "Show
// the few that matter, then More"): the top `n` by the caller's ranking, then
// everything else behind one "More (k)". Pure, so every surface and its tests
// share one copy.
//
//   - `rank`      a comparator; without one the input order is the ranking.
//   - `keepIds`   ids that are always in the top part (the active, current or
//                 selected item): one ranked below the cut is lifted into the
//                 top in its ranked place, never hidden.
//   - `canTop`    items that fail it go under More whatever their rank (an
//                 offline screen, a browser tab) unless they are kept; a kept
//                 item that fails it is shown without taking one of the n.
//   - a More that would hide exactly one item is not worth its own row: that
//     item is shown instead.

/**
 * @template T
 * @param {T[]} items
 * @param {{ n: number, rank?: ((a: T, b: T) => number)|null, keepIds?: Iterable<string>,
 *   getId?: (item: T) => string|null|undefined, canTop?: ((item: T) => boolean)|null }} options
 * @returns {{ top: T[], more: T[] }}
 */
export function splitTopMore(items, { n, rank = null, keepIds = [], getId = (item) => item?.id, canTop = null } = {}) {
  const list = Array.isArray(items) ? items.slice() : [];
  const ordered = typeof rank === 'function' ? list.sort(rank) : list;
  const keep = new Set([...(keepIds ?? [])].filter((id) => id != null));
  const limit = Math.max(0, Number.isFinite(n) ? Math.floor(n) : ordered.length);
  const kept = (item) => keep.has(getId(item));
  // Slots go to items that may be on top; a kept item that may not (say, a
  // screen with something on, listed besides the top few) is added on top of n.
  const eligible = (item) => !canTop || canTop(item);

  const inTop = new Set();
  let slots = limit;
  for (const item of ordered) {
    if (slots === 0) break;
    if (!eligible(item)) continue;
    inTop.add(item);
    slots -= 1;
  }
  for (const item of ordered) if (kept(item)) inTop.add(item);
  const left = ordered.filter((item) => !inTop.has(item));
  // "More (1)" costs a row to hide a row: show the one instead.
  if (left.length === 1) inTop.add(left[0]);

  return {
    top: ordered.filter((item) => inTop.has(item)),
    more: ordered.filter((item) => !inTop.has(item)),
  };
}

export default splitTopMore;
