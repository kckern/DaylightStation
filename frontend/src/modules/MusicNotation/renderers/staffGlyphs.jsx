
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
 * THE HOUSE GHOST. One treatment, written once, for every staff in the app.
 *
 * A ghost is a key the player is holding, drawn at the pitch it actually
 * landed on. It is never a verdict — the target it displaced is coloured
 * miss-red in its own right — so it is "you are here" and nothing more:
 * SEMI-OPAQUE BLACK INK, never a hue, never a dashed outline.
 *
 * It is here rather than in either renderer's stylesheet because it drifted.
 * The ordered staff drew a 45%-black filled head (2026-08-27); the
 * single-simultaneity staff, fixing a genuinely invisible 7%-black ghost of its
 * own, reached for a hollow dashed ellipse instead of for this value
 * (2026-09-11, `0907aa4de`). The result was one child looking at two different
 * pictures of the same fact on two surfaces of the same game — the exercise run
 * and the board rim beside it. A shared constant is the only version of "the
 * house style" that a third renderer cannot quietly fork.
 *
 * Applied as ATTRIBUTES, not as a class, for the same reason: a stylesheet
 * cannot import this file, so a class-based rule would be a second copy of
 * these numbers that nothing keeps honest.
 */
export const GHOST_INK = Object.freeze({
  /** The notehead: filled, solid-stroked, no dash. */
  head: Object.freeze({ fill: 'rgba(0, 0, 0, 0.45)', stroke: 'rgba(0, 0, 0, 0.6)', strokeWidth: 1 }),
  /** Its ledger lines: lighter than the head, still solid — a dashed ledger reads as a different KIND of line. */
  ledger: Object.freeze({ stroke: 'rgba(0, 0, 0, 0.35)', strokeWidth: 1 }),
  /** Its accidental, drawn with `currentColor` by the glyph shapes. */
  accidental: 'rgba(0, 0, 0, 0.55)',
});

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
 * How wide each clef actually is, in staff spaces — from the outlines below,
 * not from a guess.
 *
 * This was a single constant, `lineSpacing * 2.2`, chosen as "about what a bass
 * clef is" because a font glyph's real width was never knowable here. The
 * outlines know: a G clef is 2.68 spaces and an F clef 2.74. A caller that
 * names its clef reserves what that clef needs; one that cannot reserves the
 * wider of the two, which is the only safe answer when the staff has not
 * decided yet.
 */
const CLEF_WIDTH_SPACES = Object.freeze({ treble: 2.684, bass: 2.736 });
const WIDEST_CLEF_SPACES = Math.max(...Object.values(CLEF_WIDTH_SPACES));
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
export const clefWidth = (lineSpacing, clef = null) => (
  lineSpacing * (clef ? CLEF_WIDTH_SPACES[clef === 'bass' ? 'bass' : 'treble'] : WIDEST_CLEF_SPACES)
);
/**
 * The x a staff's own ink must stay right of.
 *
 * The clef is drawn first and its box is fixed, but nothing downstream knew
 * that: accidentals were laid out purely relative to the noteheads, so a chord
 * needing two of them staggered the second one left to x ≈ 34 while the clef
 * occupied 2…44, and the two were simply drawn on top of each other. Any staff
 * placing ink leftward from the noteheads asks this where to stop.
 */
export const clefRightEdge = (lineSpacing, clef = null) => CLEF_X + clefWidth(lineSpacing, clef) + 2;

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
/**
 * THE CLEFS, AS OUTLINES, ANCHORED ON THE LINE THEY NAME.
 *
 * These were a Unicode <text> glyph (U+1D11E / U+1D122) in `serif`, scaled to
 * fit a box by measuring its bounding box at runtime and pinning the TOP of
 * that box one space above the staff. Both halves of that are wrong.
 *
 * A clef is not placed by its outline. It is placed by the line it names: a G
 * clef's spiral curls around the G line (second from the bottom), an F clef's
 * two dots straddle the F line (second from the top). Fitting a bounding box
 * into a fixed frame says nothing about where either landmark ends up — so the
 * treble curl sat about a quarter space above its line and the whole glyph came
 * out ~15% small, while the bass clef, whose natural shape is short and wide,
 * had the WIDTH constraint bind and was left floating a full space above where
 * it belongs at ~80% size, its dots nowhere near the F line.
 *
 * Worse, none of it was deterministic: the measurement is of whatever font the
 * device resolved for `serif`, so the same card engraved differently on the
 * kiosk WebView than in a test. This file's own opening note already says why
 * notation is drawn as shapes and never as font glyphs; the clefs were the last
 * thing in the engraver still breaking that rule.
 *
 * The outlines below are Bravura's, the SMuFL reference font — the same
 * typeface OSMD engraves the full score pages with elsewhere in this app, so a
 * clef on a rim card is now the clef on a page. They are expressed in STAFF
 * SPACES with the origin ON the defining line, which is SMuFL's own convention,
 * so drawing one is `translate(x, lineY) scale(lineSpacing)` and nothing else:
 * no measuring, no state, no effect, and the same picture everywhere.
 *
 * Bravura (C) Steinberg Media Technologies GmbH, SIL Open Font License 1.1.
 * Path data converted from the outlines vendored in `vexflow` (MIT).
 */
