// Conservative SVG-unit ink regions. Exact glyph intersections are checked by the
// independent browser mask harness; this module keeps placement decisions DOM-free.
export function crossStaffHits(regions, {
  air = 2
} = {}) {
  const hits = [];
  for (let i = 0; i < regions.length; i++) for (let j = i + 1; j < regions.length; j++) {
    const a = regions[i],
      b = regions[j];
    if (a.staff === b.staff) continue;
    if (a.x0 < b.x1 + air && b.x0 < a.x1 + air && a.y0 < b.y1 + air && b.y0 < a.y1 + air) hits.push({
      a,
      b
    });
  }
  return hits;
}
export function collectStaffInk({
  notes,
  beams = []
}) {
  const regions = [];
  for (const {
    note,
    staff,
    columnId = 0
  } of notes) {
    if (!note) continue;
    const x = note.getNoteHeadBeginX(),
      w = note.getGlyphWidth();
    for (const y of note.getYs()) regions.push({
      staff,
      columnId,
      kind: 'head',
      x0: x - 1,
      x1: x + w + 1,
      y0: y - 5.2,
      y1: y + 5.2
    });
    if (note.hasStem()) {
      const {
        topY,
        baseY
      } = note.getStemExtents();
      const sx = note.getStemX();
      regions.push({
        staff,
        columnId,
        kind: 'stem',
        x0: sx - 1,
        x1: sx + 1,
        y0: Math.min(topY, baseY),
        y1: Math.max(topY, baseY)
      });
    }
    const m = note.getMetrics();
    if (m.modLeftPx) regions.push({
      staff,
      columnId,
      kind: 'modifiers',
      x0: x - m.modLeftPx,
      x1: x,
      y0: Math.min(...note.getYs()) - 10,
      y1: Math.max(...note.getYs()) + 10
    });
  }
  for (const {
    beam,
    staff,
    columnId = 0
  } of beams) {
    const ns = beam.getNotes();
    const xs = ns.map(n => n.getStemX());
    const ys = ns.map(n => n.getStemExtents().topY);
    regions.push({
      staff,
      columnId,
      kind: 'beam',
      x0: Math.min(...xs),
      x1: Math.max(...xs),
      y0: Math.min(...ys) - 5,
      y1: Math.max(...ys) + 5
    });
  }
  return regions;
}

// Kept separate from stem voting: a correct bass-up vote may still cross a low
// treble ledger note. Both noteheads and their through-stem occupy the shared gap.
export function stemTouchesOther(note, other, direction) {
  if (!note || !other) return false;
  const own = note.getYs(),
    theirs = other.getYs();
  const top = direction === 1 ? Math.min(...own) - 35 : Math.min(...own);
  const bottom = direction === -1 ? Math.max(...own) + 35 : Math.max(...own);
  if (theirs.some(y => top < y + 7 && bottom > y - 7)) return true;
  const facesGap = note.clef === 'treble' ? direction === -1 : direction === 1;
  const otherDirection = other.getStemDirection();
  const otherFacesGap = other.clef === 'treble' ? otherDirection === -1 : otherDirection === 1;
  if (!facesGap || !otherFacesGap) return false;
  // A continuous beam can cross the opposite flagged stem even when both hands'
  // heads clear it. Include the flag above an upward tip and below a downward tip.
  const flagRoom = other.getDuration() === '8' ? 4 : 0;
  const otherTop = otherDirection === 1 ? Math.min(...theirs) - 35 - flagRoom : Math.min(...theirs);
  const otherBottom = otherDirection === -1 ? Math.max(...theirs) + 35 + flagRoom : Math.max(...theirs);
  return top < otherBottom + 7 && bottom > otherTop - 7;
}
export function staffDisplacement(tNote, bNote) {
  if (!tNote || !bNote) return 0;
  // Include stems/flags as well as heads. Only columns sharing vertical ink need
  // displacement; reserve all of the treble's right and bass's left modifier ink.
  const t = tNote.getBoundingBox(),
    b = bNote.getBoundingBox();
  const flagTop = note => Math.max(note.getDuration()==='8' && note.getStemDirection()===1 ? 4 : 0,
    note.getModifiers().some(m=>/^(8v|(?:15|22|29)m)a$/.test(m.text??''))?25:0);
  const flagBottom = note => Math.max(note.getDuration()==='8' && note.getStemDirection()===-1 ? 13 : 0,
    note.getModifiers().some(m=>/^(8v|(?:15|22|29)m)b$/.test(m.text??''))?25:0);
  if (t.getY()+t.getH()+flagBottom(tNote)+2 <= b.getY()-flagTop(bNote)
    || b.getY()+b.getH()+flagBottom(bNote)+2 <= t.getY()-flagTop(tNote)) return 0;
  const tm = tNote.getMetrics(),
    bm = bNote.getMetrics();
  return Math.ceil(tm.notePx + tm.modRightPx + tm.rightDisplacedHeadPx + bm.modLeftPx + bm.leftDisplacedHeadPx + 6);
}
