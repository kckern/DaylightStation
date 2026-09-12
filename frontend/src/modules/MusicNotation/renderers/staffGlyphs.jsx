import { useRef, useEffect, useState, useCallback } from 'react';

// Engraving primitives shared by every hand-rolled SVG staff in this folder —
// the single-simultaneity `SvgStaffRenderer` and the ordered `SvgSequenceStaff`.
//
// Extracted verbatim from SvgStaffRenderer (behaviour-preserving) rather than
// copied into the second renderer: these are the pieces where a divergence
// would be invisible in tests but obvious to a child — an accidental that
// reads as a blob on one surface and as ink on another, a clef that scales on
// one staff and not the next.

// Accidental glyph box (viewBox units), centered on the notehead's y. Drawn as
// SVG shapes — never a Unicode <text>: font glyphs render thin, small, and
// with unpredictable metrics on the kiosk WebView, and overlapped the
// notehead. 26 units ≈ 1.9 staff spaces tall — reads as part of the note.
export const ACCIDENTAL_WIDTH = 11;
export const ACCIDENTAL_HEIGHT = 26;
/** Clear air between the accidental's right edge and the notehead's left edge. */
export const ACCIDENTAL_GAP = 3;
export const NOTEHEAD_RX = 9;
export const NOTEHEAD_RY = 6.5;

/**
 * How far LEFT of its own origin each accidental's ink actually reaches.
 *
 * Not ACCIDENTAL_WIDTH / 2. That is the nominal column box used for spacing, and
 * a flat is not centred in it: its stem sits at x = -6.5 with a 2.4 stroke, so
 * its ink starts at -7.7 while the box says -5.5. Anything positioning an
 * accidental against a hard boundary — the clef, the edge of the staff — has to
 * ask for the real extent or it will place the glyph two units inside whatever
 * it was trying to clear, which is exactly enough to look like a mistake.
 */
export const ACCIDENTAL_INK_LEFT = Object.freeze({ sharp: 5.5, flat: 7.7 });

/**
 * Gap between two accidental columns.
 *
 * Tighter than a full glyph box on purpose: two accidentals are only ever in
 * separate columns BECAUSE they are at different heights, so their boxes may
 * overlap horizontally without their ink ever meeting. Engraving does the same.
 * The slack matters — on a 100-unit staff a bass-clef triad carrying two
 * accidentals and a displaced notehead has no room to spare.
 */
export const ACCIDENTAL_COLUMN_PITCH = ACCIDENTAL_WIDTH - 1;

/** Where `ClefGlyph` places itself, so callers can keep their ink off it. */
export const CLEF_X = 2;
/**
 * Two and a bit staff spaces, which is about what a bass clef is.
 *
 * This was three spaces. The treble clef never noticed — it is tall and narrow,
 * so its scale is decided by the height constraint and it comes out around two
 * spaces wide whatever this says. The BASS clef is wide enough that this is what
 * binds, so three spaces drew it fatter than a printed one and, worse, reserved
 * a third of the staff's width before a single note was placed. On the rank rim
 * — bass clef, and the axis that gets the triads — that was the difference
 * between a card that fits and a card whose accidentals sit on the clef.
 */
export const clefWidth = (lineSpacing) => lineSpacing * 2.2;
/**
 * The x a staff's own ink must stay right of.
 *
 * The clef is drawn first and its box is fixed, but nothing downstream knew
 * that: accidentals were laid out purely relative to the noteheads, so a chord
 * needing two of them staggered the second one left to x ≈ 34 while the clef
 * occupied 2…44, and the two were simply drawn on top of each other. Any staff
 * placing ink leftward from the noteheads asks this where to stop.
 */
export const clefRightEdge = (lineSpacing) => CLEF_X + clefWidth(lineSpacing) + 2;

/** Engraved sharp: two verticals + two thick bars slanting up to the right. */
export function SharpShape() {
  return (
    <>
      <line x1="-2.6" y1="-10.5" x2="-2.6" y2="13" stroke="currentColor" strokeWidth="2" />
      <line x1="2.6" y1="-13" x2="2.6" y2="10.5" stroke="currentColor" strokeWidth="2" />
      {/* Bars as filled parallelograms — the thick strokes that make the glyph read at a glance. */}
      <path d="M -5.5 -1.9 L 5.5 -4.9 L 5.5 -8.9 L -5.5 -5.9 Z" fill="currentColor" />
      <path d="M -5.5 6.6 L 5.5 3.6 L 5.5 -0.4 L -5.5 2.6 Z" fill="currentColor" />
    </>
  );
}

