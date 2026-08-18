// pauseForensics.js — the state you need to explain an UNTAGGED pause.
//
// `playbackToggleSource.js` tags every pause our own code initiates. Anything
// left over reads as `'dom-event'`, which lumps together two very different
// causes: dash.js pausing the element internally, and the browser/OS pausing it
// out from under us (visibility change, audio-focus loss, media-session policy).
//
// On 2026-08-17 a singing lecture on the yellow-room tablet emitted a
// `dom-event` pause every 45.00s (±0.10s) for twelve minutes. The page was
// healthy (60-75fps, loopLag ~0ms, visible) and the buffer was 25-34s deep at
// every single pause, so neither a main-thread stall nor starvation explains it
// — and the log carried nothing else to narrow it further. This snapshot is the
// missing evidence: it separates "we ran out of data", "the document went
// hidden", "the element errored" and "none of the above, something external
// paused a perfectly healthy element".
//
// Pure and dependency-injected so it is testable without a DOM.

/** Seconds of contiguous buffered media ahead of `t`, or null if unknown. */
export function bufferAheadOf(buffered, t) {
  if (!buffered || typeof buffered.length !== 'number') return null;
  for (let i = 0; i < buffered.length; i += 1) {
    try {
      if (t >= buffered.start(i) && t <= buffered.end(i)) return Number((buffered.end(i) - t).toFixed(2));
    } catch (_) { return null; }
  }
  return 0; // playhead sits outside every buffered range
}

/**
 * Snapshot an element + its document at pause/resume time.
 *
 * @param {HTMLMediaElement} el
 * @param {Document} [doc] - injected for testing
 * @returns {object} flat, queryable fields (no nesting — the log store indexes
 *   `data.*` one level, and a nested payload silently returns empty rows).
 */
export function pauseForensics(el, doc = (typeof document !== 'undefined' ? document : null)) {
  const out = {};
  if (el) {
    out.readyState = el.readyState;
    out.networkState = el.networkState;
    out.bufferAheadSec = bufferAheadOf(el.buffered, el.currentTime);
    out.bufferedRanges = el.buffered?.length ?? null;
    out.playbackRate = el.playbackRate;
    out.seeking = !!el.seeking;
    out.ended = !!el.ended;
    out.muted = !!el.muted;
    out.volume = el.volume;
    out.errorCode = el.error?.code ?? null;
    out.errorMessage = el.error?.message || null;
  }
  if (doc) {
    out.visibilityState = doc.visibilityState ?? null;
    out.hidden = doc.hidden ?? null;
    try { out.hasFocus = typeof doc.hasFocus === 'function' ? doc.hasFocus() : null; }
    catch (_) { out.hasFocus = null; }
  }
  return out;
}

export default pauseForensics;
