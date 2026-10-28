/**
 * The recorded clip for one ring: the clip whose span holds the ring, else
 * the clip starting nearest the ring within the tolerance (a camera starts
 * recording a moment after the button, or a moment before on motion), else
 * null — the drawer then says there is no recording, never a broken player.
 */
export function matchRingToClip(ringMs, clips, { toleranceMs = 120_000 } = {}) {
  let nearest = null;
  let nearestGap = Infinity;
  for (const clip of clips || []) {
    const start = Date.parse(clip.start);
    const end = Date.parse(clip.end);
    if (!Number.isFinite(start)) continue;
    if (ringMs >= start && Number.isFinite(end) && ringMs <= end) return clip;
    const gap = Math.abs(start - ringMs);
    if (gap <= toleranceMs && gap < nearestGap) {
      nearest = clip;
      nearestGap = gap;
    }
  }
  return nearest;
}

export default matchRingToClip;