/**
 * Engraved flat: tall stem + an open bowl sitting on the notehead's line.
 *
 * The bowl is a RING, drawn as an outer shape with an inner counter subtracted
 * (`fill-rule="evenodd"`), not the solid teardrop it used to be. A ♭ without its
 * counter is not a flat, it is a blob — at rim-card size the reader who noticed
 * was looking at a row of B flats and seeing filled lozenges. The counter also
 * does the engraving work for free: the ring is widest where the bowl bulges
 * right and narrows to nothing where it meets the stem, which is the weight
 * distribution of the printed glyph.
 *
 * The two subpaths meet at the stem and the inner one stops short of the
 * bottom, so the bowl's lower tip stays solid ink where it joins the stem.
 *
 * REGISTERED ON THE BOWL, not on the glyph's overall extent. Every caller
 * places an accidental with `translate(x, noteY)` — the contract stated at the
 * top of this file, "centered on the notehead's y" — and a sharp honours it
 * because it is symmetric about its own origin. A flat is not symmetric: its
 * stem rises far above the bowl, so a glyph centred on its bounding box hangs
 * roughly 2.75 units BELOW the note it modifies, on every surface that draws
 * one. The coordinates below put the bowl's centre at (0, 0) instead, so the
 * shared contract is true for both glyphs and neither caller has to know which
 * one it is holding.
 */
export function FlatShape() {
  return (
    <>
      <line x1="-6.5" y1="-15.75" x2="-6.5" y2="5.75" stroke="currentColor" strokeWidth="2.4" />
      <path
        d="M -6.5 -7.4 C 3.4 -11.0, 7.6 -0.4, -6.5 7.4 Z
           M -5.1 -4.9 C 1.5 -7.3, 4.2 -0.8, -5.1 4.4 Z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </>
  );
}

/**
 * Ledger-line y coordinates for one notehead.
 *
 * Positions are staff half-steps above the bottom line (see model/pitch.js), so
 * lines live at the even positions below 0 and above 8.
 *
 * @param {number} position
 * @param {number} bottomLineY - y of the staff's bottom line in viewBox units
 * @param {number} stepSize - viewBox units per half-step (lineSpacing / 2)
 * @returns {number[]}
 */
export function ledgerLineYs(position, bottomLineY, stepSize) {
  const ys = [];
  if (position < 0) {
    for (let p = -2; p >= position; p -= 2) ys.push(bottomLineY - p * stepSize);
  }
  if (position > 8) {
    for (let p = 10; p <= position; p += 2) ys.push(bottomLineY - p * stepSize);
  }
  return ys;
}

/**
 * The clef, drawn as the Unicode musical glyph and scaled to the staff by
 * measuring its own rendered box.
 *
 * The glyph is the one place a font is unavoidable, so its metrics are measured
 * rather than assumed: `getBBox()` gives the real ink box, which is then scaled
 * and translated onto the staff. It stays invisible until measured so a
 * mis-sized first frame never flashes.
 *
 * @param {'treble'|'bass'} clef
 * @param {number} lineSpacing - viewBox units between staff lines
 * @param {number} bottomLineY - y of the staff's bottom line
 */
export function ClefGlyph({ clef, lineSpacing, bottomLineY }) {
  const clefRef = useRef(null);
  const [clefTransform, setClefTransform] = useState('');
  const [clefReady, setClefReady] = useState(false);

  const targetW = clefWidth(lineSpacing);
  const targetH = lineSpacing * 6;
  const targetX = CLEF_X;
  const targetY = bottomLineY - lineSpacing * 5;

  const measureClef = useCallback((node) => {
    if (!node) return;
    clefRef.current = node;
    try {
      const bbox = node.getBBox();
      if (bbox.width === 0 || bbox.height === 0) return;
      const scale = Math.min(targetW / bbox.width, targetH / bbox.height);
      const tx = targetX - bbox.x * scale;
      const ty = targetY - bbox.y * scale;
      setClefTransform(`translate(${tx}, ${ty}) scale(${scale})`);
      setClefReady(true);
    } catch (e) { /* getBBox can throw if not rendered */ }
  }, [targetW, targetH, targetX, targetY]);

  useEffect(() => {
    if (clefRef.current) measureClef(clefRef.current);
  }, [clef, measureClef]);

  return (
    <text
      ref={measureClef}
      fontSize="200"
      fill="rgba(0,0,0,0.5)"
      fontFamily="serif"
      /* Stated rather than inherited: a container with a bold or italic
         font makes the browser SYNTHESISE those on the clef glyph, which
         smears an engraved shape into a faux-bold blob. */
      fontWeight="normal"
      fontStyle="normal"
      transform={clefTransform}
      opacity={clefReady ? 1 : 0}
    >
      {clef === 'treble' ? '\u{1D11E}' : '\u{1D122}'}
    </text>
  );
}
