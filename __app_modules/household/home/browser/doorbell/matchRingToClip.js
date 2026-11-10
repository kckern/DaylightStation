/**
 * The recorded clip for one ring: the clip nearest the ring, measured to its
 * nearest edge — zero inside the clip, `start - ring` before it, `ring - end`
 * after it — within the tolerance. A camera records on motion, so the clip
 * that shows the visitor may end a moment before the button or start a moment
 * after. Nothing that close is null: the drawer then says there is no
 * recording, never a broken player.
 */
export function matchRingToClip(ringMs, clips, { toleranceMs = 120_000 } = {}) {
  let nearest = null;
  let nearestGap = Infinity;
  for (const clip of clips || []) {
    const start = Date.parse(clip.start);
    if (!Number.isFinite(start)) continue;
    const parsedEnd = Date.parse(clip.end);
    const end = Number.isFinite(parsedEnd) ? parsedEnd : start;
    let gap = 0;
    if (ringMs < start) gap = start - ringMs;
    else if (ringMs > end) gap = ringMs - end;
    if (gap <= toleranceMs && gap < nearestGap) {
      nearest = clip;
      nearestGap = gap;
      if (gap === 0) break;
    }
  }
  return nearest;
}

export default matchRingToClip;