export const CLEFS = Object.freeze({
  treble: Object.freeze({
    /** The G line — second from the bottom, one space above the bottom line. */
    anchorSpacesAboveBottomLine: 1,
    width: 2.684,
    left: 0,
    /** Extents above and below the anchor, for any host sizing a box around it. */
    above: 4.392,
    below: 2.632,
    d: 'M1.5029 -1.6612 C1.4973 -1.7084 1.5029 -1.7112 1.5279 -1.7362 C1.9612 -2.139 2.289 -2.6474 2.289 -3.2613 C2.289 -3.6085 2.1918 -3.953 2.0279 -4.1919 C1.9668 -4.2808 1.864 -4.3919 1.8195 -4.3919 C1.764 -4.3919 1.639 -4.2891 1.5612 -4.2002 C1.264 -3.8724 1.1667 -3.3724 1.1667 -2.9557 C1.1667 -2.7251 1.1973 -2.464 1.2251 -2.3001 C1.2334 -2.2529 1.2362 -2.2446 1.189 -2.2029 C0.6111 -1.7279 0 -1.1556 0 -0.3472 C0 0.3472 0.475 1.0084 1.4556 1.0084 C1.5473 1.0084 1.6529 1.0001 1.7334 0.9834 C1.7751 0.9751 1.7834 0.9723 1.7918 1.0195 C1.839 1.289 1.9001 1.6362 1.9001 1.8251 C1.9001 2.4168 1.5001 2.489 1.264 2.489 C1.0473 2.489 0.9445 2.4251 0.9445 2.3723 C0.9445 2.3446 0.9806 2.3335 1.0723 2.3029 C1.1973 2.2668 1.339 2.1612 1.339 1.9279 C1.339 1.7084 1.2001 1.5195 0.9556 1.5195 C0.6889 1.5195 0.5278 1.7334 0.5278 1.9807 C0.5278 2.239 0.6834 2.6335 1.289 2.6335 C1.5556 2.6335 2.0751 2.5112 2.0751 1.8334 C2.0751 1.6029 2.0029 1.2251 1.9612 0.9751 C1.9529 0.9278 1.9557 0.9334 2.0112 0.9084 C2.4168 0.7473 2.6835 0.4084 2.6835 -0.0444 C2.6835 -0.5556 2.3085 -1.0084 1.7195 -1.0084 C1.6168 -1.0084 1.6168 -1.0084 1.6029 -1.0806 Z M1.8807 -3.7724 C2.0112 -3.7724 2.1196 -3.6641 2.1196 -3.4446 C2.1196 -3.0002 1.739 -2.639 1.4251 -2.364 C1.3973 -2.339 1.3806 -2.3446 1.3723 -2.3973 C1.3556 -2.5001 1.3473 -2.6363 1.3473 -2.764 C1.3473 -3.3891 1.6362 -3.7724 1.8807 -3.7724 Z M1.4445 -1.0473 C1.4556 -0.9723 1.4556 -0.9751 1.3834 -0.9528 C1.0334 -0.8334 0.8028 -0.5167 0.8028 -0.175 C0.8028 0.1833 0.9917 0.4389 1.264 0.5334 C1.2973 0.5445 1.3445 0.5556 1.3723 0.5556 C1.4029 0.5556 1.4195 0.5361 1.4195 0.5111 C1.4195 0.4834 1.389 0.4722 1.3612 0.4611 C1.1917 0.3889 1.0723 0.2167 1.0723 0.0333 C1.0723 -0.1972 1.2278 -0.3667 1.4723 -0.4361 C1.5362 -0.4528 1.5445 -0.4472 1.5529 -0.4028 L1.7529 0.7889 C1.7612 0.8334 1.7556 0.8334 1.6973 0.8445 C1.6334 0.8556 1.5529 0.8639 1.4723 0.8639 C0.7723 0.8639 0.3195 0.475 0.3195 -0.0806 C0.3195 -0.3167 0.3611 -0.6334 0.6917 -1.0084 C0.9334 -1.2751 1.1167 -1.4251 1.3028 -1.5751 C1.3445 -1.6084 1.3528 -1.6029 1.3612 -1.5612 Z M1.7195 -0.4111 C1.7112 -0.4611 1.7168 -0.4722 1.764 -0.4667 C2.089 -0.4389 2.3557 -0.1667 2.3557 0.1833 C2.3557 0.4361 2.2029 0.6389 1.9807 0.7528 C1.9334 0.775 1.9251 0.775 1.9168 0.7278 Z',
  }),
  bass: Object.freeze({
    /** The F line — second from the top, three spaces above the bottom line. */
    anchorSpacesAboveBottomLine: 3,
    width: 2.736,
    left: -0.02,
    above: 1.048,
    below: 2.54,
    d: 'M1.0087 -1.0476 C0.3112 -1.0476 0 -0.5391 0 -0.1556 C0 0.1639 0.1667 0.439 0.4918 0.439 C0.7447 0.439 0.917 0.264 0.917 0.0167 C0.917 -0.239 0.728 -0.4001 0.5335 -0.4001 C0.4251 -0.4001 0.3835 -0.3724 0.3334 -0.3724 C0.2807 -0.3724 0.2668 -0.4029 0.2668 -0.4446 C0.2668 -0.603 0.5085 -0.8975 0.917 -0.8975 C1.3393 -0.8975 1.5255 -0.4807 1.5255 0.1473 C1.5255 1.2643 0.9726 1.8895 0.0389 2.4203 C0.0028 2.4397 -0.0195 2.462 -0.0195 2.4925 C-0.0195 2.5175 -0.0028 2.5398 0.0333 2.5398 C0.0528 2.5398 0.075 2.5342 0.1 2.5203 C1.0837 2.0396 2.1257 1.3282 2.1257 0.1111 C2.1257 -0.5835 1.7006 -1.0476 1.0087 -1.0476 Z M2.5175 -0.7197 C2.3925 -0.7197 2.298 -0.6252 2.298 -0.5002 C2.298 -0.3751 2.3925 -0.2807 2.5175 -0.2807 C2.6398 -0.2807 2.7371 -0.3751 2.7371 -0.5002 C2.7371 -0.6252 2.6398 -0.7197 2.5175 -0.7197 Z M2.5203 0.2834 C2.398 0.2834 2.3036 0.3751 2.3036 0.5002 C2.3036 0.6252 2.398 0.7169 2.5203 0.7169 C2.6454 0.7169 2.7371 0.6252 2.7371 0.5002 C2.7371 0.3751 2.6454 0.2834 2.5203 0.2834 Z',
  }),
});

/**
 * A clef, drawn on the line it names.
 *
 * Pure geometry: the outline is already in staff spaces with its origin on the
 * defining line, so the whole placement is one translate and one scale. No
 * measurement, no state, no effect — which is also why it cannot disagree with
 * itself between the kiosk and a test.
 */
export function ClefGlyph({ clef, lineSpacing, bottomLineY, className = 'action-staff__clef' }) {
  const spec = CLEFS[clef === 'bass' ? 'bass' : 'treble'];
  const anchorY = bottomLineY - spec.anchorSpacesAboveBottomLine * lineSpacing;
  const x = CLEF_X - spec.left * lineSpacing;
  return (
    <path
      className={className}
      data-clef={clef === 'bass' ? 'bass' : 'treble'}
      d={spec.d}
      fill="rgba(0,0,0,0.5)"
      transform={`translate(${x}, ${anchorY}) scale(${lineSpacing})`}
    />
  );
}
