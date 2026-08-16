/**
 * Which input moved when a React key changed.
 *
 * On 2026-08-16 a key change was the path that actually remounted the player —
 * roughly three hundred times in four minutes, opening 495 Plex transcode
 * sessions — and no site logged one. When we came to instrument them, a bare
 * before/after of the composite string turned out to be close to useless: the
 * player key carries a media guid AND a remount nonce, and the <dash-video> key
 * carries a url, a bitrate cap AND an element generation. "It was A, now it is
 * B" does not separate "the viewer picked something else" from "recovery is
 * looping on the same item". Naming the moved input does.
 *
 * Compare the INPUTS, never the joined string. Both key formats embed values
 * that contain the ':' separator themselves — compound plex ids, urls — so
 * splitting a composite key back into its parts is not reliable.
 */

/**
 * @param {Object|null} previous - the inputs behind the last key, or null on the
 *   first key of a run (which is a mount, not a change).
 * @param {Object} next - the inputs behind the key now being used.
 * @returns {string|null} the moved input names joined by '+', in the order the
 *   key declares them; null when nothing moved or there is no baseline.
 */
export function changedKeyComponent(previous, next) {
  if (!previous || !next) return null;
  const moved = Object.keys(next).filter((name) => !Object.is(previous[name], next[name]));
  return moved.length ? moved.join('+') : null;
}

export default changedKeyComponent;
