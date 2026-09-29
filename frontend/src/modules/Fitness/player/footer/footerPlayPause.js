/**
 * What a press on the Fitness footer's play/pause button does.
 *
 * The element's `paused` flag is the wrong question while a video loads or
 * reloads: the loader has already called play(), so the element reads
 * un-paused with no frame on screen, and a toggle PAUSES it. On 2026-09-28
 * five presses during a reload produced five pauses and no picture. A press
 * on an un-paused element with no current frame (readyState < HAVE_CURRENT_DATA)
 * therefore means "play" — it re-asserts play and never pauses the loader.
 *
 * @param {{elPaused: boolean|null, readyState: number|null, hasToggle: boolean}} s
 * @returns {'play'|'pause'|'toggle'|'none'}
 */
const HAVE_CURRENT_DATA = 2;

export function decideFooterPlayPause({ elPaused, readyState, hasToggle }) {
  if (elPaused === null || elPaused === undefined) return hasToggle ? 'toggle' : 'none';
  if (elPaused) return 'play';
  if (Number.isFinite(readyState) && readyState < HAVE_CURRENT_DATA) return 'play';
  return 'pause';
}
