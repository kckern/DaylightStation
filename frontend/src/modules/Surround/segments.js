// frontend/src/modules/Surround/segments.js
//
// Pure mapping in the direction the backend's `segments[]` doesn't already
// give us: given where the player actually IS -- one media item and a
// position inside it -- say which segment is current, and where that lands
// on the container's sounding-time rail. No React, no I/O; Task 6 (the rail)
// and Task 8 (segment transport) both build on this, so its contract matters
// more than its size.
//
// THE TIE-BREAK was decided once, on the backend, for the whole container --
// see the JSDoc on `withOffsets` in
// backend/src/1_adapters/content/surround/segments.mjs -- and is implemented
// here exactly, not re-decided:
//
//   A segment owns the half-open interval [offset, offset + duration). Where
//   several segments share one offset, the LAST of them wins. A zero-width
//   segment's interval is empty, so it is never current for any position. A
//   position landing exactly on a boundary belongs to the segment that is
//   STARTING, not the one that just ended.
//
// Offsets can only repeat when every segment between the ties has zero
// duration -- the rail only advances when a segment actually contributes
// sounding width -- so a tie is always "one or more untimed segments, then
// at most one real one starting where they were parked." That's the ordinary
// case (a trailing segment with no authored `musicEndsAt`, sitting on a part
// boundary). Genuine overlap of two REAL segments is rarer -- it only
// happens with hand-authored `spans:` -- but the same rule resolves it: scan
// forward and keep the LAST containing match rather than returning on the
// first. Returning early is the tempting shortcut and the wrong one: at a
// part boundary it would still happen to land on the right segment (the
// untimed one never matches), but the moment two real spans genuinely
// overlap it silently reports the wrong one.
export function segmentAt({ segments, contentId, position }) {
  const id = String(contentId ?? '');
  const list = Array.isArray(segments) ? segments : [];

  let matchIndex = -1;
  let matchGlobal = 0;
  // Sounding time already elapsed for THIS item as of `position`, given no
  // segment of it is currently sounding. Dead time is real state -- applause
  // before the first segment, a pause between two, or the tail after the
  // last -- and this is what the band renders while nothing sounds.
  let deadGlobal = 0;
  let sawOwned = false;

  for (let i = 0; i < list.length; i += 1) {
    const c = list[i];
    if (String(c.contentId) !== id) continue;

    if (!sawOwned) {
      // Before this item's own first segment is reached, the sounding total
      // is whatever the rail had already accumulated by the time this item's
      // music starts -- that segment's own offset, not 0. This is what makes
      // lead-in dead time (e.g. applause before a work's first segment) report
      // correctly even when the item isn't first in the container.
      deadGlobal = c.offset;
      sawOwned = true;
    }

    const hasTiming = c.start !== undefined && c.end !== undefined;

    if (hasTiming && position >= c.start && position < c.end) {
      // Do not return here. A later segment of the same item that also
      // contains `position` must overwrite this one -- the LAST match wins.
      matchIndex = i;
      matchGlobal = c.offset + (position - c.start);
      continue;
    }

    if (hasTiming && position >= c.end) {
      deadGlobal = c.offset + c.duration;
    }
  }

  if (matchIndex !== -1) return { index: matchIndex, globalSeconds: matchGlobal };
  return { index: -1, globalSeconds: deadGlobal };
}
