// The change curtain: what covers the cut between two clips.
//
// A clip queue (one piece at a time, cut from many concerts) changes item every
// few minutes, and on Next at once. Without cover the change is a hard cut to a
// new picture under the OLD surround, and the new poster lands about a second
// later: it looks broken. So the frame drops a curtain over the whole screen the
// moment it sees a new item, and parts it once the new clip is READY — its
// surround drawn, every image in the frame loaded, and its picture playing
// inside its own window.
//
// The recipe is ArtMode's (frontend/src/composition/screens/widgets/ArtMode.css:
// two panels that meet at the centre seam and part by `transform`), so it
// composites and never animates `filter`. The dwell numbers mirror ArtMode's
// shape: a minimum so the gesture reads as one, a safety rail so a stalled asset
// can never leave the screen covered.

import { useEffect, useRef, useState } from 'react';

/** How long the panels take to meet. Short: the cut has already happened. */
export const CURTAIN_CLOSE_MS = 380;
/** How long the panels take to part. */
export const CURTAIN_OPEN_MS = 900;
/** Never part before this, measured from the close (minimum effect). */
export const CURTAIN_MIN_MS = 700;
/** Safety rail: always part by this, ready or not. */
export const CURTAIN_MAX_MS = 6000;
/** How often a closed curtain asks whether the new clip is ready. */
const CURTAIN_CHECK_MS = 120;

/**
 * Whether the new item may be revealed.
 * @param {object} args
 * @param {boolean} args.playing the clock says the picture is running.
 * @param {boolean} args.seeking the Player is seeking (a clip opens with one).
 * @param {number} args.position the media time, seconds.
 * @param {{segment: {start: number}}|null} args.clip the clip context, if any.
 * @param {boolean} args.imagesLoaded every <img> in the frame has finished.
 * @returns {boolean}
 */
export function curtainReady({ playing, seeking, position, clip, imagesLoaded }) {
  if (!playing || seeking || !imagesLoaded) return false;
  const start = clip?.segment?.start;
  // A clip seeks into its window on load; until it gets there the picture is
  // the concert's opening, which is exactly what the curtain is hiding.
  if (Number.isFinite(start) && !(Number.isFinite(position) && position >= start - 1)) return false;
  return true;
}

/** Every <img> under `root` is complete (loaded or failed for good). */
export function imagesSettled(root) {
  const imgs = root?.querySelectorAll ? [...root.querySelectorAll('img')] : [];
  return imgs.every((img) => img.hidden || img.complete);
}

/**
 * The curtain's state for one frame.
 * @returns {'open'|'closed'} closed covers the screen; open is parted.
 */
export function useChangeCurtain({
  enabled, contentId, clip, playing, seeking, position, rootRef, log,
}) {
  const [state, setState] = useState('open');
  const lastId = useRef(null);
  const wasClip = useRef(false);
  const closedAt = useRef(0);
  const live = useRef({});
  live.current = { playing, seeking, position, clip };

  // Close on a change of item, between two items either of which is a clip.
  useEffect(() => {
    if (!enabled) { lastId.current = null; wasClip.current = false; setState('open'); return; }
    const prev = lastId.current;
    const isClip = Boolean(clip);
    lastId.current = contentId;
    const clipChange = isClip || wasClip.current;
    wasClip.current = isClip;
    if (prev == null || prev === contentId || !clipChange) return;
    closedAt.current = Date.now();
    setState('closed');
    log?.info?.('surround.curtain.close', { from: prev, to: contentId });
  }, [enabled, contentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // While closed, part it once the new clip is ready (or the rail runs out).
  useEffect(() => {
    if (state !== 'closed') return undefined;
    const timer = setInterval(() => {
      const waited = Date.now() - closedAt.current;
      if (waited < CURTAIN_MIN_MS) return;
      const ready = curtainReady({ ...live.current, imagesLoaded: imagesSettled(rootRef.current) });
      if (!ready && waited < CURTAIN_MAX_MS) return;
      setState('open');
      if (ready) log?.info?.('surround.curtain.open', { contentId, waitedMs: waited });
      else log?.warn?.('surround.curtain.timeout', { contentId, waitedMs: waited, ...live.current, clip: undefined });
    }, CURTAIN_CHECK_MS);
    return () => clearInterval(timer);
  }, [state, contentId]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}
