// caretGeometry.js — pure caret positioning math for CaretLayer.jsx (and
// EditorSurface.jsx's wet-ink override, which needs the identical numbers),
// split out so Fast Refresh can hot-reload the caret layer on its own.

/**
 * The caret's VERTICAL extent against a stave — its own geometry, independent of
 * any note. ALL THREE positioning tiers resolve their band through this, so the
 * caret never changes height or shifts vertically as it moves between them.
 *
 * WHY the band is the STAVE's and not the note's: a caret is an INSERTION POINT,
 * not a note. It marks where the NEXT note will go, and that note's pitch is
 * unknown — so there is nothing for it to track vertically. Sizing it from the
 * last engraved note's box made it bounce up and down the staff as the kid
 * played, and made it jump diagonally on every settle (the wet tier already used
 * the stave band, so the two disagreed by a ledger line for anything off-staff).
 *
 * Exported because EditorSurface's wet-ink override needs the identical numbers.
 * The 40 * scale floor is the engraved path's original floor, kept verbatim.
 */
export function staveCaretMetrics(staff, scale = 1) {
  return { top: staff.top, height: Math.max(40 * scale, staff.lineSpacing * 4) };
}

/** Which stave band a y pixel falls in — nearest band wins, so a ledger-line
 *  note above or below the staff still resolves to its own system. Lives here
 *  with the rest of the caret geometry; EditorSurface imports it for the wet-ink
 *  anchor, so the caret and the wet layer can never disagree about which system
 *  a given note belongs to. */
export function systemForY(y, staves) {
  let best = 0;
  let bestDist = Infinity;
  staves.forEach((s, i) => {
    const bottom = s.top + s.lineSpacing * 4;
    const d = y < s.top ? s.top - y : (y > bottom ? y - bottom : 0);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
}
