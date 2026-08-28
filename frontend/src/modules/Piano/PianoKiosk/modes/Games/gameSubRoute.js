// gameSubRoute.js — sub-route navigation target math for Games.jsx, split
// out so Fast Refresh can hot-reload the mode's routes on their own.

/**
 * Relative destination for a game-owned URL segment.
 *
 * From /games/hero, append the first segment directly. Once a segment already
 * exists, replace that leaf with a sibling. Re-appending the game id from the
 * latter state produces /hero/hero/:segment.
 */
export function gameSubRouteTarget(currentSubRoute, next) {
  if (!next) return currentSubRoute ? '..' : '.';
  return currentSubRoute ? `../${next}` : next;
}
