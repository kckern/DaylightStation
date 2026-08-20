// A timing value is only usable if it is a non-negative finite number — the
// same rule the store applies to `starts` entries before this module ever
// sees them. Exported so the store can share one definition instead of
// keeping a second copy in sync.
export const num = (v) => (Number.isFinite(v) && v >= 0 ? v : undefined);

/**
 * Normalise whatever timing an author supplied into one span per segment.
 *
 * `starts` + `musicEndsAt` is the compact form for a work whose segments run
 * end to end inside one file; it desugars here so nothing downstream has to
 * know two shapes. Explicit `spans` are taken verbatim, because the gap
 * between two of them is real content — applause — that belongs to neither.
 */
export function toSpans({ starts, musicEndsAt, spans, count }) {
  const out = [];
  if (Array.isArray(spans)) {
    for (let i = 0; i < count; i += 1) {
      const s = Array.isArray(spans[i]) ? spans[i] : [];
      out.push({ start: num(s[0]), end: num(s[1]) });
    }
    return out;
  }
  const list = Array.isArray(starts) ? starts : [];
  for (let i = 0; i < count; i += 1) {
    const start = num(list[i]);
    const next = i + 1 < count ? num(list[i + 1]) : num(musicEndsAt);
    out.push({ start, end: start === undefined ? undefined : next });
  }
  return out;
}

/**
 * Place segments on one rail measured in SOUNDING seconds. Dead time is not on
 * the rail at all, so a segment's width is the music it contains and nothing
 * else; a segment with no timing occupies no width and does not shift its
 * neighbours.
 *
 * ZERO-WIDTH SEGMENTS ARE NORMAL, and they make offsets non-unique: an untimed
 * segment shares its offset with whatever follows it. Nine of the nineteen
 * authored pieces have one today, almost always a trailing segment for want of
 * `musicEndsAt`, and in a composed container that lands exactly on a part
 * boundary.
 *
 * THE TIE-BREAK, stated once here so position mapping does not have to decide
 * it again: **a segment owns the half-open interval `[offset, offset + duration)`,
 * and where several segments share one offset the LAST of them wins.** A
 * zero-width segment's interval is empty, so it is never current for any
 * position; a position landing exactly on a boundary belongs to the segment
 * that is starting, not the one that just ended.
 *
 * Why: at a part boundary in a composed container the preceding segment is
 * usually the zero-width one. Resolving the boundary to it would name the
 * previous part's media item, and the transport would seek into the file that
 * has just finished — one wrong media item at every join, which reads as a
 * mapping bug rather than as the missing timing it actually is. The store warns
 * `surround.segments.untimed` so the condition is visible while it lasts.
 */
export function withOffsets(segments) {
  let offset = 0;
  return segments.map((c) => {
    const duration = c.start !== undefined && c.end !== undefined && c.end > c.start ? c.end - c.start : 0;
    const placed = { ...c, duration, offset };
    offset += duration;
    return placed;
  });
}
