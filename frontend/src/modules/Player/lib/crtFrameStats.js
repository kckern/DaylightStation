// crtFrameStats.js — presented-vs-drawn accounting for the CRT canvas.
//
// requestVideoFrameCallback gives each callback `metadata.presentedFrames`, a
// monotonic count of frames the browser has submitted for composition for that
// media element. If two consecutive callbacks differ by more than 1, our
// callback never ran for the frames in between, so the canvas never drew them:
// that is a VISIBLE drop the decoder's droppedVideoFrames does not record
// (2026-09-01 fitness "frame drops from the start" — droppedVideoFrames was 0
// in every sample while FitnessChart re-rendered 13-14x/s on the main thread).
//
// Under the requestAnimationFrame fallback there is no metadata at all; the
// draw still counts, the skip reading is simply unavailable.
//
// CAVEAT — these counters are PER RENDERER INSTANCE, not per session. The hook
// remounts the renderer on a context restore, a source change or a resolution
// change, and each new instance starts from zero: session fs_20260901100054
// logged crt.renderer-created twice 2.25s apart. Anyone totalling a session
// must sum every instance's crt.stopped or they will undercount.

export function createCrtFrameStats() {
  let drawn = 0;
  let skipped = 0;
  let last = null;
  return {
    /**
     * @param {number|undefined} presentedFrames rVFC metadata.presentedFrames
     * @returns {number} frames skipped since the previous observation
     */
    observe(presentedFrames) {
      drawn += 1;
      // No reading (rAF driver, or a browser that omits the field): count the
      // draw, leave the baseline alone so the next real reading is not a
      // spurious gap against a stale value.
      if (!Number.isFinite(presentedFrames)) return 0;
      let gap = 0;
      // Backwards or equal means a new media element / counter reset, not a
      // skip. Re-baseline without charging anything.
      if (last !== null && presentedFrames > last) gap = presentedFrames - last - 1;
      last = presentedFrames;
      skipped += gap;
      return gap;
    },
    snapshot() { return { drawn, skipped }; }
  };
}
