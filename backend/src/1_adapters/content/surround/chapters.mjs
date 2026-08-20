// A timing value is only usable if it is a non-negative finite number — the
// same rule the store applies to `starts` entries before this module ever
// sees them. Exported so the store can share one definition instead of
// keeping a second copy in sync.
export const num = (v) => (Number.isFinite(v) && v >= 0 ? v : undefined);

/**
 * Normalise whatever timing an author supplied into one span per chapter.
 *
 * `starts` + `musicEndsAt` is the compact form for a work whose chapters run
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
 * Place chapters on one rail measured in SOUNDING seconds. Dead time is not on
 * the rail at all, so a segment's width is the music it contains and nothing
 * else; a chapter with no timing occupies no width and does not shift its
 * neighbours.
 *
 * ZERO-WIDTH CHAPTERS ARE NORMAL, and they make offsets non-unique: an untimed
 * chapter shares its offset with whatever follows it. Nine of the nineteen
 * authored pieces have one today, almost always a trailing chapter for want of
 * `musicEndsAt`, and in a composed container that lands exactly on a part
 * boundary. So anything mapping a rail position back to a chapter must state a
 * tie-break rather than take the first match, and the tie-break is: at a shared
 * offset the LATER chapter wins. A zero-width chapter has already finished by
 * the time the rail reaches it — treating it as current would strand the
 * transport in the previous part's media item at every boundary. The store
 * warns `surround.chapters.untimed` so the condition is visible while it lasts.
 */
export function withOffsets(chapters) {
  let offset = 0;
  return chapters.map((c) => {
    const duration = c.start !== undefined && c.end !== undefined && c.end > c.start ? c.end - c.start : 0;
    const placed = { ...c, duration, offset };
    offset += duration;
    return placed;
  });
}
