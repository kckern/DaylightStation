// frontend/src/modules/Surround/chapters.js
//
// Pure mapping in the direction the backend's `chapters[]` doesn't already
// give us: given where the player actually IS -- one media item and a
// position inside it -- say which chapter is current, and where that lands
// on the container's sounding-time rail. No React, no I/O; Task 6 (the rail)
// and Task 8 (chapter transport) both build on this, so its contract matters
// more than its size.
//
// THE TIE-BREAK was decided once, on the backend, for the whole container --
// see the JSDoc on `withOffsets` in
// backend/src/1_adapters/content/surround/chapters.mjs -- and is implemented
// here exactly, not re-decided:
//
//   A chapter owns the half-open interval [offset, offset + duration). Where
//   several chapters share one offset, the LAST of them wins. A zero-width
//   chapter's interval is empty, so it is never current for any position. A
//   position landing exactly on a boundary belongs to the chapter that is
//   STARTING, not the one that just ended.
//
// Offsets can only repeat when every chapter between the ties has zero
// duration -- the rail only advances when a chapter actually contributes
// sounding width -- so a tie is always "one or more untimed chapters, then
// at most one real one starting where they were parked." That's the ordinary
// case (a trailing chapter with no authored `musicEndsAt`, sitting on a part
// boundary). Genuine overlap of two REAL chapters is rarer -- it only
// happens with hand-authored `spans:` -- but the same rule resolves it: scan
// forward and keep the LAST containing match rather than returning on the
// first. Returning early is the tempting shortcut and the wrong one: at a
// part boundary it would still happen to land on the right chapter (the
// untimed one never matches), but the moment two real spans genuinely
// overlap it silently reports the wrong one.
export function chapterAt({ chapters, contentId, position }) {
  const id = String(contentId ?? '');
  const list = Array.isArray(chapters) ? chapters : [];

  let matchIndex = -1;
  let matchGlobal = 0;
  // Sounding time already elapsed for THIS item as of `position`, given no
  // chapter of it is currently sounding. Dead time is real state -- applause
  // before the first chapter, a pause between two, or the tail after the
  // last -- and this is what the band renders while nothing sounds.
  let deadGlobal = 0;
  let sawOwned = false;

  for (let i = 0; i < list.length; i += 1) {
    const c = list[i];
    if (String(c.contentId) !== id) continue;

    if (!sawOwned) {
      // Before this item's own first chapter is reached, the sounding total
      // is whatever the rail had already accumulated by the time this item's
      // music starts -- that chapter's own offset, not 0. This is what makes
      // lead-in dead time (e.g. applause before a work's first chapter) report
      // correctly even when the item isn't first in the container.
      deadGlobal = c.offset;
      sawOwned = true;
    }

    const hasTiming = c.start !== undefined && c.end !== undefined;

    if (hasTiming && position >= c.start && position < c.end) {
      // Do not return here. A later chapter of the same item that also
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
