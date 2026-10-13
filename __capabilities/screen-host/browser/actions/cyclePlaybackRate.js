// cyclePlaybackRate.js — the playback-rate cycle event dispatch for
// ScreenActionHandler.jsx, split out so Fast Refresh can hot-reload the
// handler on its own.

/**
 * Tell the active Player to cycle its playback rate. We dispatch an event rather
 * than mutate the media element directly: a DOM poke can't reach the <video> inside
 * the dash-video shadow DOM and is overwritten by the Player's controlled rate.
 */
export function dispatchCyclePlaybackRate() {
  window.dispatchEvent(new CustomEvent('player:cycle-playback-rate'));
}
