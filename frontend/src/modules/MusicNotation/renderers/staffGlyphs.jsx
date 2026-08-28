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

/** Engraved flat: tall stem + a bold solid bowl sitting on the notehead's line. */
export function FlatShape() {
  return (
    <>
      <line x1="-4.5" y1="-13" x2="-4.5" y2="8.5" stroke="currentColor" strokeWidth="2.4" />
      <path d="M -4.5 -4 C 4.5 -7.5, 8.5 2.5, -4.5 9.5 Z" fill="currentColor" />
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

  const targetW = lineSpacing * 3;
  const targetH = lineSpacing * 6;
  const targetX = 2;
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
